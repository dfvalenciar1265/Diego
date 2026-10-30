-- Solo lectura. Ejecutar antes de autorizar las migraciones de horarios y Gmail.
-- No muestra nombres, notas, montos, credenciales ni cuerpos de correo.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT
 to_regclass('public.reservation_time_events') IS NOT NULL AS horarios_instalados,
 to_regclass('public.gmail_sync_runs') IS NOT NULL AS conciliacion_instalada,
 to_regprocedure('public.airadmin_is_admin()') IS NOT NULL AS permiso_admin_disponible,
 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='guests') AS columna_huespedes_disponible,
 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reservations' AND column_name='pending_change') AS cambios_disponibles,
 EXISTS(SELECT 1 FROM public.app_settings WHERE key='gmail_refresh_token' AND length(value)>0) AS conexion_gmail_registrada;
SELECT type AS tipo, count(*) AS grupos_repetidos, sum(cantidad) AS tareas_a_conservar
 FROM (SELECT reservation_id,type,count(*) AS cantidad FROM public.tasks
   WHERE reservation_id IS NOT NULL AND type IN ('cleaning','preparation') GROUP BY reservation_id,type HAVING count(*)>1) d GROUP BY type;
SELECT count(*) AS horarios_heredados_con_fechas_invalidas FROM public.tasks t JOIN public.reservations r ON r.id=t.reservation_id
 WHERE t.type IN ('cleaning','preparation') AND t.notes ~ '^([01][0-9]|2[0-3]):[0-5][0-9]\|' AND r.check_out<=r.check_in;
SELECT max(created_at) AS ultimo_registro_legacy FROM public.gmail_sync_log;
-- Ese registro solo indica un intento terminado. No prueba que no haya otro trabajador en curso.
ROLLBACK;
