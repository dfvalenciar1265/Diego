-- SOLO base local sintética del runner. Se revierte todo el fixture.
BEGIN;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS next_due date;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS last_done date;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS interval_months int;
CREATE FUNCTION pg_temp.pr_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLA preventive review: %',label; END IF; END $$;
INSERT INTO auth.users(id) VALUES('00000000-0000-0000-0000-00000000ad01'),('00000000-0000-0000-0000-00000000ad02');
INSERT INTO public.team_members(id,name,email,role,active) VALUES('00000000-0000-0000-0000-00000000ad01','Admin PR Sintético','pr-admin@example.test','admin',true),('00000000-0000-0000-0000-00000000ad02','Limpieza PR Sintética','pr-clean@example.test','cleaning',true);
INSERT INTO public.properties(id,name,capacity) VALUES('00000000-0000-0000-0000-00000000ad11','PR Sintético',4);
INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out,status) VALUES('00000000-0000-0000-0000-00000000ad21','00000000-0000-0000-0000-00000000ad11','direct','PR Huésped Sintético',(clock_timestamp() AT TIME ZONE 'America/Bogota')::date,(clock_timestamp() AT TIME ZONE 'America/Bogota')::date+2,'confirmed');
INSERT INTO public.maintenance(id,property_id,title,description,priority,status,notes,reported_by,next_due,last_done,cost) VALUES
('00000000-0000-0000-0000-00000000ad31','00000000-0000-0000-0000-00000000ad11','Aires preventivo','Programado','scheduled','open','Nota antigua: revisar enfriamiento','00000000-0000-0000-0000-00000000ad01','2027-01-10','2026-10-10',12345.67),
('00000000-0000-0000-0000-00000000ad32','00000000-0000-0000-0000-00000000ad11','Agua preventivo','Programado','scheduled','in_progress','Nota antigua: revisar grifo','00000000-0000-0000-0000-00000000ad01','2027-02-10','2026-11-10',45678.90),
('00000000-0000-0000-0000-00000000ad33','00000000-0000-0000-0000-00000000ad11','Luces preventivo','Programado','scheduled','resolved','Nota antigua ya atendida','00000000-0000-0000-0000-00000000ad01','2027-03-10','2026-09-10',98765.43);
CREATE TEMP TABLE pr_before AS SELECT id,to_jsonb(m) snapshot FROM public.maintenance m WHERE property_id='00000000-0000-0000-0000-00000000ad11';
GRANT SELECT ON pr_before TO authenticated;
SELECT pg_temp.pr_assert((SELECT count(*)=0 FROM public.maintenance WHERE property_id='00000000-0000-0000-0000-00000000ad11' AND priority<>'scheduled' AND status<>'resolved'),'notas no son averías automáticas');
SELECT pg_temp.pr_assert((SELECT count(*)=0 FROM public.preventive_note_reviews WHERE parent_id IN(SELECT id FROM pr_before)),'sin revisiones automáticas');
CREATE FUNCTION pg_temp.pr_input(parent uuid,ref text,disposition text,key text,corrective uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('parent_id',parent,'parent_snapshot',(SELECT snapshot FROM pr_before WHERE id=parent),'source_reference',ref,'disposition',disposition,'reason','Revisión manual sintética, pendiente de confirmar en sitio','corrective_id',corrective,'corrective_snapshot',(SELECT to_jsonb(m) FROM public.maintenance m WHERE id=corrective),'expected_version',0,'request_key',key,'confirmed',true)
$$;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000ad01';
CREATE TEMP TABLE pr_created AS SELECT public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad31','referencia-a','create_report','create-a')) response;
SELECT pg_temp.pr_assert((SELECT (response->>'ok')::boolean FROM pr_created),'creación explícita');
SELECT pg_temp.pr_assert((SELECT report_state='pending_verification' AND corrective_id IS NOT NULL FROM public.preventive_note_reviews WHERE parent_id='00000000-0000-0000-0000-00000000ad31'),'estado por comprobar');
SELECT pg_temp.pr_assert((SELECT count(*)=1 FROM public.maintenance WHERE property_id='00000000-0000-0000-0000-00000000ad11' AND priority<>'scheduled' AND status<>'resolved'),'reporte visible query preparación');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad31','referencia-a','create_report','create-a'))->>'ok')::boolean,'reintento misma clave');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad31','referencia-a','create_report','retry-other-key'))->>'ok')::boolean,'misma referencia no dup');
SELECT pg_temp.pr_assert((SELECT count(*)=1 FROM public.preventive_note_reviews WHERE parent_id='00000000-0000-0000-0000-00000000ad31'),'un registro referencia');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad31','fuente-distinta','create_report','create-duplicate'))->>'ok')='false','nueva fuente no crea segundo reporte activo');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad31','referencia-a','no_action','conflict-ref'))->>'ok')='false','ref contradictoria no overwrite');
RESET ROLE;
INSERT INTO public.maintenance(id,property_id,title,priority,status,reported_by) VALUES('00000000-0000-0000-0000-00000000ad41','00000000-0000-0000-0000-00000000ad11','Correctivo sintético existente','normal','open','00000000-0000-0000-0000-00000000ad01');
SET LOCAL ROLE authenticated;
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad32','referencia-b','link_existing','link-b','00000000-0000-0000-0000-00000000ad41'))->>'ok')::boolean,'vincular correctivo explícito');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad32','referencia-b-nueva','link_existing','link-b-new-source','00000000-0000-0000-0000-00000000ad41'))->>'ok')::boolean,'nueva fuente mismo par sin duplicar');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad33','referencia-c','no_action','no-c'))->>'ok')::boolean,'no_action explícito');
SELECT pg_temp.pr_assert((SELECT disposition='no_action' AND corrective_id IS NULL AND actor_id='00000000-0000-0000-0000-00000000ad01' AND recorded_at IS NOT NULL FROM public.preventive_note_reviews WHERE parent_id='00000000-0000-0000-0000-00000000ad33'),'auditoría no_action');
SELECT pg_temp.pr_assert((SELECT bool_and(to_jsonb(m)=b.snapshot) FROM public.maintenance m JOIN pr_before b USING(id)),'parents completos intactos fechas status costo notas');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(jsonb_set(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad31','stale-parent','create_report','stale-parent'),'{parent_snapshot,notes}','"nota distinta"'))->>'ok')='false','parent snapshot stale');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(jsonb_set(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad32','stale-corrective','link_existing','stale-corrective',(SELECT corrective_id FROM public.preventive_note_reviews WHERE parent_id='00000000-0000-0000-0000-00000000ad31')),'{corrective_snapshot,status}','"resolved"'))->>'ok')='false','corrective snapshot stale');
RESET ROLE;
UPDATE public.maintenance SET status='resolved' WHERE id='00000000-0000-0000-0000-00000000ad41';
INSERT INTO public.properties(id,name,capacity) VALUES('00000000-0000-0000-0000-00000000ad12','Otra propiedad sintética',2);
INSERT INTO public.maintenance(id,property_id,title,priority,status,reported_by) VALUES('00000000-0000-0000-0000-00000000ad42','00000000-0000-0000-0000-00000000ad12','Correctivo otro apartamento','normal','open','00000000-0000-0000-0000-00000000ad01');
SET LOCAL ROLE authenticated;
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad32','resolved-ref','link_existing','resolved-link','00000000-0000-0000-0000-00000000ad41'))->>'ok')='false','no vincular correctivo resuelto');
SELECT pg_temp.pr_assert((public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad32','other-property-ref','link_existing','other-property-link','00000000-0000-0000-0000-00000000ad42'))->>'ok')='false','no vincular otra propiedad');
SELECT pg_temp.pr_assert((SELECT count(*)=0 FROM public.list_preventive_links(ARRAY['00000000-0000-0000-0000-00000000ad41']::uuid[])),'vínculo resuelto no se muestra vigente');
RESET ROLE;
UPDATE public.maintenance SET status='open' WHERE id='00000000-0000-0000-0000-00000000ad41';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000ad02';
SELECT pg_temp.pr_assert((SELECT count(*)=0 FROM public.preventive_note_reviews),'limpieza no lee snapshots auditoría');
SELECT pg_temp.pr_assert((SELECT count(*)=2 FROM public.maintenance_corrective_links WHERE property_id='00000000-0000-0000-0000-00000000ad11'),'limpieza lee vínculos seguros');
SELECT pg_temp.pr_assert((SELECT count(*)=1 FROM public.list_preventive_links(ARRAY['00000000-0000-0000-0000-00000000ad41']::uuid[])),'RPC vínculo seguro limpieza');
DO $$ BEGIN BEGIN PERFORM public.save_preventive_note_review(pg_temp.pr_input('00000000-0000-0000-0000-00000000ad31','cleaning-denied','create_report','cleaning'));RAISE EXCEPTION 'FALLA limpieza autorizada';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
SELECT pg_temp.pr_assert((SELECT count(*)=4 FROM public.preventive_note_reviews WHERE parent_id IN(SELECT id FROM pr_before)),'solo cuatro revisiones autorizadas');
SELECT pg_temp.pr_assert((SELECT count(*)=2 FROM public.maintenance WHERE property_id='00000000-0000-0000-0000-00000000ad11' AND priority<>'scheduled'),'solo un correctivo creado y otro vinculado');
SELECT pg_temp.pr_assert((SELECT bool_and(to_jsonb(m)=b.snapshot) FROM public.maintenance m JOIN pr_before b USING(id)),'parents sin mutación final');
ROLLBACK;
