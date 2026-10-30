-- Solo datos sintéticos, en la base LOCAL temporal del ejecutor.
BEGIN;
CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FALLA: %',message; END IF; END $$;
-- El baseline 001 no contiene el rol anfitrion que sí usa la app actual.
ALTER TABLE public.team_members DROP CONSTRAINT team_members_role_check;
ALTER TABLE public.team_members ADD CONSTRAINT team_members_role_check CHECK(role IN ('admin','cleaning','maintenance','anfitrion'));
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-0000-0000-00000000a501'),('00000000-0000-0000-0000-00000000a502'),
 ('00000000-0000-0000-0000-00000000a503'),('00000000-0000-0000-0000-00000000a504'),('00000000-0000-0000-0000-00000000a505');
INSERT INTO public.team_members(id,name,email,role,active) VALUES
 ('00000000-0000-0000-0000-00000000a501','Admin Sintético','admin-prep@example.test','admin',true),
 ('00000000-0000-0000-0000-00000000a502','Limpieza Sintética','clean-prep@example.test','cleaning',true),
 ('00000000-0000-0000-0000-00000000a503','Mantenimiento Sintético','maint-prep@example.test','maintenance',true),
 ('00000000-0000-0000-0000-00000000a504','Anfitrión Sintético','host-prep@example.test','anfitrion',true),
 ('00000000-0000-0000-0000-00000000a505','Inactivo Sintético','inactive-prep@example.test','admin',false);
INSERT INTO public.properties(id,name,capacity) VALUES
 ('00000000-0000-0000-0000-00000000a701','Preparación Sintética A',4),
 ('00000000-0000-0000-0000-00000000a702','Preparación Sintética B',4);
INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out) VALUES
 ('00000000-0000-0000-0000-00000000a601','00000000-0000-0000-0000-00000000a701','direct','Llegada Sintética',(now() AT TIME ZONE 'America/Bogota')::date,(now() AT TIME ZONE 'America/Bogota')::date+2),
 ('00000000-0000-0000-0000-00000000a602','00000000-0000-0000-0000-00000000a702','direct','Futura Sintética',(now() AT TIME ZONE 'America/Bogota')::date+10,(now() AT TIME ZONE 'America/Bogota')::date+12);
CREATE FUNCTION pg_temp.command(step text,version int,key text,confirmed boolean DEFAULT true,reason text DEFAULT '',rid uuid DEFAULT '00000000-0000-0000-0000-00000000a601')
 RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.record_arrival_preparation(rid,step,confirmed,version,key,r.check_in,r.check_out,reason)
 FROM public.reservations r WHERE r.id=rid
