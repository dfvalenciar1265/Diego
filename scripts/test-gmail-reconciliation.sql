-- Solo datos sintéticos en la base temporal local. Nunca ejecutar en Supabase.
\set ON_ERROR_STOP 1
INSERT INTO public.app_settings(key,value) VALUES('gmail_refresh_token','dummy-synthetic-value')
 ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=clock_timestamp();
SET ROLE service_role;
DO $$ DECLARE finished jsonb; BEGIN
 PERFORM public.gmail_sync_begin('00000000-0000-0000-0000-00000000a120','cron');
 PERFORM public.gmail_sync_checkpoint('00000000-0000-0000-0000-00000000a120',NULL,true,'{}');
 PERFORM public.gmail_sync_maintenance('00000000-0000-0000-0000-00000000a120');
 PERFORM public.gmail_sync_maintenance('00000000-0000-0000-0000-00000000a120');
 finished:=public.gmail_sync_finish('00000000-0000-0000-0000-00000000a120','complete');
 IF finished->>'status'<>'partial' OR (finished->'stats'->>'duplicate_task_groups')::int<>3 OR (finished->>'pending_count')::int<>0 THEN
  RAISE EXCEPTION 'FALLA: duplicados heredados invisibles o corrida certificada %',finished;
 END IF;
 BEGIN
  INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,notes) VALUES
   ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a201','cleaning','2032-06-23','No debe duplicarse');
  RAISE EXCEPTION 'FALLA: nueva copia de tarea heredada';
 EXCEPTION WHEN unique_violation THEN NULL;END;
 -- Cambiar una tarea a una identidad ya ocupada también se rechaza y revierte el movimiento.
 BEGIN
  UPDATE public.tasks SET reservation_id='00000000-0000-0000-0000-00000000a201'
    WHERE reservation_id='00000000-0000-0000-0000-00000000a202' AND notes='Nota sintética C';
  RAISE EXCEPTION 'FALLA: movimiento duplicó una tarea';
 EXCEPTION WHEN unique_violation THEN NULL;END;
 -- Se permite editar la tarea existente sin crear otra identidad, incluso si es heredada.
 UPDATE public.tasks SET notes=notes,reservation_id=reservation_id,type=type WHERE reservation_id='00000000-0000-0000-0000-00000000a201';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tasks t WHERE id IN (SELECT id FROM public.test_gmail_legacy_snapshot))
    IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.test_gmail_legacy_snapshot t) THEN
  RAISE EXCEPTION 'FALLA: migración o mantenimiento alteró notas/estado/asignación/fechas heredadas';
 END IF;
 RAISE NOTICE 'OK: migración con duplicados previos, historial íntegro y revisión visible';
