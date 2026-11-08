-- Datos sintéticos. Solo la base LOCAL temporal de test-migrations.sh.
BEGIN;
CREATE FUNCTION pg_temp.notice_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLA: %',message; END IF; END $$;
INSERT INTO auth.users(id) SELECT ('00000000-0000-0000-0000-00000000e00'||n)::uuid FROM generate_series(1,5) n;
INSERT INTO public.team_members(id,name,email,role,active) VALUES
 ('00000000-0000-0000-0000-00000000e001','Admin Avisos Sintético','avisos-admin@example.test','admin',true),
 ('00000000-0000-0000-0000-00000000e002','Limpieza Avisos Sintética','avisos-clean@example.test','cleaning',true),
 ('00000000-0000-0000-0000-00000000e003','Mantenimiento Avisos Sintético','avisos-maint@example.test','maintenance',true),
 ('00000000-0000-0000-0000-00000000e004','Admin Inactivo Sintético','avisos-inactive@example.test','admin',false),
 ('00000000-0000-0000-0000-00000000e005','Otro Admin Sintético','avisos-other@example.test','admin',true);
INSERT INTO public.properties(id,name,capacity) VALUES
 ('00000000-0000-0000-0000-00000000e101','Apartamento Avisos Sintético',4),
 ('00000000-0000-0000-0000-00000000e102','Otro Apartamento Sintético',6);
INSERT INTO public.reservations(id,property_id,source,guest_name,guests,check_in,check_out) VALUES
 ('00000000-0000-0000-0000-00000000e201','00000000-0000-0000-0000-00000000e101','direct','Titular Sintético',2,
  (now() AT TIME ZONE 'America/Bogota')::date,(now() AT TIME ZONE 'America/Bogota')::date+2);
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000e001';
INSERT INTO public.tasks(id,reservation_id,property_id,type,scheduled_for,notes,building_notified_at) VALUES
 ('00000000-0000-0000-0000-00000000e401','00000000-0000-0000-0000-00000000e201','00000000-0000-0000-0000-00000000e101','preparation',
  (now() AT TIME ZONE 'America/Bogota')::date,'Conservar nota Sintética',clock_timestamp());
UPDATE public.tasks SET notes='15:00|Conservar nota Sintética' WHERE id='00000000-0000-0000-0000-00000000e401';
CREATE TEMP TABLE notice_task_before AS SELECT md5(t::text) AS h FROM public.tasks t WHERE id='00000000-0000-0000-0000-00000000e401';
INSERT INTO public.building_recipients(id,property_id,channel,address) VALUES
 ('00000000-0000-0000-0000-00000000e301','00000000-0000-0000-0000-00000000e101','whatsapp','15555550101'),
 ('00000000-0000-0000-0000-00000000e302','00000000-0000-0000-0000-00000000e101','email','porter-sintetico@example.test'),
 ('00000000-0000-0000-0000-00000000e303','00000000-0000-0000-0000-00000000e102','email','otro-sintetico@example.test');
CREATE FUNCTION pg_temp.notice_snapshot(recipient uuid DEFAULT '00000000-0000-0000-0000-00000000e301') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('template_version',1,'property_id',r.property_id,'apartment',p.name,'guest_name',r.guest_name,
 'guests',r.guests,'check_in',r.check_in,'check_out',r.check_out,'recipient_id',c.id,
 'channel',c.channel,'address',c.address,'recipient_version',c.version)
 FROM public.reservations r JOIN public.properties p ON p.id=r.property_id
 CROSS JOIN public.building_recipients c WHERE r.id='00000000-0000-0000-0000-00000000e201' AND c.id=recipient
$$;
CREATE FUNCTION pg_temp.notice_prepare(key text, reviewed boolean DEFAULT false, recipient uuid DEFAULT '00000000-0000-0000-0000-00000000e301') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.manage_building_notice('prepare',jsonb_build_object('reservation_id','00000000-0000-0000-0000-00000000e201',
 'recipient_id',recipient,'snapshot',pg_temp.notice_snapshot(recipient),'request_key',key)
 ||CASE WHEN reviewed THEN '{"review_confirmation":"Revisé la marca heredada y la necesidad de otro aviso Sintético"}'::jsonb ELSE '{}'::jsonb END)
$$;
CREATE FUNCTION pg_temp.notice_record(action text,key text,expected int,kind text DEFAULT 'operator_confirmation', event_time timestamptz DEFAULT clock_timestamp()) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.manage_building_notice('record',jsonb_build_object('notice_id',n.id,'expected_version',expected,
 'request_key',key,'action',action,'occurred_at',event_time,'evidence','Referencia comprobada Sintética',
 'evidence_kind',kind,'confirmed',true)) FROM public.building_notices n
 WHERE n.reservation_id='00000000-0000-0000-0000-00000000e201' ORDER BY content_version DESC LIMIT 1
