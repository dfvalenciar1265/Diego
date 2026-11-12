-- Selección manual exclusivamente; no importa ni interpreta notas históricas.
BEGIN;
CREATE TABLE public.checkout_check_prompts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_id uuid NOT NULL REFERENCES public.maintenance(id),property_id uuid NOT NULL REFERENCES public.properties(id),
 source_snapshot jsonb NOT NULL,instruction text NOT NULL CHECK(length(btrim(instruction)) BETWEEN 10 AND 500),
 actor_id uuid NOT NULL REFERENCES public.team_members(id),author text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_key uuid NOT NULL UNIQUE,UNIQUE(source_id,source_snapshot,instruction)
);
CREATE TABLE public.checkout_check_skips(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),prompt_id uuid NOT NULL REFERENCES public.checkout_check_prompts(id),reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 stay_snapshot jsonb NOT NULL,source_snapshot jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 actor_id uuid NOT NULL REFERENCES public.team_members(id),author text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),request_key uuid NOT NULL UNIQUE,
 UNIQUE(prompt_id,reservation_id,stay_snapshot,source_snapshot)
);
ALTER TABLE public.checkout_check_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_check_skips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.checkout_check_prompts,public.checkout_check_skips FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.checkout_check_prompts,public.checkout_check_skips TO authenticated;
CREATE POLICY checkout_prompt_read ON public.checkout_check_prompts FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.team_members WHERE id=auth.uid() AND active));
CREATE POLICY checkout_skip_read ON public.checkout_check_skips FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.team_members WHERE id=auth.uid() AND active));
CREATE FUNCTION public.add_checkout_check(p_source_id uuid,p_snapshot jsonb,p_instruction text,p_request_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.team_members;m public.maintenance;p public.checkout_check_prompts;s jsonb;
BEGIN
 IF current_setting('role',true)<>'authenticated' THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO a FROM public.team_members WHERE id=auth.uid() AND active AND role='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE insufficient_privilege;END IF;
 IF p_request_key IS NULL OR coalesce(length(btrim(p_instruction)),0) NOT BETWEEN 10 AND 500 THEN RAISE check_violation;END IF;
 SELECT * INTO m FROM public.maintenance WHERE id=p_source_id FOR UPDATE;
 IF NOT FOUND OR m.priority='scheduled' OR m.status='resolved' THEN RETURN jsonb_build_object('ok',false,'error','Selecciona un correctivo abierto; no se convierten preventivos.');END IF;
 s:=jsonb_build_object('id',m.id,'property_id',m.property_id,'title',m.title,'status',m.status,'priority',m.priority,'fingerprint',md5(coalesce(m.description,'')||chr(31)||coalesce(m.notes,'')));
 IF s IS DISTINCT FROM p_snapshot THEN RETURN jsonb_build_object('ok',false,'error','El reporte cambió. Actualiza antes de seleccionar.');END IF;
 SELECT * INTO p FROM public.checkout_check_prompts WHERE request_key=p_request_key;
 IF FOUND THEN
 IF p.source_snapshot IS DISTINCT FROM s OR p.instruction IS DISTINCT FROM btrim(p_instruction) OR p.actor_id<>a.id THEN RETURN jsonb_build_object('ok',false,'error','Reintento contradictorio.');END IF;
 ELSE
 SELECT * INTO p FROM public.checkout_check_prompts WHERE source_id=m.id AND source_snapshot=s AND instruction=btrim(p_instruction);
 IF NOT FOUND THEN INSERT INTO public.checkout_check_prompts(source_id,property_id,source_snapshot,instruction,actor_id,author,request_key) VALUES(m.id,m.property_id,s,btrim(p_instruction),a.id,a.name,p_request_key) RETURNING * INTO p;END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'id',p.id);
END $$;
CREATE FUNCTION public.skip_checkout_check(p_prompt_id uuid,p_reservation_id uuid,p_stay jsonb,p_source jsonb,p_reason text,p_request_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.team_members;r public.reservations;m public.maintenance;p public.checkout_check_prompts;k public.checkout_check_skips;s jsonb;
BEGIN
 IF current_setting('role',true)<>'authenticated' THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO a FROM public.team_members WHERE id=auth.uid() AND active AND role IN('admin','anfitrion','cleaning') FOR SHARE;
 IF NOT FOUND THEN RAISE insufficient_privilege;END IF;
 IF p_request_key IS NULL OR coalesce(length(btrim(p_reason)),0) NOT BETWEEN 3 AND 500 THEN RAISE check_violation;END IF;
 SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'confirmed' OR r.check_out<>(clock_timestamp() AT TIME ZONE 'America/Bogota')::date OR p_stay IS DISTINCT FROM jsonb_build_object('id',r.id,'property_id',r.property_id,'check_in',r.check_in,'check_out',r.check_out) THEN RETURN jsonb_build_object('ok',false,'error','La salida cambió o no corresponde a hoy.');END IF;
 SELECT * INTO p FROM public.checkout_check_prompts WHERE id=p_prompt_id;
 IF NOT FOUND OR p.property_id<>r.property_id THEN RAISE check_violation;END IF;
 SELECT * INTO m FROM public.maintenance WHERE id=p.source_id FOR SHARE;
 s:=jsonb_build_object('id',m.id,'property_id',m.property_id,'title',m.title,'status',m.status,'priority',m.priority,'fingerprint',md5(coalesce(m.description,'')||chr(31)||coalesce(m.notes,'')));
 IF s IS DISTINCT FROM p_source OR s IS DISTINCT FROM p.source_snapshot OR m.status='resolved' OR m.priority='scheduled' THEN RETURN jsonb_build_object('ok',false,'error','El reporte cambió. Revisa el aviso de nuevo.');END IF;
 SELECT * INTO k FROM public.checkout_check_skips WHERE request_key=p_request_key;
 IF FOUND THEN
 IF k.prompt_id<>p.id OR k.reservation_id<>r.id OR k.stay_snapshot IS DISTINCT FROM p_stay OR k.source_snapshot IS DISTINCT FROM s OR k.reason<>btrim(p_reason) OR k.actor_id<>a.id THEN RETURN jsonb_build_object('ok',false,'error','Reintento contradictorio.');END IF;
 ELSE
 SELECT * INTO k FROM public.checkout_check_skips WHERE prompt_id=p.id AND reservation_id=r.id AND stay_snapshot=p_stay AND source_snapshot=s;
 IF FOUND AND k.reason<>btrim(p_reason) THEN RETURN jsonb_build_object('ok',false,'error','Esta salida ya tiene una omisión registrada. Se conserva el motivo original.');END IF;
 IF NOT FOUND THEN INSERT INTO public.checkout_check_skips(prompt_id,reservation_id,stay_snapshot,source_snapshot,reason,actor_id,author,request_key) VALUES(p.id,r.id,p_stay,s,btrim(p_reason),a.id,a.name,p_request_key) RETURNING * INTO k;END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'id',k.id);
END $$;
REVOKE ALL ON FUNCTION public.add_checkout_check(uuid,jsonb,text,uuid),public.skip_checkout_check(uuid,uuid,jsonb,jsonb,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.add_checkout_check(uuid,jsonb,text,uuid),public.skip_checkout_check(uuid,uuid,jsonb,jsonb,text,uuid) TO authenticated;
COMMIT;
