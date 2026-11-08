-- Avisos de llegada con confirmación humana. Recuperación: retirar la entrada al flujo mediante
-- un PR o corregir el código, conservando tablas, candidatos e historial. No restaurar el botón
-- antiguo que marcaba al abrir. No borrar
-- ni convertir tasks.building_notified_at en envíos. Esta migración no modifica reservas/tareas.
BEGIN;
CREATE SCHEMA airadmin_building;
REVOKE ALL ON SCHEMA airadmin_building FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA airadmin_building TO authenticated, service_role;

CREATE TABLE public.building_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
 channel text NOT NULL CHECK(channel IN ('whatsapp','email')),
 address text NOT NULL CHECK(length(address) BETWEEN 5 AND 200),
 candidate_source text NOT NULL DEFAULT 'legacy_code',
 verified_at timestamptz, verified_by uuid REFERENCES public.team_members(id), verification_evidence text,
 version int NOT NULL DEFAULT 0 CHECK(version>=0),
 CHECK((verified_at IS NULL)=(verified_by IS NULL) AND (verified_at IS NULL)=(verification_evidence IS NULL)),
 CHECK(verification_evidence IS NULL OR length(btrim(verification_evidence)) BETWEEN 10 AND 500),
 CHECK((channel='whatsapp' AND address ~ '^[1-9][0-9]{7,14}$') OR
       (channel='email' AND address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 UNIQUE(property_id,channel,address)
);
CREATE TABLE public.building_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
 property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
 recipient_id uuid NOT NULL REFERENCES public.building_recipients(id) ON DELETE RESTRICT,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'), content_hash text NOT NULL,
 content_version int NOT NULL CHECK(content_version>0),
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','uncertain','sent','delivered','received')),
 version int NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sent_at timestamptz, delivered_at timestamptz, received_at timestamptz, review_reason text,
 CHECK(status NOT IN ('sent','delivered','received') OR sent_at IS NOT NULL),
 CHECK(delivered_at IS NULL OR delivered_at>=sent_at),
 CHECK(received_at IS NULL OR received_at>=sent_at),
 UNIQUE(reservation_id,recipient_id,content_hash), UNIQUE(reservation_id,recipient_id,content_version)
);
CREATE TABLE public.building_notice_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notice_id uuid REFERENCES public.building_notices(id),
 reservation_id uuid REFERENCES public.reservations(id), property_id uuid NOT NULL REFERENCES public.properties(id),
 recipient_id uuid NOT NULL REFERENCES public.building_recipients(id), action text NOT NULL,
 version int NOT NULL, actor_id uuid REFERENCES public.team_members(id), author text NOT NULL,
 source text NOT NULL CHECK(source IN ('app','mcp','system','legacy_code')),
 at timestamptz NOT NULL DEFAULT clock_timestamp(), occurred_at timestamptz,
 evidence text CHECK(length(evidence) BETWEEN 10 AND 500), evidence_kind text,
 before_data jsonb, after_data jsonb NOT NULL,
 request_key text CHECK(length(request_key) BETWEEN 1 AND 200), payload jsonb,
 UNIQUE(actor_id,request_key)
);
CREATE INDEX building_notice_reservation ON public.building_notices(reservation_id,content_version DESC);
CREATE INDEX building_history_reservation ON public.building_notice_history(reservation_id,at DESC);
CREATE INDEX building_history_property ON public.building_notice_history(property_id,at DESC);
ALTER TABLE public.building_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_notice_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin reads building recipients" ON public.building_recipients FOR SELECT TO authenticated USING(public.airadmin_is_admin());
CREATE POLICY "admin reads building notices" ON public.building_notices FOR SELECT TO authenticated USING(public.airadmin_is_admin());
CREATE POLICY "admin reads building history" ON public.building_notice_history FOR SELECT TO authenticated USING(public.airadmin_is_admin());
REVOKE ALL ON public.building_recipients,public.building_notices,public.building_notice_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.building_recipients,public.building_notices,public.building_notice_history TO authenticated,service_role;

