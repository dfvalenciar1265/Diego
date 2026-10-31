-- Corrige la continuación sin revivir ancestros incompletos y hace incremental el botón normal.
-- Probar con scripts/test-migrations.sh en PostgreSQL LOCAL; aplicar solo con el sí de Diego.
-- Recuperación: volver al código anterior y restaurar SOLO la definición anterior de gmail_sync_begin
-- desde 20261030153122, con aprobación; no reaplicar aquella migración entera ni borrar corridas,
-- recibos, pendientes o reservas. No hay backfill ni revisión automática de discrepancias.
BEGIN;
CREATE OR REPLACE FUNCTION public.gmail_sync_begin(p_id uuid,p_trigger text,p_days int DEFAULT NULL,p_actor uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.gmail_sync_runs; previous public.gmail_sync_runs; connection timestamptz; source_end timestamptz;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE insufficient_privilege; END IF;
 IF p_trigger NOT IN ('cron','manual') OR (p_days IS NOT NULL AND p_days NOT BETWEEN 1 AND 1825) THEN RAISE invalid_parameter_value; END IF;
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
   ORDER BY started_at DESC,id DESC LIMIT 1;
 source_end := date_trunc('second',clock_timestamp());
 IF previous.id IS NOT NULL AND NOT previous.scan_complete THEN
   INSERT INTO public.gmail_sync_runs(id,root_id,parent_id,triggered_by,actor_id,connection_version,scope_from,scope_to,next_page_cursor)
    VALUES(p_id,previous.root_id,previous.id,p_trigger,p_actor,connection,previous.scope_from,previous.scope_to,previous.next_page_cursor)
    RETURNING * INTO r;
 ELSE
   SELECT * INTO previous FROM public.gmail_sync_runs WHERE connection_version IS NOT DISTINCT FROM connection
     AND scan_complete ORDER BY scope_to DESC LIMIT 1;
   INSERT INTO public.gmail_sync_runs(id,root_id,triggered_by,actor_id,connection_version,scope_from,scope_to)
    VALUES(p_id,p_id,p_trigger,p_actor,connection,
      CASE WHEN p_trigger='manual' AND p_days IS NOT NULL THEN source_end-make_interval(days=>p_days)
           WHEN previous.id IS NOT NULL THEN previous.scope_to-interval '1 day'
           ELSE source_end-interval '7 days' END,source_end)
    RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('busy',false,'run',to_jsonb(r));
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
