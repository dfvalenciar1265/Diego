-- Horarios separados por reserva. Aplicar solo con aprobación de Diego, después de 20261019130000.
-- Recuperación: volver a la app anterior conservando esta tabla; HH:MM|nota sigue siendo compatible.
-- No borrar el historial ni volver a ejecutar las migraciones anteriores.
BEGIN;

ALTER TABLE public.reservations ADD COLUMN time_version int NOT NULL DEFAULT 0 CHECK (time_version >= 0);

CREATE TABLE public.reservation_time_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('checkin', 'checkout')),
  kind text NOT NULL CHECK (kind IN ('estimate', 'authorization', 'platform')),
  time text CHECK (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  stay_check_in date NOT NULL,
  stay_check_out date NOT NULL,
  property_id uuid NOT NULL REFERENCES public.properties(id),
  source text NOT NULL CHECK (source IN ('app', 'mcp', 'gmail', 'legacy')),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 1 AND 200),
  actor_id uuid REFERENCES public.team_members(id),
  author text NOT NULL,
  observed_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL CHECK (version > 0),
  task_id uuid, -- referencia histórica: las tareas pueden desaparecer; el hecho se conserva
  invalidated_at timestamptz,
  UNIQUE (reservation_id, version),
  UNIQUE (reservation_id, source, request_key),
  CHECK (stay_check_out > stay_check_in),
  CHECK (source <> 'gmail' OR (kind <> 'authorization' AND time IS NOT NULL AND observed_at IS NOT NULL)),
  CHECK (source NOT IN ('app', 'mcp') OR (actor_id IS NOT NULL AND observed_at IS NOT NULL))
);
CREATE INDEX reservation_time_events_reservation ON public.reservation_time_events (reservation_id, version DESC);
ALTER TABLE public.reservation_time_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active team reads times" ON public.reservation_time_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND active));
REVOKE ALL ON public.reservation_time_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.reservation_time_events TO authenticated, service_role;

-- Captura única de las excepciones heredadas. Se desconoce quién/cuándo las autorizó originalmente.
INSERT INTO public.reservation_time_events
  (reservation_id, direction, kind, time, stay_check_in, stay_check_out, property_id,
   source, request_key, author, version, task_id, invalidated_at)
SELECT r.id, CASE t.type WHEN 'cleaning' THEN 'checkout' ELSE 'checkin' END, 'authorization',
       left(t.notes, 5), r.check_in, r.check_out, r.property_id, 'legacy', t.id::text,
       'Autor original desconocido', row_number() OVER (PARTITION BY r.id ORDER BY t.created_at, t.id), t.id,
       CASE WHEN r.status <> 'confirmed' OR t.property_id <> r.property_id
         OR (t.type = 'cleaning' AND t.scheduled_for <> r.check_out)
         OR (t.type = 'preparation' AND t.scheduled_for NOT BETWEEN r.check_in - 1 AND r.check_in) THEN now() END
FROM public.tasks t JOIN public.reservations r ON r.id = t.reservation_id
WHERE t.notes ~ '^([01][0-9]|2[0-3]):[0-5][0-9]\|'
  AND t.type IN ('cleaning', 'preparation');

-- Un prefijo de otra estancia se conserva en el historial, pero deja de proyectarse como permiso.
UPDATE public.tasks t SET notes = regexp_replace(t.notes, '^\d{2}:\d{2}\|', '')
  WHERE EXISTS (SELECT 1 FROM public.reservation_time_events e WHERE e.task_id = t.id AND e.invalidated_at IS NOT NULL);

-- API estrecha: el definidor es necesario porque ningún cliente tiene INSERT/UPDATE en el historial.
-- Comprueba identidad/rol en cada llamada; jamás confía en user_metadata ni en un autor del navegador.
UPDATE public.reservations r SET time_version = e.version FROM
  (SELECT reservation_id, max(version) AS version FROM public.reservation_time_events GROUP BY reservation_id) e
  WHERE r.id = e.reservation_id;

CREATE FUNCTION public.guard_reservation_time_version() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ((TG_OP = 'INSERT' AND NEW.time_version <> 0) OR
      (TG_OP = 'UPDATE' AND NEW.time_version IS DISTINCT FROM OLD.time_version))
    AND current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.reservations'::regclass)) THEN
    RAISE EXCEPTION 'La versión de horarios solo la mantiene el sistema' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_reservation_time_version BEFORE INSERT OR UPDATE OF time_version ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_time_version();
