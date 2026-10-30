-- Conciliación Gmail. Requiere la migración de horarios del PR #19.
-- Aplicar solo con aprobación de Diego. Probar antes con scripts/test-migrations.sh (Postgres local).
-- Recuperación: detener el cron frecuente y volver a la app anterior con aprobación; conservar
-- estas tablas y el historial. No borrar reservas/eventos ni retirar restricciones para forzar la migración.
BEGIN;

-- No se corrigen duplicados existentes silenciosamente: el índice exige revisión previa si los hay.
CREATE UNIQUE INDEX tasks_one_turnover_per_reservation ON public.tasks (reservation_id, type)
  WHERE reservation_id IS NOT NULL AND type IN ('cleaning', 'preparation');
ALTER TABLE public.reservations ADD COLUMN sync_manual_changed_at timestamptz;
-- No hay una fecha fiable de los ajustes anteriores. Proteger el estado existente desde este corte,
-- sin atribuirle un autor ni permitir que una relectura histórica lo sustituya.
UPDATE public.reservations SET sync_manual_changed_at=clock_timestamp();
CREATE FUNCTION public.track_manual_reservation_change() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Las funciones estrechas de Gmail escriben como propietario; app/MCP usan authenticated/service_role.
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='public.reservations'::regclass)) THEN
    IF TG_OP='INSERT' THEN NEW.sync_manual_changed_at := clock_timestamp();
    ELSE
      NEW.sync_manual_changed_at := OLD.sync_manual_changed_at;
      IF (NEW.property_id,NEW.guest_name,NEW.check_in,NEW.check_out,NEW.guests,NEW.amount,NEW.status,NEW.notes,NEW.pending_change)
         IS DISTINCT FROM (OLD.property_id,OLD.guest_name,OLD.check_in,OLD.check_out,OLD.guests,OLD.amount,OLD.status,OLD.notes,OLD.pending_change)
      THEN NEW.sync_manual_changed_at := clock_timestamp(); END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER track_manual_reservation_change BEFORE INSERT OR UPDATE ON public.reservations
 FOR EACH ROW EXECUTE FUNCTION public.track_manual_reservation_change();
REVOKE ALL ON FUNCTION public.track_manual_reservation_change() FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.gmail_sync_runs (
  id uuid PRIMARY KEY,
  root_id uuid NOT NULL,
  parent_id uuid REFERENCES public.gmail_sync_runs(id),
  triggered_by text NOT NULL CHECK(triggered_by IN ('cron','manual')),
  actor_id uuid REFERENCES public.team_members(id),
  connection_version timestamptz,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','complete','partial','failed','interrupted')),
  scope_from timestamptz NOT NULL,
  scope_to timestamptz NOT NULL,
  next_page_cursor text CHECK(length(next_page_cursor)<=8192), -- paginación, nunca credenciales
  scan_complete boolean NOT NULL DEFAULT false,
  stats jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(stats)='object'),
  error_code text,
  CHECK(scope_from<scope_to),
  CHECK((status='running')=(finished_at IS NULL)),
  CHECK(NOT scan_complete OR next_page_cursor IS NULL),
  CHECK(status<>'complete' OR scan_complete)
);
CREATE UNIQUE INDEX gmail_sync_one_worker ON public.gmail_sync_runs((status)) WHERE status='running';
CREATE INDEX gmail_sync_runs_recent ON public.gmail_sync_runs(started_at DESC);
CREATE TABLE public.gmail_sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_version timestamptz NOT NULL,
  message_id text NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK(kind IN ('confirmation','update','cancellation','change_request','unparsed')),
  source_at timestamptz,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), -- solo campos normalizados, no cuerpos/credenciales
  first_run_id uuid NOT NULL REFERENCES public.gmail_sync_runs(id),
  last_run_id uuid NOT NULL REFERENCES public.gmail_sync_runs(id),
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE RESTRICT,
  code text,
  status text NOT NULL CHECK(status IN ('applied','ignored','conflict','error','acknowledged')),
  reason text NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_by uuid REFERENCES public.team_members(id),
  reviewed_at timestamptz,
  review_note text,
  UNIQUE(connection_version,message_id),
  CHECK(status<>'acknowledged' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND coalesce(length(btrim(review_note)),0) BETWEEN 3 AND 500))
);
CREATE INDEX gmail_sync_events_pending ON public.gmail_sync_events(connection_version,status,last_attempt_at);
ALTER TABLE public.gmail_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_sync_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin reads gmail runs" ON public.gmail_sync_runs FOR SELECT TO authenticated USING(public.airadmin_is_admin());
CREATE POLICY "admin reads gmail events" ON public.gmail_sync_events FOR SELECT TO authenticated USING(public.airadmin_is_admin());
REVOKE ALL ON public.gmail_sync_runs,public.gmail_sync_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.gmail_sync_runs,public.gmail_sync_events TO authenticated,service_role;

