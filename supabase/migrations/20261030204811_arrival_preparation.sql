-- Preparación por llegada. SOLO aplicar con el sí de Diego, después de conciliación Gmail.
-- Recuperación: volver al código anterior conservando estas tablas e historial; no hay backfill
-- de confirmaciones ni cambios de reservas/tareas. No borrar ni repetir migraciones anteriores.
BEGIN;
CREATE SCHEMA IF NOT EXISTS airadmin_preparation;
REVOKE ALL ON SCHEMA airadmin_preparation FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA airadmin_preparation TO authenticated, service_role;

CREATE TABLE public.arrival_preparations (
 reservation_id uuid PRIMARY KEY REFERENCES public.reservations(id) ON DELETE RESTRICT,
 property_id uuid NOT NULL REFERENCES public.properties(id),
 stay_check_in date NOT NULL, stay_check_out date NOT NULL CHECK(stay_check_out>stay_check_in),
 cleaned_at timestamptz, cleaned_by uuid REFERENCES public.team_members(id), cleaned_name text,
 checked_at timestamptz, checked_by uuid REFERENCES public.team_members(id), checked_name text,
 ready_at timestamptz, ready_by uuid REFERENCES public.team_members(id), ready_name text,
 review_reason text, version int NOT NULL DEFAULT 0 CHECK(version>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((cleaned_at IS NULL)=(cleaned_by IS NULL) AND (cleaned_at IS NULL)=(cleaned_name IS NULL)),
 CHECK ((checked_at IS NULL)=(checked_by IS NULL) AND (checked_at IS NULL)=(checked_name IS NULL)),
 CHECK ((ready_at IS NULL)=(ready_by IS NULL) AND (ready_at IS NULL)=(ready_name IS NULL)),
 CHECK (checked_at IS NULL OR cleaned_at IS NOT NULL),
 CHECK (ready_at IS NULL OR (cleaned_at IS NOT NULL AND checked_at IS NOT NULL))
);
CREATE TABLE public.arrival_preparation_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
 version int NOT NULL, action text NOT NULL, reason text,
 actor_id uuid REFERENCES public.team_members(id), author text NOT NULL,
 source text NOT NULL CHECK(source IN ('app','mcp','system')),
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 before_data jsonb, after_data jsonb NOT NULL,
 request_key text CHECK(length(request_key) BETWEEN 1 AND 200), payload jsonb,
 UNIQUE(reservation_id, version), UNIQUE(reservation_id, request_key)
);
CREATE INDEX arrival_preparations_property ON public.arrival_preparations(property_id);
CREATE INDEX arrival_preparation_history_reservation ON public.arrival_preparation_history(reservation_id,version DESC);
ALTER TABLE public.arrival_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrival_preparation_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active team reads arrival preparation" ON public.arrival_preparations FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active));
CREATE POLICY "active team reads arrival history" ON public.arrival_preparation_history FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active));
REVOKE ALL ON public.arrival_preparations,public.arrival_preparation_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.arrival_preparations,public.arrival_preparation_history TO authenticated,service_role;