REVOKE ALL ON FUNCTION public.guard_reservation_time_version() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.record_reservation_time(
  p_reservation_id uuid, p_direction text, p_kind text, p_time text,
  p_expected_version int, p_request_key text, p_source text DEFAULT 'app',
  p_actor_id uuid DEFAULT NULL, p_observed_at timestamptz DEFAULT NULL,
  p_stay_check_in date DEFAULT NULL, p_stay_check_out date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.reservations;
  previous public.reservation_time_events;
  result public.reservation_time_events;
  actor uuid;
  actor_name text;
  current_version int;
  target_task uuid;
BEGIN
  IF p_source = 'app' AND auth.uid() IS NOT NULL THEN
    actor := auth.uid();
  ELSIF current_setting('role', true) = 'service_role' AND p_source IN ('mcp', 'gmail') THEN
    actor := p_actor_id;
  ELSE
    RAISE EXCEPTION 'Solo un administrador activo registra horarios manuales' USING ERRCODE = '42501';
  END IF;
  IF p_source = 'gmail' THEN
    IF p_kind NOT IN ('estimate', 'platform') OR actor IS NOT NULL OR p_observed_at IS NULL THEN
      RAISE EXCEPTION 'Gmail no autoriza excepciones' USING ERRCODE = '42501';
    END IF;
    actor_name := CASE p_kind WHEN 'estimate' THEN 'Huésped (ETA explícita en correo)' ELSE 'Airbnb (horario del correo)' END;
  ELSE
    SELECT name INTO actor_name FROM public.team_members WHERE id = actor AND role = 'admin' AND active;
    IF actor_name IS NULL OR p_kind NOT IN ('estimate', 'authorization') THEN
      RAISE EXCEPTION 'Solo un administrador activo registra horarios manuales' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_direction NOT IN ('checkin', 'checkout') OR p_kind NOT IN ('estimate', 'authorization', 'platform')
     OR (p_time IS NOT NULL AND p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     OR p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Horario inválido' USING ERRCODE = '22023';
  END IF;
  -- Orden de bloqueo común con cambios de fechas/cancelaciones y con otras escrituras del RPC.
  SELECT * INTO r FROM public.reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'confirmed' THEN
    RAISE EXCEPTION 'La reserva no está confirmada' USING ERRCODE = '22023';
  END IF;
  IF p_source <> 'gmail' AND (p_stay_check_in IS DISTINCT FROM r.check_in OR p_stay_check_out IS DISTINCT FROM r.check_out) THEN
    RAISE EXCEPTION 'La estancia cambió; revisa el horario antes de guardar' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO previous FROM public.reservation_time_events
    WHERE reservation_id = r.id AND source = p_source AND request_key = p_request_key;
  IF FOUND THEN
    IF (previous.direction, previous.kind, previous.time, previous.actor_id, previous.stay_check_in, previous.stay_check_out)
       IS DISTINCT FROM (p_direction, p_kind, p_time, actor, coalesce(p_stay_check_in, r.check_in), coalesce(p_stay_check_out, r.check_out)) THEN
      RAISE EXCEPTION 'La clave de reintento ya se usó con otros datos' USING ERRCODE = '22023';
    END IF;
    IF previous.invalidated_at IS NOT NULL AND p_source <> 'gmail' THEN
      RAISE EXCEPTION 'El horario anterior requiere nueva confirmación' USING ERRCODE = '40001';
    END IF;
    RETURN to_jsonb(previous);
  END IF;
  current_version := r.time_version;
  IF p_source <> 'gmail' AND p_expected_version IS DISTINCT FROM current_version THEN
    RAISE EXCEPTION 'El horario cambió; consulta el estado actual antes de reintentar' USING ERRCODE = '40001';
  END IF;
  -- Clientes antiguos sin clave estable: repetir el mismo valor vigente tampoco duplica.
  IF p_source <> 'gmail' THEN
    SELECT * INTO previous FROM public.reservation_time_events WHERE reservation_id = r.id
      AND direction = p_direction AND kind = p_kind AND source <> 'gmail' AND invalidated_at IS NULL
      ORDER BY version DESC LIMIT 1;
    IF FOUND AND previous.source = p_source AND previous.actor_id = actor AND previous.time IS NOT DISTINCT FROM p_time THEN
      RETURN to_jsonb(previous);
    END IF;
  END IF;
  SELECT id INTO target_task FROM public.tasks WHERE reservation_id = r.id AND property_id = r.property_id
    AND ((p_direction = 'checkout' AND type = 'cleaning' AND scheduled_for = r.check_out)
      OR (p_direction = 'checkin' AND type = 'preparation' AND scheduled_for BETWEEN r.check_in - 1 AND r.check_in))
    ORDER BY id LIMIT 1;
  IF p_kind = 'authorization' AND p_time IS NOT NULL AND target_task IS NULL THEN
    RAISE EXCEPTION 'Falta la tarea de limpieza o preparación de esta estancia; sincroniza para repararla' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.reservation_time_events
    (reservation_id, direction, kind, time, stay_check_in, stay_check_out, property_id,
     source, request_key, actor_id, author, observed_at, version, task_id, invalidated_at)
  VALUES (r.id, p_direction, p_kind, p_time, coalesce(p_stay_check_in, r.check_in), coalesce(p_stay_check_out, r.check_out), r.property_id,
    p_source, p_request_key, actor, actor_name,
    CASE WHEN p_source = 'gmail' THEN p_observed_at ELSE clock_timestamp() END, current_version + 1, target_task,
    CASE WHEN p_stay_check_in IS DISTINCT FROM r.check_in OR p_stay_check_out IS DISTINCT FROM r.check_out THEN clock_timestamp() END)
  RETURNING * INTO result;
  UPDATE public.reservations SET time_version = result.version WHERE id = r.id;
  -- Proyección compatible. Una ETA o un horario de plataforma nunca escribe HH:MM|.
  IF p_kind = 'authorization' AND pg_trigger_depth() = 0 THEN
    UPDATE public.tasks SET notes = coalesce(p_time || '|', '') || regexp_replace(coalesce(notes, ''), '^\d{2}:\d{2}\|', '')
      WHERE reservation_id = r.id AND property_id = r.property_id
      AND ((p_direction = 'checkout' AND type = 'cleaning' AND scheduled_for = r.check_out)
        OR (p_direction = 'checkin' AND type = 'preparation' AND scheduled_for BETWEEN r.check_in - 1 AND r.check_in));
  END IF;
  RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.record_reservation_time(uuid,text,text,text,int,text,text,uuid,timestamptz,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_reservation_time(uuid,text,text,text,int,text,text,uuid,timestamptz,date,date) TO authenticated, service_role;

-- Los clientes anteriores que escriben HH:MM| también dejan procedencia, dentro de la transacción.
CREATE FUNCTION public.capture_task_time() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  next_time text;
  old_time text;
  event_direction text;
  revision int;
  r public.reservations;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.reservation_id, NEW.property_id, NEW.type, NEW.scheduled_for)
       IS DISTINCT FROM (OLD.reservation_id, OLD.property_id, OLD.type, OLD.scheduled_for) THEN
    UPDATE public.reservations SET time_version = time_version + 1 WHERE id = OLD.reservation_id;
    UPDATE public.reservation_time_events SET invalidated_at = clock_timestamp()
      WHERE task_id = OLD.id AND invalidated_at IS NULL;
    NEW.notes := regexp_replace(coalesce(NEW.notes, ''), '^\d{2}:\d{2}\|', '');
    RETURN NEW;
  END IF;
  IF NEW.reservation_id IS NULL OR NEW.type NOT IN ('cleaning', 'preparation') THEN RETURN NEW; END IF;
  next_time := substring(NEW.notes FROM '^(([01][0-9]|2[0-3]):[0-5][0-9])\|');
  IF TG_OP = 'UPDATE' THEN old_time := substring(OLD.notes FROM '^(([01][0-9]|2[0-3]):[0-5][0-9])\|'); END IF;
  IF next_time IS NOT DISTINCT FROM old_time THEN RETURN NEW; END IF;
  event_direction := CASE NEW.type WHEN 'cleaning' THEN 'checkout' ELSE 'checkin' END;
  SELECT * INTO r FROM public.reservations WHERE id = NEW.reservation_id FOR UPDATE;
  IF NEW.property_id <> r.property_id OR r.status <> 'confirmed'
     OR (NEW.type = 'cleaning' AND NEW.scheduled_for <> r.check_out)
     OR (NEW.type = 'preparation' AND NEW.scheduled_for NOT BETWEEN r.check_in - 1 AND r.check_in) THEN
    RAISE EXCEPTION 'La tarea no corresponde a esta estancia' USING ERRCODE = '22023';
  END IF;
  -- El RPC ya dejó el hecho antes de actualizar las notas; no crear una copia.
  IF EXISTS (SELECT 1 FROM public.reservation_time_events WHERE reservation_id = r.id
      AND kind = 'authorization' AND reservation_time_events.direction = event_direction
      AND time IS NOT DISTINCT FROM next_time AND recorded_at = transaction_timestamp()
      AND invalidated_at IS NULL AND source IN ('app', 'mcp')
      AND version = (SELECT max(e.version) FROM public.reservation_time_events e WHERE e.reservation_id = r.id)) THEN RETURN NEW; END IF;
  revision := r.time_version;
  PERFORM public.record_reservation_time(r.id, event_direction, 'authorization', next_time, revision, gen_random_uuid()::text, 'app', NULL, NULL, r.check_in, r.check_out);
  RETURN NEW;
END $$;
CREATE TRIGGER capture_task_time BEFORE INSERT OR UPDATE OF notes, reservation_id, property_id, type, scheduled_for
  ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.capture_task_time();

CREATE FUNCTION public.invalidate_reservation_times() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.check_in, NEW.check_out, NEW.property_id, NEW.status)
     IS DISTINCT FROM (OLD.check_in, OLD.check_out, OLD.property_id, OLD.status) THEN
    UPDATE public.reservations SET time_version = time_version + 1 WHERE id = NEW.id;
    UPDATE public.reservation_time_events SET invalidated_at = clock_timestamp()
      WHERE reservation_id = NEW.id AND invalidated_at IS NULL;
    UPDATE public.tasks SET notes = regexp_replace(notes, '^\d{2}:\d{2}\|', '')
      WHERE reservation_id = NEW.id AND type IN ('cleaning', 'preparation') AND notes ~ '^\d{2}:\d{2}\|';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER invalidate_reservation_times AFTER UPDATE OF check_in, check_out, property_id, status
  ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.invalidate_reservation_times();
REVOKE ALL ON FUNCTION public.capture_task_time(), public.invalidate_reservation_times() FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