CREATE FUNCTION public.gmail_sync_begin(p_id uuid,p_trigger text,p_days int DEFAULT 365,p_actor uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.gmail_sync_runs; previous public.gmail_sync_runs; connection timestamptz; source_end timestamptz;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE insufficient_privilege; END IF;
 IF p_trigger NOT IN ('cron','manual') OR p_days NOT BETWEEN 1 AND 1825 THEN RAISE invalid_parameter_value; END IF;
 IF (p_trigger='manual' AND NOT EXISTS(SELECT 1 FROM public.team_members WHERE id=p_actor AND role='admin' AND active))
    OR (p_trigger='cron' AND p_actor IS NOT NULL) THEN RAISE insufficient_privilege; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('airadmin.gmail-sync',0));
 SELECT * INTO r FROM public.gmail_sync_runs WHERE id=p_id;
 IF FOUND THEN RETURN jsonb_build_object('busy',r.status<>'running','run',to_jsonb(r)); END IF;
 SELECT updated_at INTO connection FROM public.app_settings WHERE key='gmail_refresh_token' AND length(value)>0;
 SELECT * INTO r FROM public.gmail_sync_runs WHERE status='running' FOR UPDATE;
 IF FOUND AND r.lease_until>clock_timestamp() AND r.connection_version IS NOT DISTINCT FROM connection THEN
   RETURN jsonb_build_object('busy',true,'run',to_jsonb(r));
 END IF;
 UPDATE public.gmail_sync_runs SET status='interrupted',finished_at=clock_timestamp(),error_code='worker_interrupted'
  WHERE status='running';
 SELECT * INTO previous FROM public.gmail_sync_runs WHERE connection_version IS NOT DISTINCT FROM connection
   AND NOT scan_complete ORDER BY started_at DESC LIMIT 1;
 source_end := date_trunc('second',clock_timestamp());
 IF previous.id IS NOT NULL THEN
   INSERT INTO public.gmail_sync_runs(id,root_id,parent_id,triggered_by,actor_id,connection_version,scope_from,scope_to,next_page_cursor)
    VALUES(p_id,previous.root_id,previous.id,p_trigger,p_actor,connection,previous.scope_from,previous.scope_to,previous.next_page_cursor)
    RETURNING * INTO r;
 ELSE
   SELECT * INTO previous FROM public.gmail_sync_runs WHERE connection_version IS NOT DISTINCT FROM connection
     AND scan_complete ORDER BY scope_to DESC LIMIT 1;
   INSERT INTO public.gmail_sync_runs(id,root_id,triggered_by,actor_id,connection_version,scope_from,scope_to)
    VALUES(p_id,p_id,p_trigger,p_actor,connection,
      CASE WHEN p_trigger='manual' THEN source_end-make_interval(days=>p_days)
           WHEN previous.id IS NOT NULL THEN previous.scope_to-interval '1 day'
           ELSE source_end-interval '7 days' END,source_end)
    RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('busy',false,'run',to_jsonb(r));
END $$;

