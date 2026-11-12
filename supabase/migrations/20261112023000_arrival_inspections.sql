-- Checklist físico por llegada y evidencia privada. Aplicar SOLO con autorización de Diego.
-- Recuperación: retirar la UI/RPC del despliegue conservando tablas, incidencias y fotografías.
-- No transforma revisiones históricas, no marca preparación lista y no modifica reservas.
BEGIN;
CREATE SCHEMA IF NOT EXISTS airadmin_inspection;
REVOKE ALL ON SCHEMA airadmin_inspection FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA airadmin_inspection TO authenticated;
CREATE TABLE public.arrival_inspections (
 reservation_id uuid PRIMARY KEY REFERENCES public.reservations(id) ON DELETE RESTRICT,
 property_id uuid NOT NULL REFERENCES public.properties(id), stay_check_in date NOT NULL, stay_check_out date NOT NULL,
 version integer NOT NULL DEFAULT 0 CHECK(version>=0), checks jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(checks)='object'),
 invalidated_at timestamptz, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(stay_check_out>stay_check_in)
);
CREATE TABLE public.arrival_inspection_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
 version integer NOT NULL, actor_id uuid REFERENCES public.team_members(id), author text NOT NULL,
 action text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp(), payload jsonb, before_data jsonb, after_data jsonb NOT NULL,
 request_key text, UNIQUE(reservation_id,version), UNIQUE(reservation_id,request_key)
);
ALTER TABLE public.arrival_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arrival_inspection_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY inspection_team_read ON public.arrival_inspections FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active));
CREATE POLICY inspection_history_team_read ON public.arrival_inspection_history FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active));
REVOKE ALL ON public.arrival_inspections, public.arrival_inspection_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.arrival_inspections, public.arrival_inspection_history TO authenticated,service_role;
CREATE FUNCTION airadmin_inspection.record(p_reservation_id uuid,p_property_id uuid,p_stay_check_in date,p_stay_check_out date,
 p_item text,p_result text,p_note text,p_photo_path text,p_expected_version int,p_request_key text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.reservations; actor public.team_members; s public.arrival_inspections;
 previous public.arrival_inspection_history; payload jsonb; prior jsonb; check_data jsonb; checks jsonb;
 issue_id uuid; today date; stamp timestamptz; photo_exists boolean; label text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE serialization_failure USING MESSAGE='Actualiza la revisión.'; END IF;
 IF current_setting('role',true)<>'authenticated' OR auth.uid() IS NULL THEN RAISE insufficient_privilege; END IF;
 SELECT * INTO actor FROM public.team_members WHERE id=auth.uid() AND active AND role IN ('admin','anfitrion','cleaning','maintenance') FOR SHARE;
 IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
 IF p_item IS NULL OR p_item NOT IN ('air','lights','water','linen','utensils') OR p_result IS NULL OR p_result NOT IN ('checked','issue','not_applicable')
  OR p_note IS NULL OR length(p_note)>1000 OR (p_result<>'checked' AND length(btrim(p_note))<10)
  OR p_expected_version IS NULL OR p_expected_version<0 OR p_request_key IS NULL OR length(btrim(p_request_key)) NOT BETWEEN 1 AND 200 THEN
  RAISE check_violation USING MESSAGE='Datos de revisión inválidos.'; END IF;
 -- Serializar revisiones del mismo apartamento y evitar bloqueo cruzado al crear incidencias.
 PERFORM id FROM public.reservations WHERE property_id=p_property_id ORDER BY id FOR UPDATE;
 -- Serializar contra cambios de fechas/cancelaciones y otras revisiones de la misma llegada.
 SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE check_violation USING MESSAGE='Reserva inexistente.'; END IF;
 SELECT * INTO s FROM public.arrival_inspections WHERE reservation_id=r.id FOR UPDATE;
 IF r.status<>'confirmed' OR r.property_id IS DISTINCT FROM p_property_id OR r.check_in IS DISTINCT FROM p_stay_check_in OR r.check_out IS DISTINCT FROM p_stay_check_out THEN
  RETURN jsonb_build_object('ok',false,'conflict',true,'error','La estancia cambió. Actualiza antes de revisar.'); END IF;
 payload:=jsonb_build_object('property',p_property_id,'arrival',p_stay_check_in,'departure',p_stay_check_out,'item',p_item,'result',p_result,
  'note',btrim(p_note),'photo',p_photo_path,'version',p_expected_version,'actor',actor.id);
 SELECT * INTO previous FROM public.arrival_inspection_history WHERE reservation_id=r.id AND request_key=p_request_key;
 IF FOUND THEN
  IF previous.payload IS DISTINCT FROM payload THEN RAISE check_violation USING MESSAGE='Clave de reintento reutilizada.'; END IF;
  IF s.invalidated_at IS NOT NULL OR s.version IS DISTINCT FROM previous.version THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','El checklist cambió después del registro. Actualiza antes de repetir.'); END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'data',to_jsonb(s));
 END IF;
 IF coalesce(s.version,0)<>p_expected_version THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','Otra persona actualizó el checklist. Actualiza y revisa.'); END IF;
 today:=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date;
 IF today NOT BETWEEN r.check_in-1 AND r.check_in THEN RETURN jsonb_build_object('ok',false,'error','Revisa el día anterior o el día de llegada.'); END IF;
 IF EXISTS(SELECT 1 FROM public.reservations o WHERE o.id<>r.id AND o.property_id=r.property_id AND o.status='confirmed' AND o.check_in<=today AND o.check_out>today) THEN
  RETURN jsonb_build_object('ok',false,'error','Otra estancia sigue vigente. Comprueba la salida antes de revisar.'); END IF;
 IF p_photo_path IS NOT NULL THEN
  IF p_photo_path !~ ('^'||actor.id::text||'/'||r.id::text||'/[0-9a-f-]{36}\.(jpg|png|webp)$') THEN RAISE check_violation USING MESSAGE='Ruta de fotografía inválida.'; END IF;
  IF to_regclass('storage.objects') IS NULL THEN RAISE check_violation USING MESSAGE='El almacenamiento privado no está disponible.'; END IF;
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=$1 AND name=$2)' INTO photo_exists USING 'inspection-evidence',p_photo_path;
  IF NOT photo_exists THEN RAISE check_violation USING MESSAGE='La foto no está guardada.'; END IF;
 END IF;
 prior:=to_jsonb(s); stamp:=clock_timestamp();
 checks:=CASE WHEN s.invalidated_at IS NULL AND s.property_id=r.property_id AND s.stay_check_in=r.check_in AND s.stay_check_out=r.check_out THEN coalesce(s.checks,'{}') ELSE '{}' END;
 issue_id:=CASE WHEN s.property_id=r.property_id THEN nullif(s.checks->p_item->>'maintenance_id','')::uuid ELSE NULL END;
 -- Una incidencia previa no se resuelve por marcar un punto como revisado. Se sigue en Mantenimiento.
 IF p_result='issue' THEN
  IF issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.maintenance WHERE id=issue_id AND property_id=r.property_id AND status<>'resolved' AND priority<>'scheduled') THEN issue_id:=NULL; END IF;
  label:=CASE p_item WHEN 'air' THEN 'Aires y controles' WHEN 'lights' THEN 'Luces' WHEN 'water' THEN 'Agua' WHEN 'linen' THEN 'Ropa de cama y toallas' ELSE 'Utensilios' END;
  IF issue_id IS NULL THEN
   INSERT INTO public.maintenance(property_id,title,description,priority,reported_by)
   VALUES(r.property_id,'Revisión de llegada · '||label,btrim(p_note),CASE WHEN p_item IN ('air','water','lights') THEN 'urgent' ELSE 'normal' END,actor.id) RETURNING id INTO issue_id;
  ELSE
   UPDATE public.maintenance SET notes=coalesce(notes,'')||E'\n'||to_char(stamp AT TIME ZONE 'America/Bogota','YYYY-MM-DD HH24:MI')||' · '||actor.name||': '||btrim(p_note) WHERE id=issue_id;
  END IF;
 END IF;
 check_data:=jsonb_build_object('result',p_result,'note',btrim(p_note),'actor_id',actor.id,'author',actor.name,'at',stamp,'photo_path',p_photo_path,'maintenance_id',issue_id);
 checks:=jsonb_set(checks,ARRAY[p_item],check_data,true);
 INSERT INTO public.arrival_inspections(reservation_id,property_id,stay_check_in,stay_check_out,version,checks,updated_at)
 VALUES(r.id,r.property_id,r.check_in,r.check_out,coalesce(s.version,0)+1,checks,stamp)
 ON CONFLICT(reservation_id) DO UPDATE SET property_id=EXCLUDED.property_id,stay_check_in=EXCLUDED.stay_check_in,stay_check_out=EXCLUDED.stay_check_out,
  version=EXCLUDED.version,checks=EXCLUDED.checks,invalidated_at=NULL,updated_at=EXCLUDED.updated_at RETURNING * INTO s;
 INSERT INTO public.arrival_inspection_history(reservation_id,version,actor_id,author,action,payload,before_data,after_data,request_key)
 VALUES(r.id,s.version,actor.id,actor.name,'item:'||p_item,payload,prior,to_jsonb(s),p_request_key);
 RETURN jsonb_build_object('ok',true,'replayed',false,'data',to_jsonb(s));