$$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000e001';
SELECT pg_temp.notice_assert((pg_temp.notice_prepare('unverified')->>'ok')='false','contacto sin verificar bloqueado');
SELECT pg_temp.notice_assert((public.manage_building_notice('verify_recipient','{"recipient_id":"00000000-0000-0000-0000-00000000e301","expected_version":0,"request_key":"verify-wa","evidence":"Contacto comprobado Sintético"}')->>'ok')='true','verificación expresa');
SELECT pg_temp.notice_assert((public.manage_building_notice('verify_recipient','{"recipient_id":"00000000-0000-0000-0000-00000000e301","expected_version":0,"request_key":"verify-wa","evidence":"Contacto comprobado Sintético"}')->>'replayed')='true','reintento verificación');
SELECT pg_temp.notice_assert((pg_temp.notice_prepare('legacy-unreviewed')->>'ok')='false','marca heredada exige revisión');
SELECT pg_temp.notice_assert((pg_temp.notice_prepare('prepare-1',true)->>'ok')='true','prepara sin enviar');
SELECT pg_temp.notice_assert((public.manage_building_notice('record',jsonb_build_object('notice_id',(SELECT id FROM public.building_notices),
 'expected_version',1,'request_key','missing-zone','action','sent','occurred_at','2026-11-08T08:00:00',
 'confirmed',true,'evidence','Referencia Sintética','evidence_kind','operator_confirmation'))->>'ok')='false','fecha sin zona horaria bloqueada');
SELECT pg_temp.notice_assert((SELECT count(*)=1 AND bool_and(status='prepared' AND sent_at IS NULL) FROM public.building_notices),'preparado no es enviado');
SELECT pg_temp.notice_assert((pg_temp.notice_prepare('prepare-1',true)->>'replayed')='true','reintento idéntico');
SELECT pg_temp.notice_assert((pg_temp.notice_prepare('prepare-dedupe',true)->>'ok')='true','dedupe con otra clave');
SELECT pg_temp.notice_assert((SELECT count(*)=1 FROM public.building_notices),'un borrador por contenido/destinatario');
SELECT pg_temp.notice_assert((pg_temp.notice_record('delivered','bad-delivery',1,'delivery_receipt')->>'ok')='false','entrega sin envío bloqueada');
SELECT pg_temp.notice_assert((pg_temp.notice_record('sent','future',1,'operator_confirmation',clock_timestamp()+interval '1 day')->>'ok')='false','fecha futura bloqueada');
SELECT pg_temp.notice_assert((pg_temp.notice_record('uncertain','uncertain',1,'uncertain_result')->>'ok')='true','resultado incierto visible');
SELECT pg_temp.notice_assert((pg_temp.notice_record('sent','sent',2)->>'ok')='true','confirmación humana de envío');
-- Misma fecha y payload para reintentar: no se fabrica otra evidencia ni evento.
CREATE TEMP TABLE retry_input AS SELECT jsonb_build_object('notice_id',id,'expected_version',3,'request_key','delivered',
 'action','delivered','occurred_at',clock_timestamp(),'evidence','Comprobante de entrega Sintético','evidence_kind','delivery_receipt','confirmed',true) AS value FROM public.building_notices;