CREATE FUNCTION public.gmail_sync_worker(p_id uuid) RETURNS public.gmail_sync_runs
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.gmail_sync_runs; connection timestamptz;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO r FROM public.gmail_sync_runs WHERE id=p_id FOR UPDATE;
 SELECT updated_at INTO connection FROM public.app_settings WHERE key='gmail_refresh_token' AND length(value)>0 FOR SHARE;
 IF r.id IS NULL OR r.status<>'running' OR r.lease_until<=clock_timestamp()
    OR r.connection_version IS DISTINCT FROM connection THEN
   RAISE EXCEPTION 'La corrida ya no tiene el turno de sincronización' USING ERRCODE='40001';
 END IF;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.gmail_sync_worker(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Toda mutación de importación y su recibo se confirman juntos; errores revierten solo ese mensaje.
CREATE FUNCTION public.gmail_sync_apply(p_run_id uuid,p_event jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 run public.gmail_sync_runs; e public.gmail_sync_events; r public.reservations; p jsonb;
 source_time timestamptz; event_kind text; event_code text; outcome text:='applied'; event_reason text:='registered';
 affected uuid; candidate_ids uuid[]; property uuid; event_name text; full_name text; pending jsonb;
 new_count int:=0; updated_count int:=0; cancelled_count int:=0; fact jsonb;
BEGIN
 run := public.gmail_sync_worker(p_run_id);
 p:=p_event->'payload'; event_kind:=p_event->>'kind'; event_code:=nullif(p->>'airbnb_code','');
 source_time:=nullif(p_event->>'source_at','')::timestamptz;
 IF jsonb_typeof(p)<>'object' OR event_kind NOT IN ('confirmation','update','cancellation','change_request','unparsed')
   OR length(coalesce(p_event->>'message_id','')) NOT BETWEEN 1 AND 200 THEN RAISE invalid_parameter_value; END IF;
 SELECT * INTO e FROM public.gmail_sync_events WHERE connection_version=run.connection_version
   AND message_id=p_event->>'message_id' FOR UPDATE;
 IF FOUND THEN
   IF e.kind<>event_kind OR e.payload<>p OR e.source_at IS DISTINCT FROM source_time THEN
     RAISE EXCEPTION 'El identificador del mensaje ya corresponde a otros datos' USING ERRCODE='22023';
   END IF;
   IF e.status IN ('applied','ignored','acknowledged') THEN RETURN to_jsonb(e); END IF;
 ELSE
   IF source_time IS NOT NULL AND (source_time<run.scope_from OR source_time>=run.scope_to) THEN
     RAISE EXCEPTION 'Mensaje fuera del alcance de lectura' USING ERRCODE='22023';
   END IF;
   INSERT INTO public.gmail_sync_events(connection_version,message_id,kind,source_at,payload,first_run_id,last_run_id,code,status,reason)
    VALUES(run.connection_version,p_event->>'message_id',event_kind,source_time,p,run.id,run.id,event_code,'error','not_processed') RETURNING * INTO e;
 END IF;
 BEGIN
   IF source_time IS NULL OR event_kind='unparsed' THEN outcome:='conflict'; event_reason:='unparsed_message';
   ELSIF event_kind IN ('confirmation','update','cancellation') THEN
     IF event_code IS NULL OR event_code !~ '^[A-Z0-9]{6,12}$' THEN outcome:='conflict'; event_reason:='missing_code';
     ELSE
       SELECT * INTO r FROM public.reservations WHERE airbnb_code=event_code FOR UPDATE;
       affected:=r.id;
       IF event_kind='confirmation' THEN
         IF EXISTS(SELECT 1 FROM public.gmail_sync_events WHERE connection_version=run.connection_version
            AND kind='cancellation' AND code=event_code AND source_at>=source_time) THEN
           outcome:='ignored'; event_reason:='cancellation_tombstone';
         ELSIF r.status='cancelled' THEN outcome:='ignored'; event_reason:='already_cancelled';
         ELSIF r.id IS NOT NULL THEN
           IF r.source<>'airbnb' OR r.property_id IS DISTINCT FROM (p->>'property_id')::uuid
             OR r.check_in IS DISTINCT FROM (p->>'check_in')::date OR r.check_out IS DISTINCT FROM (p->>'check_out')::date
             OR (p->>'guests' IS NOT NULL AND r.guests IS NOT NULL AND r.guests<>(p->>'guests')::int)
             OR r.amount IS DISTINCT FROM (p->>'amount')::numeric THEN outcome:='conflict'; event_reason:='reservation_differs';
           ELSE
             -- Solo completa un dato ausente y anterior al último ajuste manual, nunca sustituye datos.
             IF r.guests IS NULL AND p->>'guests' IS NOT NULL AND (r.sync_manual_changed_at IS NULL OR source_time>r.sync_manual_changed_at) THEN
               UPDATE public.reservations SET guests=(p->>'guests')::int WHERE id=r.id;
             END IF;
             event_reason:='already_present';
           END IF;
         ELSIF EXISTS(SELECT 1 FROM public.reservations WHERE property_id=(p->>'property_id')::uuid
             AND status IN ('confirmed','blocked') AND check_in<(p->>'check_out')::date AND check_out>(p->>'check_in')::date) THEN
           outcome:='conflict'; event_reason:='stay_overlap';
         ELSE
           IF (p->>'check_out')::date<=(p->>'check_in')::date OR length(p->>'guest_name') NOT BETWEEN 1 AND 200
             OR (p->>'amount')::numeric<0 THEN RAISE invalid_parameter_value; END IF;
           INSERT INTO public.reservations(property_id,source,guest_name,check_in,check_out,amount,guests,notes,status,airbnb_code)
            VALUES((p->>'property_id')::uuid,'airbnb',p->>'guest_name',(p->>'check_in')::date,(p->>'check_out')::date,
             (p->>'amount')::numeric,(p->>'guests')::int,replace(left(coalesce(p->>'notes',''),2000),'|','·'),'confirmed',event_code)
            ON CONFLICT(airbnb_code) DO NOTHING RETURNING * INTO r;
           IF r.id IS NULL THEN outcome:='conflict'; event_reason:='concurrent_reservation';
           ELSE affected:=r.id; new_count:=1; event_reason:='reservation_imported'; END IF;
         END IF;
         IF outcome='applied' AND r.id IS NOT NULL AND r.status='confirmed' THEN
           FOR fact IN SELECT * FROM jsonb_array_elements(coalesce(p->'email_times'->'facts','[]'::jsonb)) LOOP
             IF fact->>'kind' NOT IN ('estimate','platform') THEN RAISE invalid_parameter_value; END IF;
             PERFORM public.record_reservation_time(r.id,fact->>'direction',fact->>'kind',fact->>'time',NULL,
               e.message_id||':'||(fact->>'direction')||':'||(fact->>'kind'),'gmail',NULL,source_time,(p->>'check_in')::date,(p->>'check_out')::date);
           END LOOP;
         END IF;
       ELSIF event_kind='cancellation' THEN
         IF r.id IS NULL THEN outcome:='conflict'; event_reason:='cancellation_without_reservation';
         ELSIF r.status='cancelled' THEN outcome:='ignored'; event_reason:='already_cancelled';
         ELSIF r.sync_manual_changed_at IS NOT NULL AND source_time<=r.sync_manual_changed_at THEN outcome:='conflict'; event_reason:='manual_change_after_email';
         ELSE
           UPDATE public.reservations SET status='cancelled' WHERE id=r.id;
           DELETE FROM public.tasks WHERE reservation_id=r.id;
           cancelled_count:=1; event_reason:='cancellation_confirmed';
         END IF;
       ELSE
         IF r.id IS NULL THEN outcome:='conflict'; event_reason:='reservation_not_found';
         ELSIF r.status='cancelled' THEN outcome:='ignored'; event_reason:='already_cancelled';
         ELSIF r.sync_manual_changed_at IS NOT NULL AND source_time<=r.sync_manual_changed_at THEN outcome:='conflict'; event_reason:='manual_change_after_email';
         ELSIF r.pending_change IS NULL THEN outcome:='conflict'; event_reason:='change_details_missing';
         ELSIF source_time<(r.pending_change->>'requested_at')::timestamptz THEN outcome:='ignored'; event_reason:='older_update';
         ELSIF r.pending_change->>'accepted_at' IS NOT NULL THEN outcome:='ignored'; event_reason:='already_accepted';
         ELSE
           UPDATE public.reservations SET pending_change=jsonb_set(r.pending_change,'{accepted_at}',to_jsonb(source_time)) WHERE id=r.id;
           updated_count:=1; event_reason:='change_accepted';
         END IF;
       END IF;
     END IF;
   ELSE
     -- Solicitudes sin código: apartamento y huésped completos; nunca se emparejan solo por nombre.
     property:=nullif(p->>'property_id','')::uuid;
     IF property IS NULL THEN
       SELECT array_agg(id) INTO candidate_ids FROM public.properties WHERE position(lower(name) in lower(coalesce(p->>'property_name','')))>0;
       IF cardinality(candidate_ids)=1 THEN property:=candidate_ids[1]; END IF;
     END IF;
     IF property IS NULL THEN outcome:='conflict'; event_reason:='property_not_found';
     ELSE
       event_name:=translate(lower(btrim(coalesce(p->>'guest_name',''))),'áéíóúüñ','aeiouun');
       SELECT array_agg(id) INTO candidate_ids FROM public.reservations WHERE property_id=property AND status='confirmed'
         AND check_out>=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date
         AND (translate(lower(guest_name),'áéíóúüñ','aeiouun')=event_name OR
           left(translate(lower(guest_name),'áéíóúüñ','aeiouun'),length(event_name)+1)=event_name||' ')
         AND (p->>'check_in_from' IS NULL OR check_in=(p->>'check_in_from')::date)
         AND (p->>'check_out_from' IS NULL OR check_out=(p->>'check_out_from')::date)
         AND (p->>'guests_from' IS NULL OR guests=(p->>'guests_from')::int);
       IF coalesce(cardinality(candidate_ids),0)<>1 OR length(event_name)=0 THEN outcome:='conflict'; event_reason:='ambiguous_stay';
       ELSE
         SELECT * INTO r FROM public.reservations WHERE id=candidate_ids[1] FOR UPDATE; affected:=r.id;
         IF r.sync_manual_changed_at IS NOT NULL AND source_time<=r.sync_manual_changed_at THEN outcome:='conflict'; event_reason:='manual_change_after_email';
         ELSIF r.pending_change IS NOT NULL AND (r.pending_change->>'requested_at')::timestamptz>=source_time THEN outcome:='ignored'; event_reason:='older_request';
         ELSE
           pending:=p-ARRAY['property_id','property_name','guest_name','airbnb_code'];
           pending:=pending||jsonb_build_object('requested_at',source_time,'accepted_at',NULL,'description',left(coalesce(p->>'change_description','Cambio solicitado'),500));
           UPDATE public.reservations SET pending_change=pending WHERE id=r.id;
           updated_count:=1; event_reason:='change_requested';
         END IF;
       END IF;
     END IF;
   END IF;
   IF outcome='applied' AND r.id IS NOT NULL AND r.status='confirmed' AND event_kind='confirmation'
      AND r.check_out>=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date THEN
     INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,notes)
      VALUES(r.property_id,r.id,'cleaning',r.check_out,'Limpieza post-estadía — '||r.guest_name)
      ON CONFLICT(reservation_id,type) WHERE reservation_id IS NOT NULL AND type IN ('cleaning','preparation') DO NOTHING;
     IF r.check_in>=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date THEN
       INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,notes)
        VALUES(r.property_id,r.id,'preparation',greatest(r.check_in-1,(clock_timestamp() AT TIME ZONE 'America/Bogota')::date),'Preparación para '||r.guest_name)
        ON CONFLICT(reservation_id,type) WHERE reservation_id IS NOT NULL AND type IN ('cleaning','preparation') DO NOTHING;
     END IF;
   END IF;
 EXCEPTION WHEN OTHERS THEN
   -- No se guardan errores crudos, cuerpos de correo ni valores de parámetros.
   outcome:='error'; event_reason:='database_write_failed';
   IF NOT EXISTS(SELECT 1 FROM public.reservations WHERE id=affected) THEN affected:=NULL; END IF;
   new_count:=0;updated_count:=0;cancelled_count:=0;
 END;
 UPDATE public.gmail_sync_events SET status=outcome,reason=event_reason,last_run_id=run.id,reservation_id=affected,
   last_attempt_at=clock_timestamp(),
   version=version+CASE WHEN (status,reason,reservation_id) IS DISTINCT FROM (outcome,event_reason,affected) THEN 1 ELSE 0 END,
   updated_at=CASE WHEN (status,reason,reservation_id) IS DISTINCT FROM (outcome,event_reason,affected) THEN clock_timestamp() ELSE updated_at END
   WHERE id=e.id RETURNING * INTO e;
 UPDATE public.gmail_sync_runs SET stats=stats||jsonb_build_object(
   'new_count',coalesce((stats->>'new_count')::int,0)+new_count,
   'updated_count',coalesce((stats->>'updated_count')::int,0)+updated_count,
   'cancelled_count',coalesce((stats->>'cancelled_count')::int,0)+cancelled_count) WHERE id=run.id;
 RETURN to_jsonb(e);
