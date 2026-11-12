-- Planificación desactivada de mensajes directos. Recuperación: retirar la ruta de borradores,
-- conservando tablas e historial. No borrar recibos, no reactivar envíos ni revertir datos.
-- No crea mensajes de reservas existentes, no hace llamadas externas y no toca reservas.
BEGIN;
CREATE SCHEMA airadmin_direct_messages;
REVOKE ALL ON SCHEMA airadmin_direct_messages FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA airadmin_direct_messages TO authenticated,service_role;
CREATE TABLE public.direct_message_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
 stage text NOT NULL CHECK(stage IN ('confirmation','registration','arrival','departure')),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 channel text NOT NULL DEFAULT 'pending' CHECK(channel IN ('pending','whatsapp','email')),
 recipient text NOT NULL DEFAULT '' CHECK(length(recipient)<=200), body text NOT NULL DEFAULT '' CHECK(length(body)<=4000),
 scheduled_for timestamptz,
 status text NOT NULL CHECK(status IN ('draft','review_required','cancelled')) DEFAULT 'draft',
 review_reason text, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_by uuid NOT NULL REFERENCES public.team_members(id),
 UNIQUE(reservation_id,stage)
);
CREATE TABLE public.direct_message_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES public.direct_message_drafts(id),
 reservation_id uuid NOT NULL REFERENCES public.reservations(id), action text NOT NULL,
 actor_id uuid REFERENCES public.team_members(id), author text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp(),
 before_data jsonb, after_data jsonb NOT NULL, request_key text, payload jsonb,
 UNIQUE(actor_id,request_key)
);
ALTER TABLE public.direct_message_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_message_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.direct_message_drafts,public.direct_message_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.direct_message_drafts,public.direct_message_history TO authenticated,service_role;
CREATE POLICY "admin reads direct drafts" ON public.direct_message_drafts FOR SELECT TO authenticated USING(public.airadmin_is_admin());
CREATE POLICY "admin reads direct history" ON public.direct_message_history FOR SELECT TO authenticated USING(public.airadmin_is_admin());
CREATE FUNCTION airadmin_direct_messages.save(p_input jsonb,p_source text,p_actor_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<save>>
DECLARE actor public.team_members; actor_id uuid; r public.reservations; d public.direct_message_drafts;
 old jsonb; snap jsonb; prior public.direct_message_history; req text; planned timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE serialization_failure; END IF;
 IF current_setting('role',true)='authenticated' AND p_source='app' AND auth.uid() IS NOT NULL AND (p_actor_id IS NULL OR p_actor_id=auth.uid()) THEN actor_id:=auth.uid();
 ELSIF current_setting('role',true)='service_role' AND p_source='mcp' THEN actor_id:=p_actor_id;
 ELSE RAISE insufficient_privilege USING MESSAGE='Se requiere una sesión válida.'; END IF;
 SELECT * INTO actor FROM public.team_members WHERE id=actor_id AND active AND role='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
 req:=btrim(p_input->>'request_key');
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR req IS NULL OR length(req) NOT BETWEEN 1 AND 200
 OR p_input->>'stage' IS NULL OR p_input->>'stage' NOT IN ('confirmation','registration','arrival','departure')
 OR p_input->>'channel' IS NULL OR p_input->>'channel' NOT IN ('pending','whatsapp','email')
 OR p_input->>'reviewed' IS DISTINCT FROM 'true'
 OR p_input->>'recipient' IS NULL OR length(p_input->>'recipient')>200
 OR p_input->>'body' IS NULL OR length(p_input->>'body')>4000
 OR p_input->>'expected_version' IS NULL OR (p_input->>'expected_version')::int<0 THEN RAISE check_violation; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('direct:'||actor.id||':'||req,0));
 SELECT * INTO prior FROM public.direct_message_history h WHERE h.actor_id=actor.id AND h.request_key=req;
 IF FOUND THEN
  IF prior.payload IS DISTINCT FROM jsonb_build_object('input',p_input,'source',p_source) THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','La clave ya corresponde a otro borrador.'); END IF;
  SELECT * INTO d FROM public.direct_message_drafts WHERE id=prior.draft_id;
  IF d.version IS DISTINCT FROM (prior.after_data->>'version')::int THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','El borrador cambió después de ese guardado. Recarga y revisa.','current',to_jsonb(d)); END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'data',to_jsonb(d));
 END IF;
 SELECT * INTO r FROM public.reservations WHERE id=(p_input->>'reservation_id')::uuid FOR UPDATE;
 IF NOT FOUND OR r.source<>'direct' OR r.status<>'confirmed' OR r.check_out<=r.check_in OR r.guests IS NULL OR r.guests<1 OR length(btrim(coalesce(r.guest_name,'')))=0 THEN
  RETURN jsonb_build_object('ok',false,'error','La reserva directa debe estar confirmada y completa; un bloqueo no es confirmación.'); END IF;
 snap:=jsonb_build_object('property_id',r.property_id,'guest_name',r.guest_name,'guests',r.guests,'check_in',r.check_in,'check_out',r.check_out);
 IF p_input->'snapshot' IS DISTINCT FROM snap THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','Cambió la estancia. Recarga y revisa el texto.','current',snap); END IF;
 IF p_input->>'scheduled_for' IS NOT NULL THEN
  IF p_input->>'scheduled_for' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE check_violation; END IF;
  planned:=(p_input->>'scheduled_for')::timestamptz;
  IF (planned AT TIME ZONE 'America/Bogota')::date>r.check_out THEN RETURN jsonb_build_object('ok',false,'error','La fecha propuesta no puede ser posterior a la salida.'); END IF;
 END IF;
 SELECT * INTO d FROM public.direct_message_drafts WHERE reservation_id=r.id AND stage=p_input->>'stage' FOR UPDATE;
 IF coalesce(d.version,0) IS DISTINCT FROM (p_input->>'expected_version')::int THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','Otra persona modificó el borrador. Recarga.','current',to_jsonb(d)); END IF;
 old:=CASE WHEN d.id IS NULL THEN NULL ELSE to_jsonb(d) END;
 IF d.id IS NULL THEN
  INSERT INTO public.direct_message_drafts(reservation_id,stage,snapshot,channel,recipient,body,scheduled_for,updated_by)
   VALUES(r.id,p_input->>'stage',snap,p_input->>'channel',btrim(p_input->>'recipient'),btrim(p_input->>'body'),planned,actor.id) RETURNING * INTO d;
 ELSE
  UPDATE public.direct_message_drafts SET snapshot=snap,channel=p_input->>'channel',recipient=btrim(p_input->>'recipient'),body=btrim(p_input->>'body'),scheduled_for=planned,
   status='draft',review_reason=NULL,version=version+1,updated_by=actor.id,updated_at=clock_timestamp() WHERE id=d.id RETURNING * INTO d;
 END IF;
 INSERT INTO public.direct_message_history(draft_id,reservation_id,action,actor_id,author,before_data,after_data,request_key,payload)
 VALUES(d.id,r.id,'saved',actor.id,actor.name,old,to_jsonb(d),req,jsonb_build_object('input',p_input,'source',p_source));
 RETURN jsonb_build_object('ok',true,'data',to_jsonb(d),'sending_enabled',false);
