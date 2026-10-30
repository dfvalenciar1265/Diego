\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF (SELECT count(*) FROM public.reservation_time_events WHERE source='legacy' AND reservation_id='00000000-0000-0000-0000-000000007001') <> 2 THEN RAISE EXCEPTION 'FALLA: captura heredada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reservation_time_events WHERE task_id='00000000-0000-0000-0000-000000007104' AND invalidated_at IS NOT NULL) THEN RAISE EXCEPTION 'FALLA: hora antigua heredada no conservada como inválida'; END IF;
  IF (SELECT notes FROM public.tasks WHERE id='00000000-0000-0000-0000-000000007104') <> 'Nota de estancia anterior' THEN RAISE EXCEPTION 'FALLA: hora antigua heredada siguió autorizada'; END IF;
  IF EXISTS (SELECT 1 FROM public.reservation_time_events WHERE source='legacy' AND (actor_id IS NOT NULL OR observed_at IS NOT NULL)) THEN RAISE EXCEPTION 'FALLA: inventó procedencia'; END IF;
END $$;
SET ROLE service_role;
SELECT public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','estimate','09:00',2,'eta-manual','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
SELECT public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','estimate','10:00',NULL,'email-1','gmail',NULL,'2026-10-20T22:00:00-05:00','2027-02-10','2027-02-13');
SELECT public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','authorization','13:30',4,'autorizar-1','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
-- El reintento usa la versión anterior a la respuesta perdida: debe devolver el mismo hecho.
SELECT public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','authorization','13:30',4,'autorizar-1','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.reservation_time_events WHERE reservation_id='00000000-0000-0000-0000-000000007001') <> 5 THEN RAISE EXCEPTION 'FALLA: duplicados/reintentos'; END IF;
 IF (SELECT notes FROM public.tasks WHERE id='00000000-0000-0000-0000-000000007102') <> '13:30|Cuna sintética' THEN RAISE EXCEPTION 'FALLA: proyección perdió la nota'; END IF;
 IF (SELECT notes FROM public.tasks WHERE id='00000000-0000-0000-0000-000000007101') <> '12:30|Nota sintética' THEN RAISE EXCEPTION 'FALLA: llegada pasó a salida'; END IF;
 IF (SELECT observed_at AT TIME ZONE 'America/Bogota' FROM public.reservation_time_events WHERE request_key='email-1') <> '2026-10-20 22:00:00'::timestamp THEN RAISE EXCEPTION 'FALLA: zona horaria'; END IF;
 RAISE NOTICE 'OK: procedencia, reintentos, ETA separada, notas y zona horaria';
END $$;
SET ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','authorization','12:00',4,'concurrente','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
  RAISE EXCEPTION 'FALLA: pisó versión';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','authorization','12:00',5,'autorizar-1','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
  RAISE EXCEPTION 'FALLA: reusó clave con datos distintos';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','authorization','12:00',5,'gmail-no','gmail',NULL,now(),'2027-02-10','2027-02-13');
  RAISE EXCEPTION 'FALLA: Gmail autorizó';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkout','authorization','25:00',5,'invalido','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
  RAISE EXCEPTION 'FALLA: hora inválida';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
-- Los clientes HH:MM| antiguos también quedan auditados. Nota sin cambio de hora no inventa un permiso.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
SET ROLE authenticated;
UPDATE public.tasks SET notes='12:00|Nota conservada' WHERE id='00000000-0000-0000-0000-000000007101';
UPDATE public.tasks SET notes='12:00|Otra nota' WHERE id='00000000-0000-0000-0000-000000007101';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.reservation_time_events WHERE reservation_id='00000000-0000-0000-0000-000000007001') <> 6 THEN RAISE EXCEPTION 'FALLA: compatibilidad/notas crearon permiso'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.reservation_time_events WHERE version=6 AND actor_id=auth.uid() AND source='app' AND author='Admin Sintético') THEN RAISE EXCEPTION 'FALLA: autor de tarea'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.reservation_time_events) < 6 THEN RAISE EXCEPTION 'FALLA: equipo no ve horarios'; END IF;
 BEGIN
  PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','authorization','12:00',6,'limpieza','app','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
  RAISE EXCEPTION 'FALLA: limpieza suplantó admin';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.tasks SET notes='11:30|No permitido' WHERE id='00000000-0000-0000-0000-000000007101';
  RAISE EXCEPTION 'FALLA: tarea antigua eludió permiso';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',false);