END $$;
SET ROLE service_role;
DO $$
DECLARE started jsonb; busy jsonb; event jsonb; receipt jsonb; finished jsonb; runid uuid:='00000000-0000-0000-0000-00000000a101'; rid uuid; n int; v int;
BEGIN
 started:=public.gmail_sync_begin(runid,'cron',365,NULL);
 busy:=public.gmail_sync_begin('00000000-0000-0000-0000-00000000a102','cron',365,NULL);
 IF NOT (busy->>'busy')::boolean THEN RAISE EXCEPTION 'FALLA: dos trabajadores activos'; END IF;
 event:=jsonb_build_object('message_id','synthetic-confirmation','kind','confirmation','source_at',clock_timestamp()-interval '1 hour',
  'payload',jsonb_build_object('airbnb_code','HMSYNC0001','property_id','00000000-0000-0000-0000-0000000013a3','guest_name','Huésped Sintético Gmail',
    'check_in','2030-12-20','check_out','2030-12-23','amount',300000,'guests',2,'notes','Nota | sintética','email_times',jsonb_build_object('facts','[]'::jsonb)));
 receipt:=public.gmail_sync_apply(runid,event);
 IF receipt->>'status'<>'applied' OR receipt->>'reason'<>'reservation_imported' THEN RAISE EXCEPTION 'FALLA: importación %',receipt; END IF;
 rid:=(receipt->>'reservation_id')::uuid;
 IF (SELECT notes LIKE '%|%' FROM public.reservations WHERE id=rid) THEN RAISE EXCEPTION 'FALLA: notas con separador de horas'; END IF;
 PERFORM public.gmail_sync_apply(runid,event);
 IF (SELECT count(*) FROM public.reservations WHERE airbnb_code='HMSYNC0001')<>1 THEN RAISE EXCEPTION 'FALLA: reserva duplicada'; END IF;
 IF (SELECT count(*) FROM public.tasks WHERE reservation_id=rid)<>2 THEN RAISE EXCEPTION 'FALLA: tareas duplicadas'; END IF;
 IF (SELECT (stats->>'new_count')::int FROM public.gmail_sync_runs WHERE id=runid)<>1 THEN RAISE EXCEPTION 'FALLA: reintento contó dos veces'; END IF;
 BEGIN
  PERFORM public.gmail_sync_apply(runid,jsonb_set(event,'{payload,amount}','400000'));
  RAISE EXCEPTION 'FALLA: mismo mensaje con datos distintos';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- Una discrepancia no cambia fechas, dinero ni huéspedes.
 event:=jsonb_set(event,'{message_id}','"synthetic-conflict"');event:=jsonb_set(event,'{payload,amount}','400000');
 receipt:=public.gmail_sync_apply(runid,event);
 IF receipt->>'status'<>'conflict' OR (SELECT amount FROM public.reservations WHERE id=rid)<>300000 THEN RAISE EXCEPTION 'FALLA: conflicto sobrescribió dinero'; END IF;
 v:=(receipt->>'version')::int;
 receipt:=public.gmail_sync_apply(runid,event);
 IF (receipt->>'version')::int<>v THEN RAISE EXCEPTION 'FALLA: relectura sin cambio alteró versión'; END IF;
 -- Una página sin terminar no certifica la lectura aunque no haya datos nuevos.
 PERFORM public.gmail_sync_checkpoint(runid,'cursor-sintetico',false,'{"threads_fetched":2,"messages_seen":2,"pages_fetched":1}');
 finished:=public.gmail_sync_finish(runid,'complete');
 IF finished->>'status'<>'partial' OR (finished->>'scan_complete')::boolean THEN RAISE EXCEPTION 'FALLA: certificó lectura incompleta'; END IF;
 started:=public.gmail_sync_begin('00000000-0000-0000-0000-00000000a103','manual',365,'00000000-0000-0000-0000-0000000000d1');
 IF started->'run'->>'next_page_cursor'<>'cursor-sintetico' OR started->'run'->>'scope_to'<>(SELECT scope_to::text FROM public.gmail_sync_runs WHERE id=runid) THEN
  -- Comparar instantes, no representaciones textuales de zona horaria.
  IF (started->'run'->>'scope_to')::timestamptz<>(SELECT scope_to FROM public.gmail_sync_runs WHERE id=runid) THEN RAISE EXCEPTION 'FALLA: reanudación cambió alcance'; END IF;
 END IF;
 IF started->'run'->>'next_page_cursor'<>'cursor-sintetico' THEN RAISE EXCEPTION 'FALLA: cursor perdido'; END IF;
 BEGIN PERFORM public.gmail_sync_apply(runid,event);RAISE EXCEPTION 'FALLA: trabajador anterior escribió';EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM public.gmail_sync_checkpoint('00000000-0000-0000-0000-00000000a103',NULL,true,'{}');
 PERFORM public.gmail_sync_finish('00000000-0000-0000-0000-00000000a103','complete');
 RAISE NOTICE 'OK: exclusión, recibos idempotentes, conflictos visibles, cursor y alcance conservados';
END $$;
RESET ROLE;
-- Revisión optimista: guarda constancia; no cambia una reserva ni finge haber importado el correo.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
SET ROLE authenticated;
DO $$ DECLARE e public.gmail_sync_events; BEGIN
 SELECT * INTO e FROM public.gmail_sync_events WHERE message_id='synthetic-conflict';
 BEGIN PERFORM public.gmail_sync_review(e.id,e.version,NULL);RAISE EXCEPTION 'FALLA: revisión sin nota';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM public.gmail_sync_review(e.id,e.version,'Se revisó el caso sintético; conservar la app.');
 BEGIN PERFORM public.gmail_sync_review(e.id,e.version,'Reintento viejo');RAISE EXCEPTION 'FALLA: revisión vieja sobrescribió';EXCEPTION WHEN serialization_failure THEN NULL;END;
 IF (SELECT amount FROM public.reservations WHERE airbnb_code='HMSYNC0001')<>300000 THEN RAISE EXCEPTION 'FALLA: revisar modificó la reserva'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