-- Los mismos contactos del código anterior se asocian por UUID estable. Solo candidatos, SIN
-- verificar ni marcar enviados. Palmetto conserva dos opciones separadas. Crespo queda sin contacto.
INSERT INTO public.building_recipients(property_id,channel,address)
 SELECT p.id,c.channel,c.address FROM (VALUES
 ('823591d2-e4a9-4893-bd01-f1394a38545d'::uuid,'whatsapp','573053591169'),
 ('0b6170ff-6049-4e21-b6bc-c4237cc2c0f6'::uuid,'whatsapp','573205325033'),
 ('66a7c1ee-2117-4178-890e-181cd904778c'::uuid,'whatsapp','573117135074'),
 ('6a878ed2-148b-4078-9f66-90aab3e76b19'::uuid,'whatsapp','573117135074'),
 ('4b10f347-cf1b-4b89-81b6-b73c41d697a3'::uuid,'whatsapp','573014401513'),
 ('b73c70dd-204b-42f1-a1e1-674de53eca84'::uuid,'email','reservas.edificioelconquistador@gmail.com'),
 ('097d3266-e9d6-4ed0-a403-6dd051c5d042'::uuid,'whatsapp','573054500773'),
 ('097d3266-e9d6-4ed0-a403-6dd051c5d042'::uuid,'whatsapp','573218905525')
 ) c(property_id,channel,address) JOIN public.properties p ON p.id=c.property_id;
INSERT INTO public.building_notice_history(property_id,recipient_id,action,version,author,source,after_data)
 SELECT property_id,id,'candidate_imported',version,'Configuración anterior, pendiente de verificar','legacy_code',to_jsonb(c)
 FROM public.building_recipients c;

CREATE FUNCTION airadmin_building.snapshot(r public.reservations,c public.building_recipients,property_name text)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('template_version',1,'property_id',r.property_id,'apartment',property_name,'guest_name',r.guest_name,
  'guests',r.guests,'check_in',r.check_in,'check_out',r.check_out,'recipient_id',c.id,
  'channel',c.channel,'address',c.address,'recipient_version',c.version)
$$;
REVOKE ALL ON FUNCTION airadmin_building.snapshot(public.reservations,public.building_recipients,text) FROM PUBLIC,anon,authenticated,service_role;