END $$;
REVOKE ALL ON FUNCTION airadmin_inspection.record(uuid,uuid,date,date,text,text,text,text,int,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION airadmin_inspection.record(uuid,uuid,date,date,text,text,text,text,int,text) TO authenticated;
CREATE FUNCTION public.record_arrival_inspection(p_reservation_id uuid,p_property_id uuid,p_stay_check_in date,p_stay_check_out date,
 p_item text,p_result text,p_note text,p_photo_path text,p_expected_version int,p_request_key text)
 RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT airadmin_inspection.record(p_reservation_id,p_property_id,p_stay_check_in,p_stay_check_out,p_item,p_result,p_note,p_photo_path,p_expected_version,p_request_key)
$$;
REVOKE ALL ON FUNCTION public.record_arrival_inspection(uuid,uuid,date,date,text,text,text,text,int,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_arrival_inspection(uuid,uuid,date,date,text,text,text,text,int,text) TO authenticated;
CREATE FUNCTION airadmin_inspection.invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.arrival_inspections; prior jsonb;
BEGIN
 IF (NEW.check_in,NEW.check_out,NEW.property_id,NEW.status) IS NOT DISTINCT FROM (OLD.check_in,OLD.check_out,OLD.property_id,OLD.status) THEN RETURN NEW; END IF;
 SELECT * INTO s FROM public.arrival_inspections WHERE reservation_id=NEW.id FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 prior:=to_jsonb(s);
 UPDATE public.arrival_inspections SET invalidated_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE reservation_id=NEW.id RETURNING * INTO s;
 INSERT INTO public.arrival_inspection_history(reservation_id,version,author,action,before_data,after_data)
 VALUES(NEW.id,s.version,'Sistema de AirAdmin','invalidated',prior,to_jsonb(s));
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION airadmin_inspection.invalidate() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER inspection_stay_changed AFTER UPDATE OF check_in,check_out,property_id,status ON public.reservations FOR EACH ROW EXECUTE FUNCTION airadmin_inspection.invalidate();
CREATE TRIGGER inspection_no_delete BEFORE DELETE ON public.arrival_inspections FOR EACH ROW EXECUTE FUNCTION airadmin_preparation.no_delete();
CREATE TRIGGER inspection_history_no_delete BEFORE DELETE ON public.arrival_inspection_history FOR EACH ROW EXECUTE FUNCTION airadmin_preparation.no_delete();
-- Evidencia exclusivamente privada. Storage existe en Supabase; el ejecutor SQL local usa un stub.
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
  RAISE EXCEPTION 'Se requiere Storage (o el stub LOCAL de pruebas) para instalar evidencia privada.';
 END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('inspection-evidence','inspection-evidence',false,5242880,ARRAY['image/jpeg','image/png','image/webp']);
CREATE POLICY inspection_photos_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='inspection-evidence'
 AND EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active));