SET ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.gmail_sync_runs)<>0 OR (SELECT count(*) FROM public.gmail_sync_events)<>0 THEN RAISE EXCEPTION 'FALLA: limpieza ve conciliación'; END IF;
 BEGIN PERFORM public.gmail_sync_begin(gen_random_uuid(),'cron');RAISE EXCEPTION 'FALLA: limpieza inició corrida';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.gmail_sync_review(gen_random_uuid(),1,'No permitido');RAISE EXCEPTION 'FALLA: limpieza revisó';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',false);
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.gmail_sync_begin(gen_random_uuid(),'cron');RAISE EXCEPTION 'FALLA: anónimo inició';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'OK: revisión con autor/nota/versión y permisos por rol'; END $$;
-- Los cambios de app/MCP marcan su momento y no permiten falsificarlo.
SET ROLE service_role;
UPDATE public.reservations SET check_in='2030-12-21',sync_manual_changed_at=NULL WHERE airbnb_code='HMSYNC0001';
RESET ROLE;
DO $$ BEGIN
 IF (SELECT sync_manual_changed_at IS NULL FROM public.reservations WHERE airbnb_code='HMSYNC0001') THEN RAISE EXCEPTION 'FALLA: ajuste manual sin marca'; END IF;
END $$;
SET ROLE service_role;
DO $$
DECLARE runid uuid:='00000000-0000-0000-0000-00000000a104'; receipt jsonb; event jsonb; first_event jsonb; rid uuid;
BEGIN
 PERFORM public.gmail_sync_begin(runid,'cron');
 receipt:=public.gmail_sync_apply(runid,jsonb_build_object('message_id','synthetic-old-cancellation','kind','cancellation',
   'source_at',clock_timestamp()-interval '1 hour','payload',jsonb_build_object('airbnb_code','HMSYNC0001')));
 IF receipt->>'reason'<>'manual_change_after_email' OR (SELECT status FROM public.reservations WHERE airbnb_code='HMSYNC0001')<>'confirmed' THEN RAISE EXCEPTION 'FALLA: correo viejo anuló ajuste manual'; END IF;
 first_event:=jsonb_build_object('message_id','synthetic-to-cancel','kind','confirmation','source_at',clock_timestamp()-interval '2 hours',
   'payload',jsonb_build_object('airbnb_code','HMSYNC0002','property_id','00000000-0000-0000-0000-0000000013a3','guest_name','Cancelación Sintético',
     'check_in','2031-01-20','check_out','2031-01-23','amount',300000,'guests',2));
 receipt:=public.gmail_sync_apply(runid,first_event);rid:=(receipt->>'reservation_id')::uuid;
 IF receipt->>'status'<>'applied' THEN RAISE EXCEPTION 'FALLA: caso cancelación %',receipt;END IF;
 event:=jsonb_build_object('message_id','synthetic-explicit-cancel','kind','cancellation','source_at',clock_timestamp()-interval '1 hour',
    'payload',jsonb_build_object('airbnb_code','HMSYNC0002'));
 PERFORM public.gmail_sync_apply(runid,event);PERFORM public.gmail_sync_apply(runid,event);
 IF (SELECT status FROM public.reservations WHERE id=rid)<>'cancelled' OR EXISTS(SELECT 1 FROM public.tasks WHERE reservation_id=rid) THEN RAISE EXCEPTION 'FALLA: cancelación sin conservar reserva/retirar tareas';END IF;
 IF (SELECT (stats->>'cancelled_count')::int FROM public.gmail_sync_runs WHERE id=runid)<>1 THEN RAISE EXCEPTION 'FALLA: cancelación contada dos veces';END IF;
 receipt:=public.gmail_sync_apply(runid,jsonb_set(first_event,'{message_id}','"synthetic-after-cancel"'));
 IF receipt->>'status'<>'ignored' THEN RAISE EXCEPTION 'FALLA: confirmación resucitó cancelación';END IF;
 -- Cancelación que llega antes de la confirmación: nunca crear después esa estancia antigua.
 event:=jsonb_set(event,'{message_id}','"synthetic-cancel-before-confirm"');event:=jsonb_set(event,'{payload,airbnb_code}','"HMSYNC0003"');
 receipt:=public.gmail_sync_apply(runid,event);
 IF receipt->>'reason'<>'cancellation_without_reservation' THEN RAISE EXCEPTION 'FALLA: cancelación desconocida no visible';END IF;
 first_event:=jsonb_set(first_event,'{message_id}','"synthetic-before-confirm"');first_event:=jsonb_set(first_event,'{payload,airbnb_code}','"HMSYNC0003"');
 receipt:=public.gmail_sync_apply(runid,first_event);
 IF receipt->>'reason'<>'cancellation_tombstone' OR EXISTS(SELECT 1 FROM public.reservations WHERE airbnb_code='HMSYNC0003') THEN RAISE EXCEPTION 'FALLA: importó cancelación anterior';END IF;
 -- Una actualización sin código no toma la hora ni la estancia de otro huésped.
 receipt:=public.gmail_sync_apply(runid,jsonb_build_object('message_id','synthetic-update-no-code','kind','update',
  'source_at',clock_timestamp()-interval '1 hour','payload',jsonb_build_object('guest_name','Cancelación Sintético')));
 IF receipt->>'reason'<>'missing_code' THEN RAISE EXCEPTION 'FALLA: actualización ambigua aplicada';END IF;
 PERFORM public.gmail_sync_checkpoint(runid,NULL,true,'{}');PERFORM public.gmail_sync_finish(runid,'complete');
 RAISE NOTICE 'OK: cambios manuales/fechas, cancelación explícita, reintentos y sin resurrección';
