-- Exclusivamente PostgreSQL LOCAL temporal y datos sintéticos; nunca ejecutar en Supabase.
\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE continuation_business_before AS SELECT
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.reservations r) reservations,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM public.tasks t) tasks;
UPDATE public.gmail_sync_runs SET status='interrupted',finished_at=clock_timestamp() WHERE status='running';
UPDATE public.app_settings SET value='dummy-synthetic-continuation',updated_at=clock_timestamp() WHERE key='gmail_refresh_token';
SET LOCAL ROLE service_role;
DO $$
DECLARE r jsonb; resumed jsonb; again jsonb; next_run jsonb;
 bootstrap uuid:=gen_random_uuid(); normal uuid:=gen_random_uuid(); historic uuid:=gen_random_uuid(); continuation uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid();
 admin_id uuid:='00000000-0000-0000-0000-0000000000d1';
BEGIN
 -- El botón normal sin historial usa el bootstrap acotado, no un año.
 r:=public.gmail_sync_begin(bootstrap,'manual',NULL,admin_id)->'run';
 IF (r->>'scope_to')::timestamptz-(r->>'scope_from')::timestamptz<>interval '7 days' THEN RAISE EXCEPTION 'FALLA: bootstrap anual'; END IF;
 again:=public.gmail_sync_begin(bootstrap,'manual',NULL,admin_id)->'run';
 IF again->>'id'<>bootstrap::text OR (SELECT count(*) FROM public.gmail_sync_runs WHERE id=bootstrap)<>1 THEN RAISE EXCEPTION 'FALLA: inicio duplicado'; END IF;
 PERFORM public.gmail_sync_checkpoint(bootstrap,NULL,true,'{}');PERFORM public.gmail_sync_finish(bootstrap,'complete');
 next_run:=public.gmail_sync_begin(normal,'manual',NULL,admin_id)->'run';
 IF (next_run->>'scope_from')::timestamptz<>(r->>'scope_to')::timestamptz-interval '1 day' THEN RAISE EXCEPTION 'FALLA: botón reinició el historial'; END IF;
 PERFORM public.gmail_sync_checkpoint(normal,NULL,true,'{}');PERFORM public.gmail_sync_finish(normal,'complete');
 -- Solo una petición explícita permite revisar un año; nunca se elimina su cursor.
 r:=public.gmail_sync_begin(historic,'manual',365,admin_id)->'run';
 IF (r->>'scope_to')::timestamptz-(r->>'scope_from')::timestamptz<>interval '365 days' THEN RAISE EXCEPTION 'FALLA: alcance explícito perdido'; END IF;
 PERFORM public.gmail_sync_checkpoint(historic,'cursor-sintetico-continuacion',false,'{}');PERFORM public.gmail_sync_finish(historic,'partial','source_incomplete');
 resumed:=public.gmail_sync_begin(continuation,'manual',NULL,admin_id)->'run';
 IF resumed->>'parent_id'<>historic::text OR resumed->>'root_id'<>historic::text OR resumed->>'next_page_cursor'<>'cursor-sintetico-continuacion'
   OR (resumed->>'scope_from')::timestamptz<>(r->>'scope_from')::timestamptz OR (resumed->>'scope_to')::timestamptz<>(r->>'scope_to')::timestamptz THEN
  RAISE EXCEPTION 'FALLA: continuación perdió cursor o alcance'; END IF;
 IF NOT (public.gmail_sync_begin(gen_random_uuid(),'cron')->>'busy')::boolean THEN RAISE EXCEPTION 'FALLA: trabajador simultáneo'; END IF;
 PERFORM public.gmail_sync_checkpoint(continuation,NULL,true,'{}');PERFORM public.gmail_sync_finish(continuation,'complete');
 -- Regresión crítica: existen ancestros scan_complete=false, pero su cadena terminó.
 next_run:=public.gmail_sync_begin(fresh,'cron')->'run';
 IF next_run->>'parent_id' IS NOT NULL OR next_run->>'next_page_cursor' IS NOT NULL OR next_run->>'root_id'=historic::text
   OR (next_run->>'scope_from')::timestamptz<>(r->>'scope_to')::timestamptz-interval '1 day' THEN
  RAISE EXCEPTION 'FALLA: revivió un cursor ancestral ya completado'; END IF;
 PERFORM public.gmail_sync_checkpoint(fresh,NULL,true,'{}');PERFORM public.gmail_sync_finish(fresh,'complete');
 BEGIN PERFORM public.gmail_sync_begin(gen_random_uuid(),'manual',0,admin_id); RAISE EXCEPTION 'FALLA: alcance inválido'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.gmail_sync_begin(gen_random_uuid(),'cron',NULL,admin_id); RAISE EXCEPTION 'FALLA: cron atribuido a persona'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.gmail_sync_begin(gen_random_uuid(),'manual',NULL,'00000000-0000-0000-0000-0000000000a1'); RAISE EXCEPTION 'FALLA: rol sin permiso'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.gmail_sync_begin(gen_random_uuid(),'cron'); RAISE EXCEPTION 'FALLA: anónimo inició lectura'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM continuation_business_before b WHERE b.reservations IS DISTINCT FROM
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.reservations r) OR b.tasks IS DISTINCT FROM
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM public.tasks t)) THEN RAISE EXCEPTION 'FALLA: iniciar lectura cambió negocio'; END IF;
 RAISE NOTICE 'OK: botón incremental, historial explícito, reintentos, permisos, exclusión y continuación sin ancestros obsoletos';
END $$;
ROLLBACK;