CREATE POLICY inspection_photos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='inspection-evidence'
 AND split_part(name,'/',1)=(SELECT auth.uid())::text AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
 AND EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active)
 AND EXISTS(SELECT 1 FROM public.reservations r WHERE r.id::text=split_part(name,'/',2) AND r.status='confirmed'
  AND (clock_timestamp() AT TIME ZONE 'America/Bogota')::date BETWEEN r.check_in-1 AND r.check_in));
-- Una política antigua permisiva de Storage no debe abrir este bucket.
CREATE POLICY inspection_photos_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id<>'inspection-evidence' OR EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active));
CREATE POLICY inspection_photos_insert_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'inspection-evidence' OR (split_part(name,'/',1)=(SELECT auth.uid())::text
 AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
 AND EXISTS(SELECT 1 FROM public.team_members WHERE id=(SELECT auth.uid()) AND active)
 AND EXISTS(SELECT 1 FROM public.reservations r WHERE r.id::text=split_part(name,'/',2) AND r.status='confirmed'
 AND (clock_timestamp() AT TIME ZONE 'America/Bogota')::date BETWEEN r.check_in-1 AND r.check_in)));
CREATE POLICY inspection_photos_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id<>'inspection-evidence') WITH CHECK(bucket_id<>'inspection-evidence');
CREATE POLICY inspection_photos_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING(bucket_id<>'inspection-evidence');
CREATE POLICY inspection_photos_no_anon ON storage.objects AS RESTRICTIVE FOR ALL TO anon USING(bucket_id<>'inspection-evidence') WITH CHECK(bucket_id<>'inspection-evidence');
CREATE FUNCTION airadmin_inspection.intervening_stay() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item record; s public.arrival_inspections; prior jsonb;
BEGIN
 IF NEW.status<>'confirmed' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.check_in,NEW.check_out,NEW.property_id,NEW.status) IS NOT DISTINCT FROM (OLD.check_in,OLD.check_out,OLD.property_id,OLD.status) THEN RETURN NEW; END IF;
 FOR item IN SELECT r.id FROM public.reservations r WHERE r.id<>NEW.id AND r.property_id=NEW.property_id AND r.status='confirmed'
 AND r.check_in>=(clock_timestamp() AT TIME ZONE 'America/Bogota')::date AND NEW.check_in<=r.check_in ORDER BY r.id FOR UPDATE LOOP
 SELECT * INTO s FROM public.arrival_inspections WHERE reservation_id=item.id FOR UPDATE;
 IF FOUND AND s.invalidated_at IS NULL AND NEW.check_out>(s.updated_at AT TIME ZONE 'America/Bogota')::date THEN
 prior:=to_jsonb(s);
 UPDATE public.arrival_inspections SET invalidated_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE reservation_id=item.id RETURNING * INTO s;
 INSERT INTO public.arrival_inspection_history(reservation_id,version,author,action,before_data,after_data)
 VALUES(item.id,s.version,'Sistema de AirAdmin','intervening_stay',prior,to_jsonb(s));
 END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION airadmin_inspection.intervening_stay() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER inspection_intervening_stay AFTER INSERT OR UPDATE OF check_in,check_out,property_id,status ON public.reservations FOR EACH ROW EXECUTE FUNCTION airadmin_inspection.intervening_stay();
COMMIT;