END $$;
RESET ROLE;
-- Fallo después de insertar la reserva: no queda un efecto a medias ni un contador inflado.
CREATE FUNCTION public.test_gmail_task_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.notes LIKE '%Fallo Sintético%' THEN RAISE EXCEPTION 'Fallo sintético de tareas';END IF;RETURN NEW;END $$;
CREATE TRIGGER test_gmail_task_failure BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.test_gmail_task_failure();
SET ROLE service_role;
DO $$ DECLARE receipt jsonb; BEGIN
 PERFORM public.gmail_sync_begin('00000000-0000-0000-0000-00000000a105','cron');
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000a105',jsonb_build_object('message_id','synthetic-sql-retry','kind','confirmation',
  'source_at',date_trunc('second',clock_timestamp()-interval '1 hour'),'payload',jsonb_build_object('airbnb_code','HMSYNC0004','property_id','00000000-0000-0000-0000-0000000013a3',
  'guest_name','Fallo Sintético','check_in','2031-02-20','check_out','2031-02-23','amount',200000,'guests',2)));
 IF receipt->>'reason'<>'database_write_failed' OR receipt->>'reservation_id' IS NOT NULL OR EXISTS(SELECT 1 FROM public.reservations WHERE airbnb_code='HMSYNC0004') THEN RAISE EXCEPTION 'FALLA: efecto SQL parcial %',receipt;END IF;
END $$;
RESET ROLE;
DROP TRIGGER test_gmail_task_failure ON public.tasks;DROP FUNCTION public.test_gmail_task_failure();
SET ROLE service_role;
DO $$ DECLARE receipt jsonb; event jsonb; BEGIN
 SELECT jsonb_build_object('message_id',message_id,'kind',kind,'source_at',source_at,'payload',payload) INTO event FROM public.gmail_sync_events WHERE message_id='synthetic-sql-retry';
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000a105',event);
 IF receipt->>'status'<>'applied' OR (SELECT count(*) FROM public.reservations WHERE airbnb_code='HMSYNC0004')<>1 THEN RAISE EXCEPTION 'FALLA: reintento no recuperó el fallo';END IF;
 IF (SELECT (stats->>'new_count')::int FROM public.gmail_sync_runs WHERE id='00000000-0000-0000-0000-00000000a105')<>1 THEN RAISE EXCEPTION 'FALLA: contador SQL incorrecto tras recuperar';END IF;
 PERFORM public.gmail_sync_checkpoint('00000000-0000-0000-0000-00000000a105',NULL,true,'{}');PERFORM public.gmail_sync_finish('00000000-0000-0000-0000-00000000a105','complete');
 RAISE NOTICE 'OK: reversión atómica por mensaje y reintento SQL tras fallo de tareas';