-- Único escritor: autorización servidor + identidad de sesión, bloqueo por reserva, comparación
-- de snapshot, versión esperada y recibo idempotente. No contiene funciones de envío externo.
CREATE FUNCTION airadmin_building.manage(p_operation text,p_input jsonb,p_source text,p_actor_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
<<manage>>
DECLARE actor public.team_members; actor_id uuid; c public.building_recipients;
 r public.reservations; p public.properties; n public.building_notices; previous public.building_notice_history;
 request_key text; payload jsonb; snapshot jsonb; content_hash text; prior jsonb;
 evidence text; event_kind text; action text; event_at timestamptz; stamp timestamptz; already boolean:=false;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE serialization_failure USING MESSAGE='Actualiza y reintenta el aviso en READ COMMITTED.';
 END IF;
 IF current_setting('role',true)='authenticated' AND p_source='app' AND auth.uid() IS NOT NULL
   AND (p_actor_id IS NULL OR p_actor_id=auth.uid()) THEN actor_id:=auth.uid();
 ELSIF current_setting('role',true)='service_role' AND p_source='mcp' THEN actor_id:=p_actor_id;
 ELSE RAISE insufficient_privilege USING MESSAGE='Se requiere una sesión de administrador.'; END IF;
 SELECT * INTO actor FROM public.team_members WHERE id=actor_id AND role='admin' AND active FOR SHARE;
 IF NOT FOUND THEN RAISE insufficient_privilege USING MESSAGE='Se requiere un administrador activo.'; END IF;
 request_key:=btrim(p_input->>'request_key'); evidence:=btrim(p_input->>'evidence');
 IF p_operation IS NULL OR p_operation NOT IN ('verify_recipient','prepare','record') OR jsonb_typeof(p_input)<>'object'
   OR request_key IS NULL OR length(request_key) NOT BETWEEN 1 AND 200 THEN
  RAISE check_violation USING MESSAGE='Operación o clave de reintento inválida.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('building:'||actor.id||':'||request_key,0));
 payload:=jsonb_build_object('operation',p_operation,'input',p_input,'source',p_source);
 SELECT * INTO previous FROM public.building_notice_history h WHERE h.actor_id=actor.id AND h.request_key=manage.request_key;
 IF FOUND THEN
  IF previous.payload IS DISTINCT FROM payload THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','La clave de reintento corresponde a otra operación.'); END IF;
  IF previous.notice_id IS NULL THEN
   SELECT * INTO c FROM public.building_recipients WHERE id=previous.recipient_id;
   RETURN jsonb_build_object('ok',true,'replayed',true,'data',to_jsonb(c));
  END IF;
  SELECT * INTO n FROM public.building_notices WHERE id=previous.notice_id;
  RETURN jsonb_build_object('ok',true,'replayed',true,'data',to_jsonb(n));
 END IF;
 stamp:=clock_timestamp();
 IF p_operation='verify_recipient' THEN
  SELECT * INTO c FROM public.building_recipients WHERE id=(p_input->>'recipient_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','No existe ese destinatario.'); END IF;
  IF (p_input->>'expected_version')::int IS DISTINCT FROM c.version THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','El destinatario cambió. Revísalo.','current',to_jsonb(c)); END IF;
  IF evidence IS NULL OR length(evidence) NOT BETWEEN 10 AND 500 THEN
   RETURN jsonb_build_object('ok',false,'error','Indica cómo comprobaste este destinatario (10–500 caracteres).'); END IF;
  prior:=to_jsonb(c);
  IF c.verified_at IS NULL THEN
   UPDATE public.building_recipients SET verified_at=stamp,verified_by=actor.id,verification_evidence=evidence,version=version+1
   WHERE id=c.id RETURNING * INTO c;
  END IF;
  INSERT INTO public.building_notice_history(property_id,recipient_id,action,version,actor_id,author,source,evidence,evidence_kind,before_data,after_data,request_key,payload)
   VALUES(c.property_id,c.id,'recipient_verified',c.version,actor.id,actor.name,p_source,evidence,'operator_confirmation',prior,to_jsonb(c),request_key,payload);
  RETURN jsonb_build_object('ok',true,'data',to_jsonb(c));
 END IF;
 IF p_operation='record' THEN
  SELECT * INTO n FROM public.building_notices WHERE id=(p_input->>'notice_id')::uuid;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','No existe ese aviso.'); END IF;
  SELECT * INTO r FROM public.reservations WHERE id=n.reservation_id FOR UPDATE;
 ELSE SELECT * INTO r FROM public.reservations WHERE id=(p_input->>'reservation_id')::uuid FOR UPDATE; END IF;
 IF r.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','No existe esa reserva.'); END IF;
 SELECT * INTO p FROM public.properties WHERE id=r.property_id FOR SHARE;
 SELECT * INTO c FROM public.building_recipients
  WHERE id=CASE WHEN p_operation='record' THEN n.recipient_id ELSE (p_input->>'recipient_id')::uuid END FOR SHARE;
 IF c.id IS NULL OR c.property_id<>r.property_id OR c.verified_at IS NULL THEN
  RETURN jsonb_build_object('ok',false,'error','Selecciona un destinatario verificado de este apartamento.'); END IF;
 IF r.status<>'confirmed' OR NOT p.active OR r.guests IS NULL OR r.guests<1
   OR length(btrim(coalesce(r.guest_name,'')))=0 OR btrim(r.guest_name)='—' OR r.check_out<=r.check_in
   OR length(btrim(coalesce(p.name,'')))=0
   OR (r.guest_name||p.name) ~ '[\r\n\x01-\x1f]' THEN
  RETURN jsonb_build_object('ok',false,'error','La reserva está cancelada, incompleta o el apartamento está inactivo.'); END IF;
 snapshot:=airadmin_building.snapshot(r,c,p.name);
 IF p_operation='prepare' THEN
  IF p_input->'snapshot' IS DISTINCT FROM snapshot THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','Los datos de la reserva o del destinatario cambiaron. Previsualiza de nuevo.','current',snapshot); END IF;
  content_hash:=encode(sha256(convert_to(snapshot::text,'UTF8')),'hex');
  SELECT * INTO n FROM public.building_notices b WHERE b.reservation_id=r.id AND b.recipient_id=c.id AND b.content_hash=manage.content_hash;
  already:=FOUND;
  IF NOT already THEN
   IF (EXISTS(SELECT 1 FROM public.building_notices b WHERE b.reservation_id=r.id AND b.recipient_id=c.id
     AND (b.status<>'prepared' OR b.review_reason IS NOT NULL))
     OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.reservation_id=r.id AND t.type='preparation' AND t.building_notified_at IS NOT NULL))
     AND length(btrim(coalesce(p_input->>'review_confirmation',''))) NOT BETWEEN 10 AND 500 THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'error','Hay un aviso anterior. Revisa su resultado y explica por qué preparas otra versión.'); END IF;
   INSERT INTO public.building_notices(reservation_id,property_id,recipient_id,snapshot,content_hash,content_version)
    SELECT r.id,r.property_id,c.id,manage.snapshot,manage.content_hash,coalesce(max(b.content_version),0)+1
    FROM public.building_notices b WHERE b.reservation_id=r.id AND b.recipient_id=c.id RETURNING * INTO n;
  END IF;
  INSERT INTO public.building_notice_history(notice_id,reservation_id,property_id,recipient_id,action,version,actor_id,author,source,evidence,before_data,after_data,request_key,payload)
   VALUES(n.id,r.id,r.property_id,c.id,CASE WHEN already THEN 'prepared_reused' ELSE 'prepared' END,n.version,
    actor.id,actor.name,p_source,nullif(btrim(p_input->>'review_confirmation'),''),NULL,to_jsonb(n),request_key,payload);
  RETURN jsonb_build_object('ok',true,'data',to_jsonb(n));
 END IF;
 SELECT * INTO n FROM public.building_notices WHERE id=n.id FOR UPDATE;
 IF n.version IS DISTINCT FROM (p_input->>'expected_version')::int OR n.snapshot IS DISTINCT FROM snapshot THEN
  RETURN jsonb_build_object('ok',false,'conflict',true,'error','El aviso o la estancia cambiaron. Consulta el estado actual.','current',to_jsonb(n)); END IF;
 action:=p_input->>'action'; event_kind:=p_input->>'evidence_kind';
 IF coalesce(p_input->>'occurred_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
  RETURN jsonb_build_object('ok',false,'error','Indica la fecha real con su zona horaria.'); END IF;
 event_at:=(p_input->>'occurred_at')::timestamptz;
 IF coalesce(p_input->>'confirmed','false')<>'true' OR evidence IS NULL OR length(evidence) NOT BETWEEN 10 AND 500
   OR event_at IS NULL OR event_at>stamp OR event_at<date_trunc('minute',n.created_at)
   OR action IS NULL OR action NOT IN ('uncertain','sent','delivered','received','reviewed') THEN
  RETURN jsonb_build_object('ok',false,'error','Confirma el hecho con fecha real posterior al borrador y evidencia (10–500 caracteres).'); END IF;
 IF (action='uncertain' AND (n.status<>'prepared' OR event_kind IS DISTINCT FROM 'uncertain_result'))
   OR (action='sent' AND (n.status NOT IN ('prepared','uncertain') OR event_kind NOT IN ('operator_confirmation','message_reference')))
   OR (action='delivered' AND (n.status<>'sent' OR event_kind IS DISTINCT FROM 'delivery_receipt'))
   OR (action='received' AND (n.status NOT IN ('sent','delivered') OR event_kind IS DISTINCT FROM 'recipient_acknowledgment'))
   OR (action='reviewed' AND event_kind IS DISTINCT FROM 'review') OR event_kind IS NULL
   OR (action<>'reviewed' AND n.review_reason IS NOT NULL)
   OR (action IN ('delivered','received') AND event_at<coalesce(n.delivered_at,n.sent_at)) THEN
  RETURN jsonb_build_object('ok',false,'conflict',true,'error','Ese estado requiere revisar el aviso y su evidencia anterior.','current',to_jsonb(n)); END IF;
 prior:=to_jsonb(n);
 UPDATE public.building_notices SET status=CASE WHEN action='reviewed' THEN status ELSE action END,
  sent_at=CASE WHEN action='sent' THEN event_at ELSE sent_at END,
  delivered_at=CASE WHEN action='delivered' THEN event_at ELSE delivered_at END,
  received_at=CASE WHEN action='received' THEN event_at ELSE received_at END,
  review_reason=CASE WHEN action='reviewed' THEN NULL ELSE review_reason END,version=version+1
 WHERE id=n.id RETURNING * INTO n;
 INSERT INTO public.building_notice_history(notice_id,reservation_id,property_id,recipient_id,action,version,actor_id,author,source,
  occurred_at,evidence,evidence_kind,before_data,after_data,request_key,payload)
 VALUES(n.id,r.id,r.property_id,c.id,action,n.version,actor.id,actor.name,p_source,event_at,evidence,event_kind,prior,to_jsonb(n),request_key,payload);
 RETURN jsonb_build_object('ok',true,'data',to_jsonb(n));
END $$;
REVOKE ALL ON FUNCTION airadmin_building.manage(text,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION airadmin_building.manage(text,jsonb,text,uuid) TO authenticated,service_role;
CREATE FUNCTION public.manage_building_notice(p_operation text,p_input jsonb,p_source text DEFAULT 'app',p_actor_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT airadmin_building.manage(p_operation,p_input,p_source,p_actor_id)
$$;
REVOKE ALL ON FUNCTION public.manage_building_notice(text,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_building_notice(text,jsonb,text,uuid) TO authenticated,service_role;

CREATE FUNCTION airadmin_building.invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.building_notices; prior jsonb; reason text;
BEGIN
 reason:=CASE WHEN TG_TABLE_NAME='properties' THEN 'Cambió el apartamento. Revisa el contenido y el destinatario.'
  ELSE 'Cambió la reserva (titular, huéspedes, fechas, apartamento o estado). Revisa el aviso.' END;
 FOR n IN SELECT b.* FROM public.building_notices b
  WHERE (TG_TABLE_NAME='reservations' AND b.reservation_id=NEW.id)
    OR (TG_TABLE_NAME='properties' AND b.property_id=NEW.id) ORDER BY b.id FOR UPDATE LOOP
  prior:=to_jsonb(n);
  UPDATE public.building_notices SET review_reason=reason,version=version+1 WHERE id=n.id RETURNING * INTO n;
  INSERT INTO public.building_notice_history(notice_id,reservation_id,property_id,recipient_id,action,version,author,source,evidence,before_data,after_data)
   VALUES(n.id,n.reservation_id,n.property_id,n.recipient_id,'invalidated',n.version,'Actualización de datos','system',reason,prior,to_jsonb(n));
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION airadmin_building.invalidate() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER building_notices_reservation_changed AFTER UPDATE OF guest_name,guests,check_in,check_out,property_id,status ON public.reservations
 FOR EACH ROW WHEN (ROW(OLD.guest_name,OLD.guests,OLD.check_in,OLD.check_out,OLD.property_id,OLD.status)
 IS DISTINCT FROM ROW(NEW.guest_name,NEW.guests,NEW.check_in,NEW.check_out,NEW.property_id,NEW.status))
 EXECUTE FUNCTION airadmin_building.invalidate();
CREATE TRIGGER building_notices_property_changed AFTER UPDATE OF name,active ON public.properties
 FOR EACH ROW WHEN (ROW(OLD.name,OLD.active) IS DISTINCT FROM ROW(NEW.name,NEW.active)) EXECUTE FUNCTION airadmin_building.invalidate();
CREATE FUNCTION airadmin_building.no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE check_violation USING MESSAGE='Conserva el aviso, sus destinatarios y su historial.'; END $$;
REVOKE ALL ON FUNCTION airadmin_building.no_delete() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER building_notices_no_delete BEFORE DELETE ON public.building_notices FOR EACH ROW EXECUTE FUNCTION airadmin_building.no_delete();
CREATE TRIGGER building_recipients_no_delete BEFORE DELETE ON public.building_recipients FOR EACH ROW EXECUTE FUNCTION airadmin_building.no_delete();
CREATE TRIGGER building_history_no_delete BEFORE DELETE ON public.building_notice_history FOR EACH ROW EXECUTE FUNCTION airadmin_building.no_delete();
CREATE TRIGGER building_history_no_update BEFORE UPDATE ON public.building_notice_history FOR EACH ROW EXECUTE FUNCTION airadmin_building.no_delete();
COMMIT;
