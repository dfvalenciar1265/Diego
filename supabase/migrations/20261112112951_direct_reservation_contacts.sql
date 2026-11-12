-- LOCAL/BRANCH ONLY: contacto privado, no envíos, no columnas en reservas de lectura general.
BEGIN;
CREATE SCHEMA airadmin_contacts;
REVOKE ALL ON SCHEMA airadmin_contacts FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA airadmin_contacts TO authenticated;
CREATE TABLE public.direct_reservation_contacts (
 reservation_id uuid PRIMARY KEY REFERENCES public.reservations(id) ON DELETE RESTRICT,
 phone text NOT NULL CHECK(phone='' OR phone ~ '^\+[1-9][0-9]{6,14}$'),
 version int NOT NULL CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid NOT NULL REFERENCES public.team_members(id)
);
CREATE TABLE airadmin_contacts.history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reservation_id uuid NOT NULL REFERENCES public.reservations(id),
 actor_id uuid NOT NULL REFERENCES public.team_members(id),at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_key text NOT NULL,payload jsonb NOT NULL,before_data jsonb,after_data jsonb NOT NULL,UNIQUE(actor_id,request_key)
);
ALTER TABLE public.direct_reservation_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE airadmin_contacts.history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.direct_reservation_contacts,airadmin_contacts.history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.direct_reservation_contacts TO authenticated;
CREATE POLICY "admin reads direct contacts" ON public.direct_reservation_contacts FOR SELECT TO authenticated USING(public.airadmin_is_admin());
CREATE FUNCTION airadmin_contacts.save(p_reservation_id uuid,p_phone text,p_expected_version int,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.team_members;r public.reservations;c public.direct_reservation_contacts;h airadmin_contacts.history;payload jsonb;old jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE serialization_failure;END IF;
 IF current_setting('role',true)<>'authenticated' OR auth.uid() IS NULL THEN RAISE insufficient_privilege;END IF;
 SELECT * INTO a FROM public.team_members WHERE id=auth.uid() AND active AND role='admin' FOR SHARE;
 IF NOT FOUND THEN RAISE insufficient_privilege;END IF;
 IF p_phone IS NULL OR (p_phone<>'' AND p_phone !~ '^\+[1-9][0-9]{6,14}$') OR p_expected_version IS NULL OR p_expected_version<0 OR coalesce(length(btrim(p_request_key)),0) NOT BETWEEN 1 AND 200 THEN RAISE check_violation;END IF;
 payload:=jsonb_build_object('reservation_id',p_reservation_id,'phone',p_phone,'expected_version',p_expected_version);
 PERFORM pg_advisory_xact_lock(hashtextextended('direct-contact:'||a.id||':'||p_request_key,0));
 SELECT * INTO h FROM airadmin_contacts.history WHERE actor_id=a.id AND request_key=p_request_key;
 IF FOUND THEN
  IF h.payload IS DISTINCT FROM payload THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','La clave corresponde a otro cambio de contacto.');END IF;
  SELECT * INTO c FROM public.direct_reservation_contacts WHERE reservation_id=p_reservation_id;
  IF c.version IS DISTINCT FROM (h.after_data->>'version')::int THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','El contacto cambió después. Relee antes de editar.');END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'data',to_jsonb(c));
 END IF;
 SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
 IF NOT FOUND OR r.source IS DISTINCT FROM 'direct' OR r.status='cancelled' THEN RETURN jsonb_build_object('ok',false,'error','Solo contactos de reservas directas no canceladas.');END IF;
 SELECT * INTO c FROM public.direct_reservation_contacts WHERE reservation_id=r.id FOR UPDATE;
 IF coalesce(c.version,0)<>p_expected_version THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','Otra persona cambió el teléfono. Relee para no sobrescribir.');END IF;
 old:=CASE WHEN c.reservation_id IS NULL THEN NULL ELSE to_jsonb(c) END;
 INSERT INTO public.direct_reservation_contacts(reservation_id,phone,version,updated_by) VALUES(r.id,p_phone,1,a.id)
 ON CONFLICT(reservation_id) DO UPDATE SET phone=excluded.phone,version=direct_reservation_contacts.version+1,updated_by=a.id,updated_at=clock_timestamp() RETURNING * INTO c;
 INSERT INTO airadmin_contacts.history(reservation_id,actor_id,request_key,payload,before_data,after_data) VALUES(r.id,a.id,p_request_key,payload,old,to_jsonb(c));
 RETURN jsonb_build_object('ok',true,'data',to_jsonb(c));
END $$;
REVOKE ALL ON FUNCTION airadmin_contacts.save(uuid,text,int,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION airadmin_contacts.save(uuid,text,int,text) TO authenticated;
CREATE FUNCTION public.save_direct_reservation_contact(p_reservation_id uuid,p_phone text,p_expected_version int,p_request_key text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT airadmin_contacts.save(p_reservation_id,p_phone,p_expected_version,p_request_key) $$;
REVOKE ALL ON FUNCTION public.save_direct_reservation_contact(uuid,text,int,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_direct_reservation_contact(uuid,text,int,text) TO authenticated;
COMMIT;
