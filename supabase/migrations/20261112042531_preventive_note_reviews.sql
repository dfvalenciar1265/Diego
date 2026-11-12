-- SOLO RAMA/LOCAL: revisión explícita de notas, sin convertir preventivos ni cambiar su agenda.
BEGIN;
CREATE SCHEMA airadmin_preventive_review;
REVOKE ALL ON SCHEMA airadmin_preventive_review FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA airadmin_preventive_review TO authenticated,service_role;
CREATE TABLE public.preventive_note_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),parent_id uuid NOT NULL REFERENCES public.maintenance(id) ON DELETE RESTRICT,
 corrective_id uuid REFERENCES public.maintenance(id) ON DELETE RESTRICT,
 parent_snapshot jsonb NOT NULL,corrective_snapshot jsonb,
 source_reference text NOT NULL CHECK(length(btrim(source_reference)) BETWEEN 3 AND 200),
 disposition text NOT NULL CHECK(disposition IN ('create_report','link_existing','no_action')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 report_state text CHECK(report_state='pending_verification'),
 actor_id uuid NOT NULL REFERENCES public.team_members(id),author text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),version int NOT NULL DEFAULT 1 CHECK(version=1),
 UNIQUE(parent_id,source_reference),
 CHECK((disposition='no_action' AND corrective_id IS NULL AND corrective_snapshot IS NULL AND report_state IS NULL)
 OR (disposition='create_report' AND corrective_id IS NOT NULL AND corrective_snapshot IS NOT NULL AND report_state='pending_verification')
 OR (disposition='link_existing' AND corrective_id IS NOT NULL AND corrective_snapshot IS NOT NULL AND report_state IS NULL))
);
-- DTO de operación separado: jamás concede lectura de snapshots/notas/costos al equipo.
CREATE TABLE public.maintenance_corrective_links (
 corrective_id uuid PRIMARY KEY REFERENCES public.maintenance(id) ON DELETE RESTRICT,
 parent_id uuid NOT NULL REFERENCES public.maintenance(id) ON DELETE RESTRICT,
 parent_title text NOT NULL,property_id uuid NOT NULL REFERENCES public.properties(id),
 pending_verification boolean NOT NULL,
 review_id uuid NOT NULL UNIQUE REFERENCES public.preventive_note_reviews(id)
);
ALTER TABLE public.maintenance_corrective_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maintenance_corrective_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.maintenance_corrective_links TO authenticated,service_role;
CREATE POLICY "active team reads safe corrective links" ON public.maintenance_corrective_links FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active));
CREATE FUNCTION public.list_preventive_links(p_corrective_ids uuid[]) RETURNS TABLE(parent_id uuid,corrective_id uuid,parent_title text,property_id uuid,pending_verification boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT l.parent_id,l.corrective_id,p.title,l.property_id,l.pending_verification FROM public.maintenance_corrective_links l
 JOIN public.maintenance p ON p.id=l.parent_id JOIN public.maintenance c ON c.id=l.corrective_id
 WHERE l.corrective_id=ANY(p_corrective_ids) AND cardinality(p_corrective_ids)<=500
 AND p.priority='scheduled' AND c.priority<>'scheduled' AND c.status IN ('open','in_progress')
 AND p.property_id=l.property_id AND c.property_id=l.property_id
$$;
REVOKE ALL ON FUNCTION public.list_preventive_links(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_preventive_links(uuid[]) TO authenticated,service_role;
CREATE TABLE airadmin_preventive_review.requests (
 actor_id uuid NOT NULL REFERENCES public.team_members(id),request_key text NOT NULL,payload jsonb NOT NULL,
 review_id uuid NOT NULL REFERENCES public.preventive_note_reviews(id),PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE public.preventive_note_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE airadmin_preventive_review.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preventive_note_reviews,airadmin_preventive_review.requests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.preventive_note_reviews TO authenticated,service_role;
CREATE POLICY "admin reads preventive note reviews" ON public.preventive_note_reviews FOR SELECT TO authenticated USING(public.airadmin_is_admin());
CREATE FUNCTION airadmin_preventive_review.save(p_input jsonb,p_source text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.team_members;p public.maintenance;c public.maintenance;v public.preventive_note_reviews;
 q airadmin_preventive_review.requests;aid uuid;req text;ref text;decision text;reason_text text;payload jsonb;parent_before jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE serialization_failure;END IF;
 IF current_setting('role',true)='authenticated' AND p_source='app' AND auth.uid() IS NOT NULL AND (p_actor_id IS NULL OR p_actor_id=auth.uid()) THEN aid:=auth.uid();
 ELSIF current_setting('role',true)='service_role' AND p_source='mcp' THEN aid:=p_actor_id;
 ELSE RAISE insufficient_privilege;END IF;
 SELECT * INTO a FROM public.team_members WHERE id=aid AND active AND role='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE insufficient_privilege;END IF;
 req:=btrim(p_input->>'request_key');ref:=btrim(p_input->>'source_reference');decision:=p_input->>'disposition';reason_text:=btrim(p_input->>'reason');
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR coalesce(length(req),0) NOT BETWEEN 1 AND 200 OR coalesce(length(ref),0) NOT BETWEEN 3 AND 200
 OR p_input->>'confirmed' IS DISTINCT FROM 'true' OR p_input->>'expected_version' IS DISTINCT FROM '0'
 OR decision IS NULL OR decision NOT IN ('create_report','link_existing','no_action') OR coalesce(length(reason_text),0) NOT BETWEEN 10 AND 1000
 OR jsonb_typeof(p_input->'parent_snapshot') IS DISTINCT FROM 'object' THEN RAISE check_violation;END IF;
 IF decision='link_existing' THEN
  IF p_input->>'corrective_id' IS NULL OR jsonb_typeof(p_input->'corrective_snapshot') IS DISTINCT FROM 'object' THEN RAISE check_violation;END IF;
 ELSIF p_input->>'corrective_id' IS NOT NULL OR (p_input->'corrective_snapshot' IS NOT NULL AND p_input->'corrective_snapshot'<>'null'::jsonb) THEN RAISE check_violation;END IF;
 payload:=jsonb_build_object('input',p_input,'source',p_source);
 PERFORM pg_advisory_xact_lock(hashtextextended('preventive-review:'||aid||':'||req,0));
 SELECT * INTO q FROM airadmin_preventive_review.requests WHERE actor_id=aid AND request_key=req;
 IF FOUND THEN
  IF q.payload IS DISTINCT FROM payload THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','La clave ya corresponde a otra revisión.');END IF;
  SELECT * INTO v FROM public.preventive_note_reviews WHERE id=q.review_id;
  RETURN jsonb_build_object('ok',true,'replayed',true,'data',to_jsonb(v));
 END IF;
 SELECT * INTO p FROM public.maintenance WHERE id=(p_input->>'parent_id')::uuid FOR UPDATE;
 IF NOT FOUND OR p.priority<>'scheduled' THEN RETURN jsonb_build_object('ok',false,'error','Selecciona un preventivo existente; no se convierte ni se sustituye.');END IF;
 parent_before:=to_jsonb(p);
 IF p_input->'parent_snapshot' IS DISTINCT FROM parent_before THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','El preventivo o sus notas cambió. Relee la ficha completa antes de decidir.');END IF;
 SELECT * INTO v FROM public.preventive_note_reviews WHERE parent_id=p.id AND source_reference=ref;
 IF FOUND THEN
  IF v.parent_snapshot IS DISTINCT FROM parent_before OR v.disposition IS DISTINCT FROM decision OR v.reason IS DISTINCT FROM reason_text
   OR (decision='link_existing' AND (v.corrective_id IS DISTINCT FROM (p_input->>'corrective_id')::uuid OR v.corrective_snapshot IS DISTINCT FROM p_input->'corrective_snapshot')) THEN
   RETURN jsonb_build_object('ok',false,'conflict',true,'error','La fuente ya fue revisada con otra decisión o snapshot. No se sobrescribe; consulta el historial.','current',to_jsonb(v));END IF;
 ELSE
  IF decision='link_existing' THEN
   SELECT * INTO c FROM public.maintenance WHERE id=(p_input->>'corrective_id')::uuid FOR UPDATE;
   IF NOT FOUND OR c.property_id<>p.property_id OR c.priority='scheduled' OR c.status NOT IN ('open','in_progress') OR c.id=p.id THEN RETURN jsonb_build_object('ok',false,'error','El correctivo debe estar activo en el mismo apartamento y no ser preventivo; no se reabre ninguno.');END IF;
   IF EXISTS(SELECT 1 FROM public.maintenance_corrective_links WHERE corrective_id=c.id AND parent_id<>p.id) THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','El correctivo ya está vinculado a un preventivo. No se reasigna.');END IF;
   IF p_input->'corrective_snapshot' IS DISTINCT FROM to_jsonb(c) THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','El correctivo cambió. Relee antes de vincular; su estado no se modifica.');END IF;
  ELSIF decision='create_report' THEN
   IF EXISTS(SELECT 1 FROM public.maintenance_corrective_links l JOIN public.maintenance m ON m.id=l.corrective_id WHERE l.parent_id=p.id AND m.priority<>'scheduled' AND m.status IN ('open','in_progress') AND m.property_id=p.property_id) THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','Ya hay un correctivo activo vinculado al preventivo. Revísalo y vincula esta fuente explícitamente; no se crea otro reporte.');END IF;
   INSERT INTO public.maintenance(property_id,title,description,priority,status,reported_by)
   VALUES(p.property_id,'Pendiente de comprobar: '||p.title,'Reporte pendiente de comprobación, no diagnóstico ni confirmación de avería. Revisión explícita de nota: '||reason_text,'normal','open',a.id) RETURNING * INTO c;
  END IF;
  INSERT INTO public.preventive_note_reviews(parent_id,corrective_id,parent_snapshot,corrective_snapshot,source_reference,disposition,reason,report_state,actor_id,author)
  VALUES(p.id,c.id,parent_before,CASE WHEN c.id IS NULL THEN NULL ELSE to_jsonb(c) END,ref,decision,reason_text,CASE WHEN decision='create_report' THEN 'pending_verification' END,a.id,a.name) RETURNING * INTO v;
  IF c.id IS NOT NULL THEN INSERT INTO public.maintenance_corrective_links(corrective_id,parent_id,parent_title,property_id,pending_verification,review_id) VALUES(c.id,p.id,p.title,p.property_id,decision='create_report',v.id) ON CONFLICT(corrective_id) DO NOTHING;END IF;
 END IF;
 -- Invariante de protección: una revisión jamás modifica el preventivo padre.
 IF (SELECT to_jsonb(m) FROM public.maintenance m WHERE m.id=p.id) IS DISTINCT FROM parent_before THEN RAISE EXCEPTION 'La revisión alteró el preventivo; se revierte la operación.';END IF;
 INSERT INTO airadmin_preventive_review.requests VALUES(a.id,req,payload,v.id);
 RETURN jsonb_build_object('ok',true,'data',to_jsonb(v));
END $$;
REVOKE ALL ON FUNCTION airadmin_preventive_review.save(jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION airadmin_preventive_review.save(jsonb,text,uuid) TO authenticated,service_role;
CREATE FUNCTION public.save_preventive_note_review(p_input jsonb,p_source text DEFAULT 'app',p_actor_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT airadmin_preventive_review.save(p_input,p_source,p_actor_id) $$;
REVOKE ALL ON FUNCTION public.save_preventive_note_review(jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_preventive_note_review(jsonb,text,uuid) TO authenticated,service_role;
COMMIT;