$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000a502';
DO $$ DECLARE j jsonb; BEGIN
 j:=pg_temp.command('functioning',0,'before-clean');
 PERFORM pg_temp.assert_true((j->>'ok')='false','revisión sin limpieza');
 j:=pg_temp.command('cleaning',0,'clean-1');
 PERFORM pg_temp.assert_true((j->>'ok')='true' AND j#>>'{data,version}'='1' AND j#>>'{data,cleaned_name}'='Limpieza Sintética','limpieza con autor real');
 j:=pg_temp.command('cleaning',0,'clean-1');
 PERFORM pg_temp.assert_true((j->>'replayed')='true' AND j#>>'{data,version}'='1','reintento exacto');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.arrival_preparation_history WHERE reservation_id='00000000-0000-0000-0000-00000000a601'),'sin duplicar historial');
 BEGIN PERFORM pg_temp.command('functioning',0,'clean-1'); RAISE EXCEPTION 'FALLA: clave reutilizada'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM pg_temp.command('ready',1,'forbidden-ready'); RAISE EXCEPTION 'FALLA: limpieza confirmó listo'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.arrival_preparations SET ready_at=now(); RAISE EXCEPTION 'FALLA: DML directo'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.arrival_preparation_history; RAISE EXCEPTION 'FALLA: borró historial'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_arrival_preparation('00000000-0000-0000-0000-00000000a601','cleaning',false,1,'forged',current_date,current_date+2,'motivo','app','00000000-0000-0000-0000-00000000a501');
  RAISE EXCEPTION 'FALLA: suplantó autor'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000a503';
DO $$ BEGIN
 BEGIN PERFORM pg_temp.command('cleaning',1,'maint-clean'); RAISE EXCEPTION 'FALLA: mantenimiento confirmó limpieza'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.assert_true((pg_temp.command('functioning',1,'check-2')->>'ok')='true','mantenimiento confirma funcionamiento');
 BEGIN PERFORM pg_temp.command('ready',2,'maint-ready'); RAISE EXCEPTION 'FALLA: mantenimiento confirmó listo'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000a504';
SELECT pg_temp.assert_true((pg_temp.command('ready',2,'ready-3')->>'ok')='true','anfitrión confirma listo');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000a501';
INSERT INTO public.maintenance(id,property_id,title,priority,reported_by) VALUES
 ('00000000-0000-0000-0000-00000000a801','00000000-0000-0000-0000-00000000a701','Incidencia normal Sintética','normal','00000000-0000-0000-0000-00000000a501');
DO $$ DECLARE j jsonb; BEGIN
 PERFORM pg_temp.assert_true((SELECT ready_at IS NULL AND checked_at IS NOT NULL AND version=4 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000a601'),'incidencia nueva retira listo');
 j:=pg_temp.command('ready',3,'stale-ready');
 PERFORM pg_temp.assert_true((j->>'conflict')='true' AND j#>>'{current,version}'='4','conflicto devuelve estado actual');
 PERFORM pg_temp.assert_true((pg_temp.command('ready',4,'ready-normal')->>'ok')='true','normal visible no se resuelve automáticamente');
END $$;
INSERT INTO public.maintenance(id,property_id,title,priority,reported_by) VALUES
 ('00000000-0000-0000-0000-00000000a802','00000000-0000-0000-0000-00000000a701','Incidencia urgente Sintética','urgent','00000000-0000-0000-0000-00000000a501');
DO $$ BEGIN
 PERFORM pg_temp.assert_true((SELECT ready_at IS NULL AND checked_at IS NULL AND cleaned_at IS NOT NULL AND version=6 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000a601'),'urgencia exige nueva revisión');
 PERFORM pg_temp.assert_true((pg_temp.command('functioning',6,'urgent-block')->>'ok')='false','urgencia bloquea revisión');
END $$;
UPDATE public.maintenance SET status='resolved' WHERE id='00000000-0000-0000-0000-00000000a802';
SELECT pg_temp.assert_true((pg_temp.command('functioning',6,'check-7')->>'ok')='true','nueva revisión después del arreglo');
INSERT INTO public.special_requests(id,reservation_id,property_id,kind,description,due_at,created_by,updated_by)
 VALUES('00000000-0000-0000-0000-00000000a901','00000000-0000-0000-0000-00000000a601','00000000-0000-0000-0000-00000000a701','crib','Cuna Sintética',now(),'00000000-0000-0000-0000-00000000a501','00000000-0000-0000-0000-00000000a501');
SELECT pg_temp.assert_true((pg_temp.command('ready',7,'pending-crib')->>'ok')='false','solicitud pendiente bloquea listo');
UPDATE public.special_requests SET status='ready',ready_at=now(),ready_by='00000000-0000-0000-0000-00000000a501',ready_confirmation='Lista Sintética'
 WHERE id='00000000-0000-0000-0000-00000000a901';
SELECT pg_temp.assert_true((pg_temp.command('ready',7,'ready-8')->>'ok')='true','solicitud lista desbloquea');
UPDATE public.special_requests SET review_reason='Revisar Sintético' WHERE id='00000000-0000-0000-0000-00000000a901';
SELECT pg_temp.assert_true((SELECT ready_at IS NULL AND version=9 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000a601'),'solicitud por revisar retira listo');
SELECT pg_temp.assert_true((pg_temp.command('ready',9,'review-block')->>'ok')='false','solicitud lista por revisar bloquea');
UPDATE public.special_requests SET review_reason=NULL WHERE id='00000000-0000-0000-0000-00000000a901';
SELECT pg_temp.assert_true((pg_temp.command('ready',9,'ready-10')->>'ok')='true','reconfirmación expresa');
SELECT pg_temp.assert_true((pg_temp.command('cleaning',10,'empty-reason',false)->>'ok')='false','reabrir exige motivo');
SELECT pg_temp.assert_true((pg_temp.command('cleaning',10,'reopen-11',false,'Se ensució de nuevo Sintético')->>'ok')='true','reabre limpieza');
SELECT pg_temp.assert_true((SELECT cleaned_at IS NULL AND checked_at IS NULL AND ready_at IS NULL AND version=11 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000a601'),'reapertura retira etapas posteriores');
-- Cambio de fechas/apartamento y cancelación: no reutilizar ni borrar confirmaciones anteriores.
SELECT pg_temp.assert_true((pg_temp.command('cleaning',11,'clean-12')->>'ok')='true','limpieza reconfirmada');
UPDATE public.reservations SET check_in=check_in+1,check_out=check_out+1,property_id='00000000-0000-0000-0000-00000000a702' WHERE id='00000000-0000-0000-0000-00000000a601';
DO $$ DECLARE j jsonb; BEGIN
 PERFORM pg_temp.assert_true((SELECT version=13 AND cleaned_at IS NULL AND checked_at IS NULL AND ready_at IS NULL AND property_id='00000000-0000-0000-0000-00000000a702' FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000a601'),'cambio de estancia invalida');
 j:=public.record_arrival_preparation('00000000-0000-0000-0000-00000000a601','cleaning',true,11,'clean-12',(now() AT TIME ZONE 'America/Bogota')::date,(now() AT TIME ZONE 'America/Bogota')::date+2);
 PERFORM pg_temp.assert_true((j->>'conflict')='true','reintento con estancia antigua no reutiliza');
END $$;
UPDATE public.reservations SET status='cancelled' WHERE id='00000000-0000-0000-0000-00000000a601';
SELECT pg_temp.assert_true((pg_temp.command('cleaning',14,'cancelled-block')->>'conflict')='true','cancelada no se prepara');
SELECT pg_temp.assert_true((SELECT count(*)=14 FROM public.arrival_preparation_history WHERE reservation_id='00000000-0000-0000-0000-00000000a601'),'historial de todas las confirmaciones e invalidaciones');
-- Ventana de preparación y zona horaria no dependen de la configuración de la sesión.
SET LOCAL timezone='Pacific/Kiritimati';
SELECT pg_temp.assert_true((pg_temp.command('cleaning',0,'too-early',true,'','00000000-0000-0000-0000-00000000a602')->>'ok')='false','preparación demasiado anticipada');
SELECT pg_temp.assert_true(('2026-10-31T03:30:00Z'::timestamptz AT TIME ZONE 'America/Bogota')::date='2026-10-30'::date,'medianoche UTC aún es ayer en Bogotá');
SET LOCAL timezone='UTC';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000a505';
DO $$ BEGIN
 PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.arrival_preparations),'inactivo no lee preparación');
 BEGIN PERFORM pg_temp.command('cleaning',0,'inactive',true,'','00000000-0000-0000-0000-00000000a602'); RAISE EXCEPTION 'FALLA: inactivo escribe'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO public.properties(id,name,capacity) VALUES('00000000-0000-0000-0000-00000000a703','Ocupación Sintética',4);
INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out) VALUES
 ('00000000-0000-0000-0000-00000000a603','00000000-0000-0000-0000-00000000a703','direct','Saliente Sintético',(now() AT TIME ZONE 'America/Bogota')::date,(now() AT TIME ZONE 'America/Bogota')::date+1),
 ('00000000-0000-0000-0000-00000000a604','00000000-0000-0000-0000-00000000a703','direct','Entrante Sintético',(now() AT TIME ZONE 'America/Bogota')::date+1,(now() AT TIME ZONE 'America/Bogota')::date+3);
SET LOCAL ROLE service_role;
DO $$ DECLARE j jsonb; BEGIN
 BEGIN PERFORM public.record_arrival_preparation(r.id,'cleaning',true,0,'wrong-service',r.check_in,r.check_out,'','app','00000000-0000-0000-0000-00000000a501') FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000a604';
  RAISE EXCEPTION 'FALLA: servicio simuló sesión app'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_arrival_preparation(r.id,'cleaning',true,0,'wrong-mcp-actor',r.check_in,r.check_out,'','mcp','00000000-0000-0000-0000-00000000a502') FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000a604';
  RAISE EXCEPTION 'FALLA: MCP sin admin activo'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT public.record_arrival_preparation(r.id,'cleaning',true,0,'occupied',r.check_in,r.check_out,'','mcp','00000000-0000-0000-0000-00000000a501') INTO j FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000a604';
 PERFORM pg_temp.assert_true((j->>'ok')='false' AND (j->>'error') LIKE 'Otra estancia%', 'no prepara mientras otra estancia siga vigente');
 BEGIN INSERT INTO public.arrival_preparations(reservation_id,property_id,stay_check_in,stay_check_out)
  SELECT id,property_id,check_in,check_out FROM public.reservations WHERE id='00000000-0000-0000-0000-00000000a604';
  RAISE EXCEPTION 'FALLA: servicio evitó función estrecha'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.reservations SET status='cancelled' WHERE id='00000000-0000-0000-0000-00000000a603';
SET LOCAL ROLE service_role;
DO $$ DECLARE j jsonb; BEGIN
 SELECT public.record_arrival_preparation(r.id,'cleaning',true,0,'mcp-allowed',r.check_in,r.check_out,'','mcp','00000000-0000-0000-0000-00000000a501') INTO j FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000a604';
 PERFORM pg_temp.assert_true((j->>'ok')='true' AND j#>>'{data,cleaned_name}'='Admin Sintético','MCP conserva actor verificado');
END $$;
RESET ROLE;
UPDATE public.reservations SET status='confirmed' WHERE id='00000000-0000-0000-0000-00000000a603';
SELECT pg_temp.assert_true((SELECT cleaned_at IS NULL AND version=2 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000a604'),'otra estancia posterior invalida la limpieza anterior');
UPDATE public.reservations SET status='cancelled' WHERE id='00000000-0000-0000-0000-00000000a603';
SELECT pg_temp.assert_true((SELECT cleaned_at IS NULL AND version=2 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000a604'),'no reaparece limpieza al cancelar la otra estancia');
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.record_arrival_preparation('00000000-0000-0000-0000-00000000a601','cleaning',true,0,'anon',current_date,current_date+2); RAISE EXCEPTION 'FALLA: anónimo escribe'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN SELECT count(*) FROM public.arrival_preparations; RAISE EXCEPTION 'FALLA: anónimo lee'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- El propietario tampoco puede borrar accidentalmente la evidencia.
DO $$ BEGIN
 BEGIN DELETE FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000a601'; RAISE EXCEPTION 'FALLA: borrado'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.arrival_preparation_history WHERE reservation_id='00000000-0000-0000-0000-00000000a601'; RAISE EXCEPTION 'FALLA: borrado historial'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM pg_temp.assert_true((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.arrival_preparations'::regclass,'public.arrival_preparation_history'::regclass)),'RLS habilitado');
 RAISE NOTICE 'OK: preparación por etapas, permisos, historial, reintentos, conflictos, incidencias, solicitudes y cambios de estancia';
END $$;
-- Compatibilidad: ejecutar Gmail y horarios DESPUÉS de instalar los nuevos triggers.
INSERT INTO public.properties(id,name,capacity) VALUES
 ('00000000-0000-0000-0000-00000000c701','Compatibilidad Gmail Sintética',4),
 ('00000000-0000-0000-0000-00000000c702','Compatibilidad Horarios Sintética',4);
UPDATE public.gmail_sync_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE status='running';
INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out) VALUES
 ('00000000-0000-0000-0000-00000000c601','00000000-0000-0000-0000-00000000c702','direct','Horarios Sintético','2035-01-10','2035-01-13');
INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,notes) VALUES
 ('00000000-0000-0000-0000-00000000c702','00000000-0000-0000-0000-00000000c601','preparation','2035-01-09','Nota Sintética preservada');
SET LOCAL ROLE service_role;
DO $$ DECLARE started jsonb; event jsonb; receipt jsonb; rid uuid; source_time timestamptz; BEGIN
 PERFORM public.record_reservation_time('00000000-0000-0000-0000-00000000c601','checkin','authorization','16:00',0,'compatibility-time','mcp','00000000-0000-0000-0000-00000000a501',NULL,'2035-01-10','2035-01-13');
 PERFORM pg_temp.assert_true((SELECT notes='16:00|Nota Sintética preservada' FROM public.tasks WHERE reservation_id='00000000-0000-0000-0000-00000000c601'),'horarios siguen compatibles tras preparación');
 started:=public.gmail_sync_begin('00000000-0000-0000-0000-00000000c101','cron');
 PERFORM pg_temp.assert_true((started->>'busy')='false','trabajador de compatibilidad disponible');
 source_time:=(started#>>'{run,scope_to}')::timestamptz-interval '4 seconds';
 event:=jsonb_build_object('message_id','preparation-compat-confirm','kind','confirmation','source_at',source_time,'payload',
  jsonb_build_object('airbnb_code','HMPREP001','property_id','00000000-0000-0000-0000-00000000c701','guest_name','Gmail Sintético',
   'check_in','2035-01-10','check_out','2035-01-13','amount',300000,'guests',2,'notes','Nota Sintética','email_times',jsonb_build_object('facts','[]'::jsonb)));
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000c101',event);
 PERFORM pg_temp.assert_true((receipt->>'status')='applied','Gmail importa con nuevos triggers');
 rid:=(receipt->>'reservation_id')::uuid;
 PERFORM pg_temp.assert_true((SELECT count(*)=2 FROM public.tasks WHERE reservation_id=rid),'Gmail conserva sus dos tareas');
 event:=jsonb_set(jsonb_set(jsonb_set(event,'{message_id}','"preparation-compat-request"'),'{kind}','"change_request"'),'{source_at}',to_jsonb(source_time+interval '1 second'));
 event:=jsonb_set(event,'{payload,check_in_from}','"2035-01-10"');event:=jsonb_set(event,'{payload,check_in_to}','"2035-01-11"');
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000c101',event);
 PERFORM pg_temp.assert_true((receipt->>'reason')='change_requested','Gmail conserva solicitud de cambio con nuevos triggers');
 event:=jsonb_set(jsonb_set(jsonb_set(event,'{message_id}','"preparation-compat-update"'),'{kind}','"update"'),'{source_at}',to_jsonb(source_time+interval '2 seconds'));
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000c101',event);
 PERFORM pg_temp.assert_true((receipt->>'reason')='change_accepted' AND (SELECT check_in='2035-01-10'::date AND pending_change->>'accepted_at' IS NOT NULL FROM public.reservations WHERE id=rid),'Gmail acepta el cambio sin aplicar fechas por su cuenta');
 event:=jsonb_set(jsonb_set(jsonb_set(event,'{message_id}','"preparation-compat-cancel"'),'{kind}','"cancellation"'),'{source_at}',to_jsonb(source_time+interval '3 seconds'));
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000c101',event);
 PERFORM pg_temp.assert_true((receipt->>'status')='applied' AND (SELECT status='cancelled' FROM public.reservations WHERE id=rid),'Gmail cancela con nuevos triggers');
 PERFORM pg_temp.assert_true((SELECT count(*)=0 FROM public.arrival_preparations WHERE reservation_id IN (rid,'00000000-0000-0000-0000-00000000c601')),'ni Gmail ni un horario certifican preparación');
 RAISE NOTICE 'OK: Gmail importa/solicita/acepta/cancela y horarios conservan HH:MM| después de instalar preparación';
END $$;
RESET ROLE;
ROLLBACK;