END $$;
RESET ROLE;
-- Caducidad y cambio de conexión cercan al trabajador anterior.
SET ROLE service_role;
DO $$ DECLARE receipt jsonb; accepted jsonb; requested jsonb; rid uuid; BEGIN
 PERFORM public.gmail_sync_begin('00000000-0000-0000-0000-00000000a109','cron');
 SELECT id INTO rid FROM public.reservations WHERE airbnb_code='HMSYNC0004';
 accepted:=jsonb_build_object('message_id','synthetic-accepted-first','kind','update','source_at',date_trunc('second',clock_timestamp()-interval '1 hour'),
   'payload',jsonb_build_object('airbnb_code','HMSYNC0004'));
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000a109',accepted);
 IF receipt->>'reason'<>'change_details_missing' THEN RAISE EXCEPTION 'FALLA: aceptación sin detalles aplicada';END IF;
 requested:=jsonb_build_object('message_id','synthetic-request-later-page','kind','change_request','source_at',clock_timestamp()-interval '2 hours',
   'payload',jsonb_build_object('property_id','00000000-0000-0000-0000-0000000013a3','guest_name','Fallo Sintético','check_in_from','2031-02-20',
     'check_in_to','2031-02-21','change_description','Cambiar llegada sintética'));
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000a109',requested);
 IF receipt->>'reason'<>'change_requested' THEN RAISE EXCEPTION 'FALLA: solicitud no conservada %',receipt;END IF;
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000a109',accepted);
 IF receipt->>'reason'<>'change_accepted' OR (SELECT pending_change->>'accepted_at' IS NULL FROM public.reservations WHERE id=rid)
    OR (SELECT check_in FROM public.reservations WHERE id=rid)<>'2031-02-20'::date THEN RAISE EXCEPTION 'FALLA: aceptación no conciliada o cambió fechas sola';END IF;
 -- Una solicitud de otra estancia queda visible; no se pega por el nombre del huésped.
 requested:=jsonb_set(requested,'{message_id}','"synthetic-other-stay"');requested:=jsonb_set(requested,'{payload,check_in_from}','"2030-01-01"');
 receipt:=public.gmail_sync_apply('00000000-0000-0000-0000-00000000a109',requested);
 IF receipt->>'reason'<>'ambiguous_stay' THEN RAISE EXCEPTION 'FALLA: solicitud de otra estancia aplicada';END IF;
 PERFORM public.gmail_sync_checkpoint('00000000-0000-0000-0000-00000000a109',NULL,true,'{}');
 PERFORM public.gmail_sync_finish('00000000-0000-0000-0000-00000000a109','complete');
 RAISE NOTICE 'OK: aceptación y solicitud en páginas distintas, fechas sin aplicación automática y otra estancia aislada';
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT public.gmail_sync_begin('00000000-0000-0000-0000-00000000a106','cron') IS NOT NULL;
RESET ROLE;
UPDATE public.gmail_sync_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id='00000000-0000-0000-0000-00000000a106';
SET ROLE service_role;
DO $$ BEGIN
 PERFORM public.gmail_sync_begin('00000000-0000-0000-0000-00000000a107','cron');
 BEGIN PERFORM public.gmail_sync_checkpoint('00000000-0000-0000-0000-00000000a106',NULL,true,'{}');RAISE EXCEPTION 'FALLA: vencido escribió';EXCEPTION WHEN serialization_failure THEN NULL;END;
 IF (SELECT status FROM public.gmail_sync_runs WHERE id='00000000-0000-0000-0000-00000000a106')<>'interrupted' THEN RAISE EXCEPTION 'FALLA: vencido no identificado';END IF;
END $$;
RESET ROLE;
UPDATE public.app_settings SET updated_at=clock_timestamp() WHERE key='gmail_refresh_token';
SET ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.gmail_sync_finish('00000000-0000-0000-0000-00000000a107','complete');RAISE EXCEPTION 'FALLA: conexión vieja certificada';EXCEPTION WHEN serialization_failure THEN NULL;END;
 PERFORM public.gmail_sync_begin('00000000-0000-0000-0000-00000000a108','cron');
 PERFORM public.gmail_sync_checkpoint('00000000-0000-0000-0000-00000000a108',NULL,true,'{}');
 PERFORM public.gmail_sync_finish('00000000-0000-0000-0000-00000000a108','complete');
 RAISE NOTICE 'OK: trabajador vencido y reconexión impiden escrituras anteriores';
END $$;
RESET ROLE;
