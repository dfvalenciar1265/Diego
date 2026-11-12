-- Evidencia histórica explícita, sin envío y sin alterar marcas de tiempo de avisos preparados.
BEGIN;
CREATE TABLE public.building_notice_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
 recipient_id uuid NOT NULL REFERENCES public.building_recipients(id) ON DELETE RESTRICT,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 status text NOT NULL CHECK(status IN ('sent','delivered','received')),
 occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor_id uuid NOT NULL REFERENCES public.team_members(id),author text NOT NULL,
 evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 10 AND 500),
 reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 3 AND 200),
 version int NOT NULL DEFAULT 1 CHECK(version>0), invalidated_at timestamptz,
 UNIQUE(reservation_id,recipient_id,reference),CHECK(occurred_at<=recorded_at)
);
CREATE TABLE airadmin_building.observation_requests (
 actor_id uuid NOT NULL REFERENCES public.team_members(id),request_key text NOT NULL,
 payload jsonb NOT NULL,observation_id uuid NOT NULL REFERENCES public.building_notice_observations(id),
 PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE public.building_notice_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE airadmin_building.observation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.building_notice_observations,airadmin_building.observation_requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.building_notice_observations TO authenticated,service_role;
CREATE POLICY "admin reads historical notices" ON public.building_notice_observations FOR SELECT TO authenticated USING(public.airadmin_is_admin());
CREATE FUNCTION airadmin_building.record_historical(p_input jsonb,p_source text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.team_members;r public.reservations;c public.building_recipients;p public.properties;
 o public.building_notice_observations;q airadmin_building.observation_requests;
 aid uuid;req text;ref text;snap jsonb;event_at timestamptz;payload jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE serialization_failure;END IF;
 IF current_setting('role',true)='authenticated' AND p_source='app' AND auth.uid() IS NOT NULL AND (p_actor_id IS NULL OR p_actor_id=auth.uid()) THEN aid:=auth.uid();
 ELSIF current_setting('role',true)='service_role' AND p_source='mcp' THEN aid:=p_actor_id;
 ELSE RAISE insufficient_privilege;END IF;
 SELECT * INTO a FROM public.team_members WHERE id=aid AND active AND role='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE insufficient_privilege;END IF;
 req:=btrim(p_input->>'request_key');ref:=btrim(p_input->>'reference');
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR coalesce(length(req),0) NOT BETWEEN 1 AND 200 OR coalesce(length(ref),0) NOT BETWEEN 3 AND 200
 OR p_input->>'confirmed' IS DISTINCT FROM 'true' OR p_input->>'expected_version' IS DISTINCT FROM '0'
 OR p_input->>'status' IS NULL OR p_input->>'status' NOT IN ('sent','delivered','received')
 OR coalesce(length(btrim(p_input->>'evidence')),0) NOT BETWEEN 10 AND 500
 OR coalesce(p_input->>'occurred_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE check_violation; END IF;
 event_at:=(p_input->>'occurred_at')::timestamptz;
 IF NOT isfinite(event_at) OR event_at>clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','La evidencia requiere una fecha real, no futura.');END IF;
 payload:=jsonb_build_object('input',p_input,'source',p_source);
 PERFORM pg_advisory_xact_lock(hashtextextended('historical-notice:'||aid||':'||req,0));
 SELECT * INTO q FROM airadmin_building.observation_requests WHERE actor_id=aid AND request_key=req;
 IF FOUND THEN
  IF q.payload IS DISTINCT FROM payload THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','La clave corresponde a otra evidencia.');END IF;
  SELECT * INTO o FROM public.building_notice_observations WHERE id=q.observation_id;
  IF o.invalidated_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','La evidencia se registró, pero cambios posteriores invalidaron su vigencia. Revisa el historial.','current',to_jsonb(o));END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'data',to_jsonb(o));
 END IF;
 SELECT * INTO r FROM public.reservations WHERE id=(p_input->>'reservation_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','No existe la reserva.');END IF;
 SELECT * INTO c FROM public.building_recipients WHERE id=(p_input->>'recipient_id')::uuid FOR SHARE;
 IF NOT FOUND OR c.property_id<>r.property_id OR c.verified_at IS NULL THEN RETURN jsonb_build_object('ok',false,'error','Primero verifica expresamente el destinatario; la evidencia no promueve candidatos.');END IF;
 SELECT * INTO p FROM public.properties WHERE id=r.property_id FOR SHARE;
 snap:=airadmin_building.snapshot(r,c,p.name);
 IF p_input->'snapshot' IS DISTINCT FROM snap THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','La estancia o contacto cambió. Revisa evidencia y alcance.');END IF;
 SELECT * INTO o FROM public.building_notice_observations WHERE reservation_id=r.id AND recipient_id=c.id AND reference=ref;
 IF FOUND THEN
  IF o.invalidated_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','La referencia existe pero su vigencia fue invalidada; consulta historial.','current',to_jsonb(o));END IF;
  IF o.snapshot IS DISTINCT FROM snap OR o.status IS DISTINCT FROM p_input->>'status' OR o.occurred_at IS DISTINCT FROM event_at OR o.evidence IS DISTINCT FROM btrim(p_input->>'evidence') THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','La referencia ya tiene otra evidencia; no se sobrescribe.','current',to_jsonb(o));END IF;
 ELSE
  INSERT INTO public.building_notice_observations(reservation_id,recipient_id,snapshot,status,occurred_at,actor_id,author,evidence,reference)
  VALUES(r.id,c.id,snap,p_input->>'status',event_at,a.id,a.name,btrim(p_input->>'evidence'),ref) RETURNING * INTO o;
  INSERT INTO public.building_notice_history(reservation_id,property_id,recipient_id,action,version,actor_id,author,source,occurred_at,evidence,evidence_kind,after_data)
  VALUES(r.id,r.property_id,c.id,'historical_'||o.status,o.version,a.id,a.name,p_source,o.occurred_at,o.evidence,'historical_observation',to_jsonb(o));
 END IF;
 INSERT INTO airadmin_building.observation_requests VALUES(a.id,req,payload,o.id);
 RETURN jsonb_build_object('ok',true,'data',to_jsonb(o));
END $$;
REVOKE ALL ON FUNCTION airadmin_building.record_historical(jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION airadmin_building.record_historical(jsonb,text,uuid) TO authenticated,service_role;
CREATE FUNCTION public.record_historical_building_notice(p_input jsonb,p_source text DEFAULT 'app',p_actor_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT airadmin_building.record_historical(p_input,p_source,p_actor_id) $$;
REVOKE ALL ON FUNCTION public.record_historical_building_notice(jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_historical_building_notice(jsonb,text,uuid) TO authenticated,service_role;
-- El mismo bloqueo de reserva serializa preparar y registrar evidencia histórica.
ALTER FUNCTION airadmin_building.manage(text,jsonb,text,uuid) RENAME TO manage_without_observations;
REVOKE ALL ON FUNCTION airadmin_building.manage_without_observations(text,jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION airadmin_building.manage(p_operation text,p_input jsonb,p_source text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations;c public.building_recipients;p public.properties;
BEGIN
 -- Autorizar antes de consultar existencia de evidencia.
 IF NOT ((current_setting('role',true)='authenticated' AND p_source='app' AND auth.uid() IS NOT NULL AND (p_actor_id IS NULL OR p_actor_id=auth.uid()) AND EXISTS(SELECT 1 FROM public.team_members WHERE id=auth.uid() AND active AND role='admin'))
 OR (current_setting('role',true)='service_role' AND p_source='mcp' AND EXISTS(SELECT 1 FROM public.team_members WHERE id=p_actor_id AND active AND role='admin'))) THEN RAISE insufficient_privilege;END IF;
 IF p_operation='prepare' THEN
  SELECT * INTO r FROM public.reservations WHERE id=(p_input->>'reservation_id')::uuid FOR UPDATE;
  SELECT * INTO c FROM public.building_recipients WHERE id=(p_input->>'recipient_id')::uuid;
  SELECT * INTO p FROM public.properties WHERE id=r.property_id;
  IF EXISTS(SELECT 1 FROM public.building_notice_observations o WHERE o.reservation_id=r.id AND o.recipient_id=c.id AND o.invalidated_at IS NULL AND o.snapshot=airadmin_building.snapshot(r,c,p.name)) THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','Existe evidencia histórica vigente. No prepares otro envío; revisa el historial.');END IF;
 END IF;
 RETURN airadmin_building.manage_without_observations(p_operation,p_input,p_source,p_actor_id);
END $$;
REVOKE ALL ON FUNCTION airadmin_building.manage(text,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION airadmin_building.manage(text,jsonb,text,uuid) TO authenticated,service_role;
CREATE FUNCTION airadmin_building.invalidate_observations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.building_notice_observations;prior jsonb;
BEGIN
 FOR o IN SELECT * FROM public.building_notice_observations WHERE reservation_id=NEW.id AND invalidated_at IS NULL ORDER BY id FOR UPDATE LOOP
  prior:=to_jsonb(o);
  UPDATE public.building_notice_observations SET invalidated_at=clock_timestamp(),version=version+1 WHERE id=o.id RETURNING * INTO o;
  INSERT INTO public.building_notice_history(reservation_id,property_id,recipient_id,action,version,author,source,occurred_at,evidence,evidence_kind,before_data,after_data)
  VALUES(o.reservation_id,(o.snapshot->>'property_id')::uuid,o.recipient_id,'historical_invalidated',o.version,'Actualización de reserva','system',o.occurred_at,'Cambió la reserva; evidencia conservada y vigencia invalidada.','review',prior,to_jsonb(o));
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION airadmin_building.invalidate_observations() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER invalidate_historical_building_notices AFTER UPDATE OF status,source,property_id,guest_name,guests,check_in,check_out ON public.reservations
FOR EACH ROW WHEN ((OLD.status,OLD.source,OLD.property_id,OLD.guest_name,OLD.guests,OLD.check_in,OLD.check_out) IS DISTINCT FROM (NEW.status,NEW.source,NEW.property_id,NEW.guest_name,NEW.guests,NEW.check_in,NEW.check_out)) EXECUTE FUNCTION airadmin_building.invalidate_observations();
COMMIT;