SET ROLE anon;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.reservation_time_events) <> 0 THEN RAISE EXCEPTION 'FALLA: anónimo lee horarios'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
-- Cambios de fechas invalidan hechos y proyecciones. Volver a las fechas originales no reautoriza.
UPDATE public.reservations SET check_in='2027-02-11' WHERE id='00000000-0000-0000-0000-000000007001';
UPDATE public.reservations SET check_in='2027-02-10' WHERE id='00000000-0000-0000-0000-000000007001';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.reservation_time_events WHERE reservation_id='00000000-0000-0000-0000-000000007001' AND invalidated_at IS NULL) THEN RAISE EXCEPTION 'FALLA: cambio de fechas reusó hora'; END IF;
 IF EXISTS (SELECT 1 FROM public.tasks WHERE reservation_id='00000000-0000-0000-0000-000000007001' AND notes ~ '^\d{2}:\d{2}\|') THEN RAISE EXCEPTION 'FALLA: proyección quedó vigente'; END IF;
 RAISE NOTICE 'OK: permisos, legado auditado, concurrencia optimista y cambio de fechas';
END $$;
SET ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','authorization','13:30',4,'autorizar-1','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
  RAISE EXCEPTION 'FALLA: reintento reactivó hora invalidada';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
-- La versión también cambia con la invalidación, incluso al volver a las mismas fechas.
SET ROLE service_role;
DO $$
DECLARE before_count int; v int; e jsonb;
BEGIN
 SELECT count(*) INTO before_count FROM public.reservation_time_events WHERE reservation_id='00000000-0000-0000-0000-000000007001';
 BEGIN
  PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','authorization','12:30',6,'formulario-viejo','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
  RAISE EXCEPTION 'FALLA: formulario anterior al cambio de fechas autorizó';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 -- Un correo de otra estancia se conserva invalidado y no bloquea las siguientes importaciones.
 e := public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','estimate','08:00',NULL,'email-estancia-anterior','gmail',NULL,'2026-10-20T22:00:00-05:00','2027-01-10','2027-01-13');
 IF e->>'invalidated_at' IS NULL OR e->>'stay_check_in' <> '2027-01-10' THEN RAISE EXCEPTION 'FALLA: correo viejo aplicado a estancia actual'; END IF;
 PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','estimate','08:00',NULL,'email-estancia-anterior','gmail',NULL,'2026-10-20T22:00:00-05:00','2027-01-10','2027-01-13');
 IF (SELECT count(*) FROM public.reservation_time_events WHERE reservation_id='00000000-0000-0000-0000-000000007001') <> before_count + 1 THEN RAISE EXCEPTION 'FALLA: reimportación vieja duplicada'; END IF;
 SELECT time_version INTO v FROM public.reservations WHERE id='00000000-0000-0000-0000-000000007001';
 PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkout','authorization','12:00',v,'autorizacion-nueva','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-02-10','2027-02-13');
 -- Ni siquiera el cliente de servicio escribe o borra directamente el historial.
 BEGIN
  DELETE FROM public.reservation_time_events WHERE reservation_id='00000000-0000-0000-0000-000000007001';
  RAISE EXCEPTION 'FALLA: historial borrable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  UPDATE public.reservations SET time_version=0 WHERE id='00000000-0000-0000-0000-000000007001';
  RAISE EXCEPTION 'FALLA: cliente falsificó versión';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.reservations SET status='cancelled' WHERE id='00000000-0000-0000-0000-000000007001';
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.reservation_time_events WHERE reservation_id='00000000-0000-0000-0000-000000007001' AND invalidated_at IS NULL) THEN RAISE EXCEPTION 'FALLA: cancelación mantuvo autorización'; END IF;
 IF EXISTS (SELECT 1 FROM public.tasks WHERE reservation_id='00000000-0000-0000-0000-000000007001' AND notes ~ '^\d{2}:\d{2}\|') THEN RAISE EXCEPTION 'FALLA: cancelación mantuvo proyección'; END IF;
END $$;
-- El equipo desactivado no puede consultar ni registrar.
UPDATE public.team_members SET active=false WHERE id='00000000-0000-0000-0000-0000000000d1';
SET ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.reservation_time_events) <> 0 THEN RAISE EXCEPTION 'FALLA: inactivo lee'; END IF;
 BEGIN
  PERFORM public.record_reservation_time('00000000-0000-0000-0000-000000007001','checkin','estimate','09:00',0,'inactivo','app',NULL,NULL,'2027-02-10','2027-02-13');
  RAISE EXCEPTION 'FALLA: inactivo escribe';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.team_members SET active=true WHERE id='00000000-0000-0000-0000-0000000000d1';
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN RAISE NOTICE 'OK: correo viejo visible sin aplicarse, reintentos, cancelación, versión protegida e inactivos'; END $$;
