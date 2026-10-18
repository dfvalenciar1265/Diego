-- ─────────────────────────────────────────────────────────────────────────────
-- PROPUESTA, NO APLICADA — programar /api/calendar-sync cada 5 minutos desde Supabase.
--
-- Por qué aquí y no en vercel.json: el cron de Vercel en plan Hobby solo corre una vez al día
-- (hoy vercel.json tiene la sincronización de Gmail a diario). El sitio exige datos de máximo
-- 900 s, así que hace falta algo cada ≤ 10 min. pg_cron + pg_net vienen en todos los planes de
-- Supabase. Alternativa equivalente si el proyecto de Vercel es Pro: agregar en vercel.json
--   { "path": "/api/calendar-sync", "schedule": "*/5 * * * *" }
--
-- Antes de correr esto (en el SQL Editor de Supabase, por Diego):
--   1. Database → Extensions: activar pg_cron y pg_net.
--   2. Guardar el secreto en Vault SIN pegarlo en el repositorio ni en un chat:
--        select vault.create_secret('<valor de CRON_SECRET de Vercel>', 'calendar_sync_cron_secret');
--      (escribirlo directamente en el SQL Editor y no guardar la consulta).
-- ─────────────────────────────────────────────────────────────────────────────

SELECT cron.schedule(
  'casa-blue-calendar-sync',
  '*/5 * * * *',
  $$
  SELECT net.http_get(
    url := 'https://diegoprueba.vercel.app/api/calendar-sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'calendar_sync_cron_secret')
    ),
    timeout_milliseconds := 25000
  );
  $$
);

-- Revisar:   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--            SELECT status, verified, data_as_of, error FROM calendar_sync_runs ORDER BY created_at DESC LIMIT 10;
-- Detener:   SELECT cron.unschedule('casa-blue-calendar-sync');