SELECT pg_temp.notice_assert((public.manage_building_notice('record',(SELECT value FROM retry_input))->>'ok')='true','entrega con evidencia');
SELECT pg_temp.notice_assert((public.manage_building_notice('record',(SELECT value FROM retry_input))->>'replayed')='true','reintento tras resultado incierto de persistencia');
SELECT pg_temp.notice_assert((public.manage_building_notice('record',(SELECT value||'{"evidence":"Evidencia cambiada Sintética"}' FROM retry_input))->>'conflict')='true','clave reutilizada con otro payload');
SELECT pg_temp.notice_assert((pg_temp.notice_record('received','stale-received',3,'recipient_acknowledgment')->>'conflict')='true','concurrencia optimista');
SELECT pg_temp.notice_assert((pg_temp.notice_record('received','received',4,'recipient_acknowledgment')->>'ok')='true','recepción separada con evidencia');
SELECT pg_temp.notice_assert((SELECT status='received' AND sent_at IS NOT NULL AND delivered_at IS NOT NULL AND received_at IS NOT NULL FROM public.building_notices),'se conservan las tres fechas');
RESET ROLE;
SELECT pg_temp.notice_assert((SELECT h=(SELECT md5(t::text) FROM public.tasks t WHERE id='00000000-0000-0000-0000-00000000e401') FROM notice_task_before),'registrar avisos conserva tareas, notas y marcas históricas');
UPDATE public.reservations SET notes='Otra nota Sintética' WHERE id='00000000-0000-0000-0000-00000000e201';
SELECT pg_temp.notice_assert((SELECT review_reason IS NULL FROM public.building_notices),'nota ajena no invalida');
UPDATE public.reservations SET guests=3,check_in=check_in+1,check_out=check_out+1 WHERE id='00000000-0000-0000-0000-00000000e201';
SELECT pg_temp.notice_assert((SELECT status='received' AND snapshot->>'guests'='2' AND review_reason IS NOT NULL FROM public.building_notices),'cambio conserva evidencia y exige revisión');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000e001';
SELECT pg_temp.notice_assert((pg_temp.notice_record('sent','changed-stay',6)->>'ok')='false','estancia cambiada no reutiliza aviso');
SELECT pg_temp.notice_assert((pg_temp.notice_prepare('changed-without-review')->>'ok')='false','otra versión requiere revisión');
SELECT pg_temp.notice_assert((pg_temp.notice_prepare('changed-reviewed',true)->>'ok')='true','otra versión conserva historial');
RESET ROLE;
UPDATE public.properties SET name='Apartamento Renombrado Sintético' WHERE id='00000000-0000-0000-0000-00000000e101';
SELECT pg_temp.notice_assert((SELECT count(*)=2 AND bool_and(review_reason IS NOT NULL) FROM public.building_notices),'renombrar invalida sin perder contactos estables');
UPDATE public.reservations SET status='cancelled' WHERE id='00000000-0000-0000-0000-00000000e201';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000e001';
SELECT pg_temp.notice_assert((pg_temp.notice_prepare('cancelled',true)->>'ok')='false','cancelación bloquea borradores');
SELECT pg_temp.notice_assert((pg_temp.notice_record('sent','cancelled-sent',3)->>'ok')='false','cancelación bloquea confirmar envío');
DO $$ BEGIN
 BEGIN UPDATE public.building_notices SET status='sent'; RAISE EXCEPTION 'FALLA: escritura directa'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.building_notice_history; RAISE EXCEPTION 'FALLA: borrado directo'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.manage_building_notice('verify_recipient','{"recipient_id":"00000000-0000-0000-0000-00000000e302","expected_version":0,"request_key":"spoof","evidence":"Contacto comprobado Sintético"}','app','00000000-0000-0000-0000-00000000e005'); RAISE EXCEPTION 'FALLA: suplantación'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000e002';
DO $$ BEGIN
 PERFORM pg_temp.notice_assert((SELECT count(*)=0 FROM public.building_notices),'limpieza sin datos privados de avisos');
 BEGIN PERFORM pg_temp.notice_prepare('clean',true); RAISE EXCEPTION 'FALLA: limpieza escribe'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000e003';
DO $$ BEGIN BEGIN PERFORM pg_temp.notice_prepare('maintenance',true); RAISE EXCEPTION 'FALLA: mantenimiento escribe'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000e004';
DO $$ BEGIN BEGIN PERFORM pg_temp.notice_prepare('inactive',true); RAISE EXCEPTION 'FALLA: inactivo escribe'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN BEGIN PERFORM public.manage_building_notice('prepare','{}'); RAISE EXCEPTION 'FALLA: anónimo ejecuta'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.notice_assert((public.manage_building_notice('verify_recipient',
 '{"recipient_id":"00000000-0000-0000-0000-00000000e302","expected_version":0,"request_key":"mcp-verify","evidence":"Correo comprobado Sintético"}',
 'mcp','00000000-0000-0000-0000-00000000e001')->>'ok')='true','MCP con admin activo');
DO $$ BEGIN BEGIN PERFORM public.manage_building_notice('prepare','{}','mcp','00000000-0000-0000-0000-00000000e002'); RAISE EXCEPTION 'FALLA: MCP no admin'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SET LOCAL timezone='Asia/Tokyo';
SELECT pg_temp.notice_assert(('2026-11-09T02:00:00Z'::timestamptz AT TIME ZONE 'America/Bogota')::date='2026-11-08'::date,'día Colombia independiente de sesión');
DO $$ BEGIN
 BEGIN UPDATE public.building_notice_history SET evidence='Alteración Sintética'; RAISE EXCEPTION 'FALLA: historial editable'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM public.building_notices; RAISE EXCEPTION 'FALLA: aviso borrable'; EXCEPTION WHEN check_violation THEN NULL; END;
 RAISE NOTICE 'OK: avisos, destinatarios, estados/evidencia, idempotencia, permisos, cambios y preservación';
END $$;
ROLLBACK;