END $$;

CREATE FUNCTION public.gmail_sync_checkpoint(p_id uuid,p_cursor text,p_complete boolean,p_stats jsonb DEFAULT '{}')
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.gmail_sync_worker(p_id);
 IF p_complete IS NULL OR (p_complete AND p_cursor IS NOT NULL) OR length(p_cursor)>8192
    OR p_stats IS NULL OR jsonb_typeof(p_stats)<>'object' THEN RAISE invalid_parameter_value; END IF;
 UPDATE public.gmail_sync_runs SET next_page_cursor=p_cursor,scan_complete=p_complete,
  stats=stats||jsonb_build_object('threads_fetched',coalesce((p_stats->>'threads_fetched')::int,0),
   'messages_seen',coalesce((p_stats->>'messages_seen')::int,0),'pages_fetched',coalesce((p_stats->>'pages_fetched')::int,0)) WHERE id=p_id;
END $$;
CREATE FUNCTION public.gmail_sync_maintenance(p_id uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations; today date:=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date; added int:=0; n int; dropped int; closed int;
BEGIN
 PERFORM public.gmail_sync_worker(p_id);
 FOR r IN SELECT * FROM public.reservations WHERE status='confirmed' AND check_out>=today ORDER BY id FOR UPDATE LOOP
   INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,notes)
    VALUES(r.property_id,r.id,'cleaning',r.check_out,'Limpieza post-estadía — '||r.guest_name)
    ON CONFLICT(reservation_id,type) WHERE reservation_id IS NOT NULL AND type IN ('cleaning','preparation') DO NOTHING;
   GET DIAGNOSTICS n=ROW_COUNT; added:=added+n;
   IF r.check_in>=today THEN
     INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,notes)
      VALUES(r.property_id,r.id,'preparation',greatest(today,r.check_in-1),'Preparación para '||r.guest_name)
      ON CONFLICT(reservation_id,type) WHERE reservation_id IS NOT NULL AND type IN ('cleaning','preparation') DO NOTHING;
     GET DIAGNOSTICS n=ROW_COUNT; added:=added+n;
   END IF;
 END LOOP;
 DELETE FROM public.tasks WHERE type='cleaning' AND status='pending' AND scheduled_for<today;
 GET DIAGNOSTICS dropped=ROW_COUNT;
 UPDATE public.tasks SET status='done',completed_at=clock_timestamp() WHERE type<>'preparation'
   AND status IN ('pending','in_progress') AND scheduled_for<today;
 GET DIAGNOSTICS closed=ROW_COUNT;
 UPDATE public.gmail_sync_runs SET stats=stats||jsonb_build_object('repaired_tasks',added,'dropped_cleanings',dropped,'completed_tasks',closed) WHERE id=p_id;
