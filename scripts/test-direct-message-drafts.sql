-- Datos sintéticos, únicamente Postgres LOCAL temporal del runner.
BEGIN;
CREATE FUNCTION pg_temp.direct_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLA: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('00000000-0000-0000-0000-00000000d501'),('00000000-0000-0000-0000-00000000d502');
INSERT INTO public.team_members(id,name,email,role,active) VALUES
('00000000-0000-0000-0000-00000000d501','Admin Directas Sintético','direct-admin@example.test','admin',true),
('00000000-0000-0000-0000-00000000d502','Limpieza Directas Sintética','direct-clean@example.test','cleaning',true);
INSERT INTO public.properties(id,name,capacity) VALUES('00000000-0000-0000-0000-00000000d510','Directas Sintético',4);
INSERT INTO public.reservations(id,property_id,source,guest_name,guests,check_in,check_out,status) VALUES
('00000000-0000-0000-0000-00000000d520','00000000-0000-0000-0000-00000000d510','direct','Titular Sintético',2,'2026-12-01','2026-12-03','confirmed');
CREATE TEMP TABLE direct_input AS SELECT jsonb_build_object('reservation_id','00000000-0000-0000-0000-00000000d520','stage','arrival','snapshot',jsonb_build_object('property_id','00000000-0000-0000-0000-00000000d510','guest_name','Titular Sintético','guests',2,'check_in','2026-12-01','check_out','2026-12-03'),'expected_version',0,'request_key','direct-save-1','channel','pending','recipient','','body','','scheduled_for',NULL,'reviewed',true) value;
GRANT SELECT ON direct_input TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000d501';
SELECT pg_temp.direct_assert((public.save_direct_message_draft((SELECT value FROM direct_input))->>'ok')='true','guarda pendiente sin contacto ni plantilla inventada');
SELECT pg_temp.direct_assert((public.save_direct_message_draft((SELECT value FROM direct_input))->>'replayed')='true','reintento idéntico sin duplicación');
SELECT pg_temp.direct_assert((SELECT count(*)=1 AND bool_and(status='draft' AND channel='pending' AND scheduled_for IS NULL) FROM public.direct_message_drafts),'borrador único no enviado');
SELECT pg_temp.direct_assert((public.save_direct_message_draft((SELECT value||'{"body":"Cambio Sintético"}' FROM direct_input))->>'conflict')='true','misma clave distinto contenido rechazada');
SELECT pg_temp.direct_assert((public.save_direct_message_draft((SELECT value||'{"request_key":"stale"}' FROM direct_input))->>'conflict')='true','versión antigua rechazada');
SELECT pg_temp.direct_assert((public.save_direct_message_draft((SELECT value||'{"request_key":"edit","expected_version":1,"body":"Texto Sintético","channel":"email","recipient":"huesped@example.test","scheduled_for":"2026-11-30T09:00:00-05:00"}' FROM direct_input))->>'ok')='true','edición con zona Colombia');
SELECT pg_temp.direct_assert((SELECT scheduled_for='2026-11-30T14:00:00Z'::timestamptz FROM public.direct_message_drafts),'hora Colombia preservada');
DO $$ BEGIN
 BEGIN UPDATE public.direct_message_drafts SET body='No permitido'; RAISE EXCEPTION 'FALLA: DML directo'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.reservations SET guests=3 WHERE id='00000000-0000-0000-0000-00000000d520';
SELECT pg_temp.direct_assert((SELECT status='review_required' AND version=3 AND snapshot->>'guests'='2' AND review_reason IS NOT NULL FROM public.direct_message_drafts),'cambio invalida y conserva snapshot');
UPDATE public.reservations SET guests=2 WHERE id='00000000-0000-0000-0000-00000000d520';
SELECT pg_temp.direct_assert((SELECT status='review_required' AND version=4 FROM public.direct_message_drafts),'volver a datos viejos no valida automáticamente');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000d501';
SELECT pg_temp.direct_assert((public.save_direct_message_draft((SELECT value||'{"request_key":"review","expected_version":4}' FROM direct_input))->>'ok')='true','revisión explícita guarda nueva versión');
RESET ROLE;
UPDATE public.reservations SET status='cancelled' WHERE id='00000000-0000-0000-0000-00000000d520';
SELECT pg_temp.direct_assert((SELECT status='cancelled' FROM public.direct_message_drafts),'cancelación conserva y desactiva');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000d501';
SELECT pg_temp.direct_assert((public.save_direct_message_draft((SELECT value||'{"request_key":"cancelled","expected_version":6}' FROM direct_input))->>'ok')='false','cancelada no se reactiva');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000d502';
SELECT pg_temp.direct_assert((SELECT count(*)=0 FROM public.direct_message_drafts),'limpieza no ve contactos/borradores');
DO $$ BEGIN
 BEGIN PERFORM public.save_direct_message_draft((SELECT value FROM direct_input)); RAISE EXCEPTION 'FALLA: limpieza escribe'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.direct_assert((SELECT count(*)>=6 FROM public.direct_message_history),'historial conservado');
ROLLBACK;
