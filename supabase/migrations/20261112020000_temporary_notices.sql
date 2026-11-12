-- Avisos temporales: recuperación conservando tablas e historial; retirar solo la UI si falla.
-- No borra avisos externos, no envía mensajes, no modifica reservas ni datos existentes.
BEGIN;
CREATE TABLE public.temporary_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES public.properties(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 150),
 message text NOT NULL CHECK(length(btrim(message)) BETWEEN 1 AND 2000),
 expires_on date NOT NULL, locations text[] NOT NULL CHECK(cardinality(locations) BETWEEN 1 AND 20),
 status text NOT NULL CHECK(status IN ('open','retired')), evidence text,
 version int NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid NOT NULL REFERENCES public.team_members(id),
 CHECK(status<>'retired' OR (evidence IS NOT NULL AND length(btrim(evidence)) BETWEEN 10 AND 500))
);
CREATE TABLE public.temporary_notice_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), notice_id uuid NOT NULL REFERENCES public.temporary_notices(id),
 actor_id uuid NOT NULL REFERENCES public.team_members(id), at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_key text NOT NULL, payload jsonb NOT NULL, before_data jsonb, after_data jsonb NOT NULL,
 UNIQUE(actor_id,request_key)
);
ALTER TABLE public.temporary_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temporary_notice_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY temporary_notices_read ON public.temporary_notices FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.team_members WHERE id=auth.uid() AND active));
CREATE POLICY temporary_history_read ON public.temporary_notice_history FOR SELECT TO authenticated USING(public.airadmin_is_admin());
REVOKE ALL ON public.temporary_notices,public.temporary_notice_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.temporary_notices,public.temporary_notice_history TO authenticated;
CREATE FUNCTION public.save_temporary_notice(p_input jsonb,p_request_key text,p_expected_version int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); n public.temporary_notices; old public.temporary_notices;
 h public.temporary_notice_history; payload jsonb; loc text[];
BEGIN
 IF current_setting('role',true)<>'authenticated' OR actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.team_members WHERE id=actor AND active AND role='admin') THEN RAISE insufficient_privilege; END IF;
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 200 OR p_expected_version IS NULL OR p_expected_version<0 THEN RAISE check_violation; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('temporary:'||actor||':'||p_request_key,0));
 payload:=jsonb_build_object('input',p_input,'version',p_expected_version);
 SELECT * INTO h FROM public.temporary_notice_history WHERE actor_id=actor AND request_key=p_request_key;
 IF FOUND THEN
  IF h.payload IS DISTINCT FROM payload THEN RETURN jsonb_build_object('ok',false,'error','La clave corresponde a otro cambio.'); END IF;
  SELECT * INTO n FROM public.temporary_notices WHERE id=h.notice_id;
  RETURN jsonb_build_object('ok',true,'data',to_jsonb(n),'replayed',true);
 END IF;
 IF jsonb_typeof(p_input->'locations') IS DISTINCT FROM 'array' THEN RAISE check_violation; END IF;
 SELECT array_agg(x) INTO loc FROM jsonb_array_elements_text(p_input->'locations') x;
 IF EXISTS(SELECT 1 FROM unnest(loc) x WHERE x IS NULL OR length(btrim(x)) NOT BETWEEN 1 AND 300) THEN RAISE check_violation; END IF;
 IF p_input->>'id' IS NULL THEN
  IF p_expected_version<>0 OR p_input->>'status' IS DISTINCT FROM 'open' THEN RAISE check_violation; END IF;
  INSERT INTO public.temporary_notices(property_id,title,message,expires_on,locations,status,evidence,updated_by)
  VALUES((p_input->>'property_id')::uuid,btrim(p_input->>'title'),btrim(p_input->>'message'),(p_input->>'expires_on')::date,loc,'open',NULL,actor) RETURNING * INTO n;
 ELSE
  SELECT * INTO old FROM public.temporary_notices WHERE id=(p_input->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR old.version<>p_expected_version THEN RETURN jsonb_build_object('ok',false,'error','El aviso cambió. Actualiza antes de editar.'); END IF;
  IF old.status='retired' THEN RETURN jsonb_build_object('ok',false,'error','Conserva el aviso retirado como historial; crea otro para un nuevo aviso.'); END IF;
  UPDATE public.temporary_notices SET title=btrim(p_input->>'title'), message=btrim(p_input->>'message'), expires_on=(p_input->>'expires_on')::date,
    locations=loc,status=p_input->>'status',evidence=NULLIF(btrim(p_input->>'evidence'),''),version=old.version+1,updated_at=clock_timestamp(),updated_by=actor
    WHERE id=old.id RETURNING * INTO n;
 END IF;
 INSERT INTO public.temporary_notice_history(notice_id,actor_id,request_key,payload,before_data,after_data) VALUES(n.id,actor,p_request_key,payload,to_jsonb(old),to_jsonb(n));
 RETURN jsonb_build_object('ok',true,'data',to_jsonb(n));
END $$;
REVOKE ALL ON FUNCTION public.save_temporary_notice(jsonb,text,int) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_temporary_notice(jsonb,text,int) TO authenticated;
COMMIT;