END $$;
REVOKE ALL ON FUNCTION airadmin_direct_messages.save(jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION airadmin_direct_messages.save(jsonb,text,uuid) TO authenticated,service_role;
CREATE FUNCTION public.save_direct_message_draft(p_input jsonb,p_source text DEFAULT 'app',p_actor_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT airadmin_direct_messages.save(p_input,p_source,p_actor_id) $$;
REVOKE ALL ON FUNCTION public.save_direct_message_draft(jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_direct_message_draft(jsonb,text,uuid) TO authenticated,service_role;
CREATE FUNCTION airadmin_direct_messages.invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.direct_message_drafts; old jsonb;
BEGIN
 FOR d IN SELECT * FROM public.direct_message_drafts WHERE reservation_id=NEW.id ORDER BY id FOR UPDATE LOOP
  old:=to_jsonb(d);
  UPDATE public.direct_message_drafts SET status=CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'review_required' END,
   review_reason='Cambió la reserva: revisa fechas, apartamento, huéspedes, contacto y texto antes de volver a guardar.',version=version+1,updated_at=clock_timestamp()
   WHERE id=d.id RETURNING * INTO d;
  INSERT INTO public.direct_message_history(draft_id,reservation_id,action,author,before_data,after_data)
   VALUES(d.id,NEW.id,'invalidated','Actualización de reserva',old,to_jsonb(d));
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION airadmin_direct_messages.invalidate() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invalidate_direct_message_drafts AFTER UPDATE OF source,status,property_id,guest_name,guests,check_in,check_out ON public.reservations
 FOR EACH ROW WHEN ((OLD.source,OLD.status,OLD.property_id,OLD.guest_name,OLD.guests,OLD.check_in,OLD.check_out) IS DISTINCT FROM (NEW.source,NEW.status,NEW.property_id,NEW.guest_name,NEW.guests,NEW.check_in,NEW.check_out)) EXECUTE FUNCTION airadmin_direct_messages.invalidate();
COMMIT;