END $$;
CREATE FUNCTION public.gmail_sync_finish(p_id uuid,p_status text,p_error text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.gmail_sync_runs; pending int;
BEGIN
 r:=public.gmail_sync_worker(p_id);
 IF p_status NOT IN ('complete','partial','failed') OR (p_error IS NOT NULL AND p_error NOT IN
  ('gmail_unavailable','not_connected','source_incomplete','database_error','deadline','invalid_cursor')) THEN RAISE invalid_parameter_value; END IF;
 SELECT count(*) INTO pending FROM public.gmail_sync_events WHERE connection_version=r.connection_version AND status IN ('conflict','error');
 IF p_status='complete' AND (NOT r.scan_complete OR pending>0) THEN p_status:='partial'; END IF;
 UPDATE public.gmail_sync_runs SET status=p_status,finished_at=clock_timestamp(),error_code=p_error WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.gmail_sync_log(triggered_by,new_count,error) VALUES(r.triggered_by,coalesce((r.stats->>'new_count')::int,0),
   CASE WHEN r.status<>'complete' THEN 'Importación incompleta: revisar conciliación de Gmail' END);
 RETURN to_jsonb(r)||jsonb_build_object('pending_count',pending);
END $$;
CREATE FUNCTION public.gmail_sync_review(p_id uuid,p_version int,p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.gmail_sync_events;
BEGIN
 IF auth.uid() IS NULL OR NOT public.airadmin_is_admin() THEN RAISE insufficient_privilege; END IF;
 IF p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 3 AND 500 THEN RAISE invalid_parameter_value; END IF;
 SELECT * INTO e FROM public.gmail_sync_events WHERE id=p_id FOR UPDATE;
 IF e.id IS NULL OR e.version<>p_version OR e.status NOT IN ('conflict','error') THEN RAISE serialization_failure; END IF;
 UPDATE public.gmail_sync_events SET status='acknowledged',reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),
  review_note=btrim(p_note),version=version+1,updated_at=clock_timestamp() WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.gmail_sync_begin(uuid,text,int,uuid), public.gmail_sync_apply(uuid,jsonb),
 public.gmail_sync_checkpoint(uuid,text,boolean,jsonb),public.gmail_sync_maintenance(uuid),public.gmail_sync_finish(uuid,text,text),public.gmail_sync_review(uuid,int,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gmail_sync_begin(uuid,text,int,uuid),public.gmail_sync_apply(uuid,jsonb),
 public.gmail_sync_checkpoint(uuid,text,boolean,jsonb),public.gmail_sync_maintenance(uuid),public.gmail_sync_finish(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.gmail_sync_review(uuid,int,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