-- La función privilegiada queda fuera del esquema expuesto. La envoltura pública es invocadora.
-- Necesita definidor porque los clientes no pueden escribir directamente estados ni historial.
CREATE FUNCTION airadmin_preparation.record(
 p_reservation_id uuid,p_step text,p_confirmed boolean,p_expected_version int,p_request_key text,
 p_stay_check_in date,p_stay_check_out date,p_reason text DEFAULT '',p_source text DEFAULT 'app',p_actor_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations; s public.arrival_preparations; actor public.team_members;
 previous public.arrival_preparation_history; prior jsonb; payload jsonb;
 actor_id uuid; today date; stamp timestamptz; already boolean;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE serialization_failure USING MESSAGE='Actualiza y reintenta la preparación en READ COMMITTED.';
 END IF;
 IF current_setting('role',true)='service_role' AND p_source='mcp' THEN actor_id:=p_actor_id;
 ELSIF current_setting('role',true)='authenticated' AND p_source='app' AND auth.uid() IS NOT NULL
   AND (p_actor_id IS NULL OR p_actor_id=auth.uid()) THEN actor_id:=auth.uid();
 ELSE RAISE insufficient_privilege USING MESSAGE='La sesión no puede confirmar esta preparación.'; END IF;
 SELECT * INTO actor FROM public.team_members WHERE id=actor_id AND active FOR SHARE;
 IF NOT FOUND OR (p_source='mcp' AND actor.role<>'admin') THEN
   RAISE insufficient_privilege USING MESSAGE='Se requiere un miembro activo con permiso.'; END IF;
 IF p_step NOT IN ('cleaning','functioning','ready') OR p_step IS NULL OR p_confirmed IS NULL
   OR p_expected_version IS NULL OR p_expected_version<0 OR p_request_key IS NULL
   OR length(btrim(p_request_key)) NOT BETWEEN 1 AND 200 OR length(coalesce(p_reason,''))>500 THEN
   RAISE check_violation USING MESSAGE='Datos de preparación inválidos.'; END IF;
 IF (p_step='cleaning' AND actor.role NOT IN ('admin','anfitrion','cleaning'))
   OR (p_step='functioning' AND actor.role NOT IN ('admin','anfitrion','cleaning','maintenance'))
   OR (p_step='ready' AND actor.role NOT IN ('admin','anfitrion')) THEN
   RAISE insufficient_privilege USING MESSAGE='Tu rol no puede confirmar o reabrir esta etapa.'; END IF;
 -- Todas las escrituras e invalidaciones se ordenan por la reserva. No se bloquea mantenimiento
 -- desde aquí: su trigger espera esta misma reserva y retira cualquier listo recién confirmado.
 SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE check_violation USING MESSAGE='La reserva no existe.'; END IF;
 SELECT * INTO s FROM public.arrival_preparations WHERE reservation_id=r.id;
 IF p_stay_check_in IS DISTINCT FROM r.check_in OR p_stay_check_out IS DISTINCT FROM r.check_out OR r.status<>'confirmed' THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','La estancia cambió o se canceló. Actualiza antes de confirmar.','current',to_jsonb(s)); END IF;
 payload:=jsonb_build_object('step',p_step,'confirmed',p_confirmed,'expected_version',p_expected_version,
   'check_in',p_stay_check_in,'check_out',p_stay_check_out,'reason',btrim(coalesce(p_reason,'')),'source',p_source,'actor',actor_id);
 SELECT * INTO previous FROM public.arrival_preparation_history WHERE reservation_id=r.id AND request_key=p_request_key;
 IF FOUND THEN
   IF previous.payload IS DISTINCT FROM payload THEN RAISE check_violation USING MESSAGE='La clave de reintento ya corresponde a otra operación.'; END IF;
   RETURN jsonb_build_object('ok',true,'replayed',true,'data',to_jsonb(s));
 END IF;
 IF coalesce(s.version,0)<>p_expected_version THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','La preparación cambió. Revisa el estado actual.','current',to_jsonb(s)); END IF;
 today:=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date;
 IF p_confirmed AND today NOT BETWEEN r.check_in-1 AND r.check_in THEN
   RETURN jsonb_build_object('ok',false,'error','Confirma el día anterior o el día de llegada, en Colombia.'); END IF;
 IF p_confirmed AND EXISTS(SELECT 1 FROM public.reservations other WHERE other.property_id=r.property_id
   AND other.id<>r.id AND other.status='confirmed' AND other.check_in<=today AND other.check_out>today) THEN
   RETURN jsonb_build_object('ok',false,'error','Otra estancia sigue vigente en el apartamento. Comprueba la salida antes de preparar.'); END IF;
 IF NOT p_confirmed AND length(btrim(coalesce(p_reason,'')))=0 THEN
   RETURN jsonb_build_object('ok',false,'error','Indica por qué se reabre la etapa.'); END IF;
 already:=CASE p_step WHEN 'cleaning' THEN s.cleaned_at IS NOT NULL WHEN 'functioning' THEN s.checked_at IS NOT NULL ELSE s.ready_at IS NOT NULL END;
 IF already=p_confirmed THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','La etapa ya tiene ese estado. Actualiza la preparación.','current',to_jsonb(s)); END IF;
 IF p_confirmed AND p_step IN ('functioning','ready') AND s.cleaned_at IS NULL THEN
   RETURN jsonb_build_object('ok',false,'error','Primero confirma la limpieza para esta llegada.'); END IF;
 IF p_confirmed AND p_step='ready' AND s.checked_at IS NULL THEN
   RETURN jsonb_build_object('ok',false,'error','Falta confirmar la revisión de funcionamiento.'); END IF;
 IF p_confirmed AND p_step IN ('functioning','ready') AND EXISTS(SELECT 1 FROM public.maintenance
   WHERE property_id=r.property_id AND status<>'resolved' AND priority='urgent') THEN
   RETURN jsonb_build_object('ok',false,'error','Hay incidencias urgentes abiertas en este apartamento.'); END IF;
 IF p_confirmed AND p_step='ready' AND EXISTS(SELECT 1 FROM public.special_requests
   WHERE reservation_id=r.id AND status<>'cancelled' AND (status<>'ready' OR review_reason IS NOT NULL)) THEN
   RETURN jsonb_build_object('ok',false,'error','Hay solicitudes especiales pendientes o por revisar.'); END IF;
 prior:=to_jsonb(s); stamp:=clock_timestamp();
 INSERT INTO public.arrival_preparations(reservation_id,property_id,stay_check_in,stay_check_out)
   VALUES(r.id,r.property_id,r.check_in,r.check_out) ON CONFLICT(reservation_id) DO NOTHING;
 UPDATE public.arrival_preparations SET
  cleaned_at=CASE WHEN p_step='cleaning' THEN CASE WHEN p_confirmed THEN stamp END ELSE cleaned_at END,
  cleaned_by=CASE WHEN p_step='cleaning' THEN CASE WHEN p_confirmed THEN actor.id END ELSE cleaned_by END,
  cleaned_name=CASE WHEN p_step='cleaning' THEN CASE WHEN p_confirmed THEN actor.name END ELSE cleaned_name END,
  checked_at=CASE WHEN p_step='cleaning' THEN NULL WHEN p_step='functioning' THEN CASE WHEN p_confirmed THEN stamp END ELSE checked_at END,
  checked_by=CASE WHEN p_step='cleaning' THEN NULL WHEN p_step='functioning' THEN CASE WHEN p_confirmed THEN actor.id END ELSE checked_by END,
  checked_name=CASE WHEN p_step='cleaning' THEN NULL WHEN p_step='functioning' THEN CASE WHEN p_confirmed THEN actor.name END ELSE checked_name END,
  ready_at=CASE WHEN p_step='ready' AND p_confirmed THEN stamp ELSE NULL END,
  ready_by=CASE WHEN p_step='ready' AND p_confirmed THEN actor.id ELSE NULL END,
  ready_name=CASE WHEN p_step='ready' AND p_confirmed THEN actor.name ELSE NULL END,
  review_reason=CASE WHEN NOT p_confirmed THEN 'Reabierta: '||btrim(p_reason) END,
  version=version+1,updated_at=stamp WHERE reservation_id=r.id RETURNING * INTO s;
 INSERT INTO public.arrival_preparation_history(reservation_id,version,action,reason,actor_id,author,source,before_data,after_data,request_key,payload)
 VALUES(r.id,s.version,p_step||CASE WHEN p_confirmed THEN ':confirmed' ELSE ':reopened' END,
  nullif(btrim(p_reason),''),actor.id,actor.name,p_source,prior,to_jsonb(s),p_request_key,payload);
 RETURN jsonb_build_object('ok',true,'replayed',false,'data',to_jsonb(s));
END $$;
REVOKE ALL ON FUNCTION airadmin_preparation.record(uuid,text,boolean,int,text,date,date,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION airadmin_preparation.record(uuid,text,boolean,int,text,date,date,text,text,uuid) TO authenticated,service_role;
CREATE FUNCTION public.record_arrival_preparation(
 p_reservation_id uuid,p_step text,p_confirmed boolean,p_expected_version int,p_request_key text,
 p_stay_check_in date,p_stay_check_out date,p_reason text DEFAULT '',p_source text DEFAULT 'app',p_actor_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT airadmin_preparation.record(p_reservation_id,p_step,p_confirmed,p_expected_version,p_request_key,
  p_stay_check_in,p_stay_check_out,p_reason,p_source,p_actor_id)
$$;
REVOKE ALL ON FUNCTION public.record_arrival_preparation(uuid,text,boolean,int,text,date,date,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_arrival_preparation(uuid,text,boolean,int,text,date,date,text,text,uuid) TO authenticated,service_role;

CREATE FUNCTION airadmin_preparation.invalidate(p_reservation uuid,p_reason text,p_all boolean,p_functioning boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.arrival_preparations; prior jsonb; r public.reservations;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE serialization_failure USING MESSAGE='Actualiza y reintenta la preparación en READ COMMITTED.';
 END IF;
 SELECT * INTO r FROM public.reservations WHERE id=p_reservation FOR UPDATE;
 SELECT * INTO s FROM public.arrival_preparations WHERE reservation_id=p_reservation FOR UPDATE;
 IF NOT FOUND OR (NOT p_all AND s.ready_at IS NULL AND (NOT p_functioning OR s.checked_at IS NULL)) THEN RETURN; END IF;
 prior:=to_jsonb(s);
 UPDATE public.arrival_preparations SET property_id=r.property_id,stay_check_in=r.check_in,stay_check_out=r.check_out,
  cleaned_at=CASE WHEN p_all THEN NULL ELSE cleaned_at END,
  cleaned_by=CASE WHEN p_all THEN NULL ELSE cleaned_by END,
  cleaned_name=CASE WHEN p_all THEN NULL ELSE cleaned_name END,
  checked_at=CASE WHEN p_all OR p_functioning THEN NULL ELSE checked_at END,
  checked_by=CASE WHEN p_all OR p_functioning THEN NULL ELSE checked_by END,
  checked_name=CASE WHEN p_all OR p_functioning THEN NULL ELSE checked_name END,
  ready_at=NULL,ready_by=NULL,ready_name=NULL,review_reason=p_reason,
  version=version+1,updated_at=clock_timestamp() WHERE reservation_id=p_reservation RETURNING * INTO s;
 INSERT INTO public.arrival_preparation_history(reservation_id,version,action,reason,author,source,before_data,after_data)
  VALUES(p_reservation,s.version,'invalidated',p_reason,'Sistema de AirAdmin','system',prior,to_jsonb(s));
END $$;
REVOKE ALL ON FUNCTION airadmin_preparation.invalidate(uuid,text,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION airadmin_preparation.reservation_changed() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE serialization_failure USING MESSAGE='Actualiza y reintenta la preparación en READ COMMITTED.';
 END IF;
 IF (NEW.check_in,NEW.check_out,NEW.property_id,NEW.status) IS DISTINCT FROM (OLD.check_in,OLD.check_out,OLD.property_id,OLD.status) THEN
  PERFORM airadmin_preparation.invalidate(NEW.id,'Cambió la estancia o se canceló; vuelve a confirmar la preparación.',true,true);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER arrival_preparation_reservation_changed AFTER UPDATE OF check_in,check_out,property_id,status ON public.reservations
 FOR EACH ROW EXECUTE FUNCTION airadmin_preparation.reservation_changed();
CREATE FUNCTION airadmin_preparation.issue_changed() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE arrival record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE serialization_failure USING MESSAGE='Actualiza y reintenta la preparación en READ COMMITTED.';
 END IF;
 IF NEW.status='resolved' OR NEW.priority='scheduled' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.status,NEW.priority,NEW.property_id,NEW.title,NEW.description)
   IS NOT DISTINCT FROM (OLD.status,OLD.priority,OLD.property_id,OLD.title,OLD.description) THEN RETURN NEW; END IF;
 FOR arrival IN SELECT r.id FROM public.reservations r WHERE r.property_id=NEW.property_id AND r.status='confirmed'
  AND r.check_in>=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date ORDER BY r.id FOR UPDATE LOOP
  PERFORM airadmin_preparation.invalidate(arrival.id,'Hay una incidencia nueva o modificada; revisa la preparación.',false,NEW.priority='urgent');
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER arrival_preparation_issue_changed AFTER INSERT OR UPDATE ON public.maintenance
 FOR EACH ROW EXECUTE FUNCTION airadmin_preparation.issue_changed();
CREATE FUNCTION airadmin_preparation.request_changed() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE serialization_failure USING MESSAGE='Actualiza y reintenta la preparación en READ COMMITTED.';
 END IF;
 IF NEW.status<>'cancelled' AND (NEW.status<>'ready' OR NEW.review_reason IS NOT NULL) THEN
  PERFORM airadmin_preparation.invalidate(NEW.reservation_id,'Hay una solicitud especial pendiente o por revisar.',false,false);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER arrival_preparation_request_changed AFTER INSERT OR UPDATE ON public.special_requests
 FOR EACH ROW EXECUTE FUNCTION airadmin_preparation.request_changed();
CREATE FUNCTION airadmin_preparation.no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'La preparación y su historial no se borran' USING ERRCODE='42501'; END $$;
CREATE TRIGGER arrival_preparation_no_delete BEFORE DELETE ON public.arrival_preparations FOR EACH ROW EXECUTE FUNCTION airadmin_preparation.no_delete();
CREATE TRIGGER arrival_preparation_history_no_delete BEFORE DELETE ON public.arrival_preparation_history FOR EACH ROW EXECUTE FUNCTION airadmin_preparation.no_delete();
REVOKE ALL ON FUNCTION airadmin_preparation.reservation_changed(),airadmin_preparation.issue_changed(),
 airadmin_preparation.request_changed(),airadmin_preparation.no_delete() FROM PUBLIC,anon,authenticated,service_role;
-- Una estancia introducida después de limpiar tampoco puede reutilizar esa preparación.
-- Se bloquean las reservas candidatas incluso si aún no tienen estado: cubre la creación concurrente.
CREATE FUNCTION airadmin_preparation.intervening_stay_changed() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE arrival record; cleaned timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE serialization_failure USING MESSAGE='Actualiza y reintenta la preparación en READ COMMITTED.';
 END IF;
 IF NEW.status<>'confirmed' OR NEW.check_out<=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.check_in,NEW.check_out,NEW.property_id,NEW.status)
  IS NOT DISTINCT FROM (OLD.check_in,OLD.check_out,OLD.property_id,OLD.status) THEN RETURN NEW; END IF;
 FOR arrival IN SELECT r.id FROM public.reservations r WHERE r.id<>NEW.id AND r.property_id=NEW.property_id
  AND r.status='confirmed' AND r.check_in>=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date
  AND NEW.check_in<=r.check_in ORDER BY r.id FOR UPDATE LOOP
  SELECT cleaned_at INTO cleaned FROM public.arrival_preparations WHERE reservation_id=arrival.id;
  IF cleaned IS NOT NULL AND NEW.check_out>(cleaned AT TIME ZONE 'America/Bogota')::date THEN
   PERFORM airadmin_preparation.invalidate(arrival.id,'Otra estancia interviene después de limpiar; vuelve a confirmar la preparación.',true,true);
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER arrival_preparation_intervening_stay_changed AFTER INSERT OR UPDATE OF check_in,check_out,property_id,status ON public.reservations
 FOR EACH ROW EXECUTE FUNCTION airadmin_preparation.intervening_stay_changed();
REVOKE ALL ON FUNCTION airadmin_preparation.intervening_stay_changed() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
