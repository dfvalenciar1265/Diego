-- CASA BLUE: migration bundle for review, based on tested migrations 005-007.
-- Adds empty calendar structures; does not insert reservations, rules or verified runs.

-- ─────────────────────────────────────────────────────────────────────────────
-- 005_public_availability.sql — PROPUESTA, NO APLICADA
--
-- Lo que necesita GET /api/public/casa-blue/availability para poder responder "ready".
-- Mientras estas tablas no existan (o estén vacías) el endpoint responde sourceStatus
-- "unconfigured" con los ocho apartamentos en "unknown": nunca inventa disponibilidad.
--
-- 1. calendar_sync_runs: cada corrida de un sincronizador de calendario. Solo cuenta una corrida
--    status='complete' y verified=true: certifica que `reservations` tiene TODO lo que ocupa los
--    apartamentos de property_ids entre coverage_from y coverage_to (reservas, bloqueos / reservas
--    directas como status='blocked', cambios de fechas y cancelaciones). La importación de correos
--    de Gmail no escribe aquí: no trae los bloqueos del calendario de Airbnb.
-- 2. availability_rules: reglas reales por apartamento. Solo cuentan filas con verified_at.
--    Un NULL en una columna opcional significa "sin restricción", así que verified_at certifica la
--    fila completa: no marcar verificada una fila con datos supuestos.
--
-- RLS activo, solo administradores. El endpoint lee con la clave de servicio en el servidor;
-- no hay ninguna política para anon.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.calendar_sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT NOT NULL,                       -- p. ej. 'airbnb-ical'
  started_at    TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ,
  -- Instante desde el que los datos son seguros: el inicio de las descargas (no la hora de guardado).
  data_as_of    TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
  verified      BOOLEAN NOT NULL DEFAULT false,
  coverage_from DATE,
  coverage_to   DATE,
  property_ids  UUID[] NOT NULL DEFAULT '{}',
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT complete_has_coverage CHECK (
    status <> 'complete' OR (completed_at IS NOT NULL AND data_as_of IS NOT NULL
                             AND coverage_from IS NOT NULL AND coverage_to >= coverage_from)
  )
);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_runs_completed
  ON public.calendar_sync_runs (completed_at DESC) WHERE status = 'complete' AND verified;

CREATE TABLE IF NOT EXISTS public.availability_rules (
  property_id           UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  min_nights            INT NOT NULL CHECK (min_nights >= 1),
  max_nights            INT CHECK (max_nights IS NULL OR max_nights >= min_nights),
  -- Reglas por fecha de llegada (conjuntos de reglas / ajustes de Airbnb), `from`/`to` inclusivos:
  -- [{"from":"2026-12-15","to":"2027-01-10","min_nights":3,"check_in_days":[5,6]}]
  -- Campos admitidos: min_nights, max_nights, advance_notice_hours, check_in_days, check_out_days.
  date_overrides        JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(date_overrides) = 'array'),
  advance_notice_hours  INT NOT NULL CHECK (advance_notice_hours >= 0),
  booking_window_days   INT CHECK (booking_window_days IS NULL OR booking_window_days >= 0),
  preparation_nights    INT NOT NULL CHECK (preparation_nights BETWEEN 0 AND 7),
  same_day_turnover     BOOLEAN NOT NULL,
  turnover_hours        NUMERIC(4,1) CHECK (turnover_hours IS NULL OR turnover_hours >= 0),
  check_in_days         SMALLINT[],                  -- 0 = domingo … 6 = sábado; NULL = cualquier día
  check_out_days        SMALLINT[],
  check_in_time         TIME,
  check_out_time        TIME,
  verified_at           TIMESTAMPTZ,                 -- NULL = borrador, el endpoint lo ignora
  verified_by           UUID REFERENCES public.team_members(id),
  source_note           TEXT NOT NULL DEFAULT '',    -- de dónde salió (p. ej. "Airbnb > Disponibilidad, 18-oct-2026")
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.calendar_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can manage calendar sync runs"
  ON public.calendar_sync_runs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "admin can manage availability rules"
  ON public.availability_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND role = 'admin'));


-- ─────────────────────────────────────────────────────────────────────────────
-- 006_calendar_events.sql — PROPUESTA, NO APLICADA (requiere 005)
--
-- Ocupación que publica el calendario de Airbnb de cada anuncio (exportación iCal): reservas y
-- noches bloqueadas (que incluyen las reservas directas que Diego bloquea en Airbnb).
--
-- Tabla aparte a propósito: el sincronizador NUNCA toca `reservations`. Así no duplica las
-- reservas importadas por correo ni altera las cargadas a mano. Solo guarda fechas y tipo: nada
-- del SUMMARY/DESCRIPTION del iCal (código de reserva, teléfono, nombre).
--
-- record_calendar_sync() reemplaza los eventos de los apartamentos sincronizados y registra la
-- corrida verificada EN UNA SOLA TRANSACCIÓN: o queda todo (eventos + corrida verified) o nada.
-- Una corrida fallida se registra aparte, con verified = false, y no toca los eventos.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,                         -- 'airbnb-ical'
  uid         TEXT NOT NULL,                         -- UID del VEVENT (identificador opaco de Airbnb)
  start_date  DATE NOT NULL,                         -- primera noche
  end_date    DATE NOT NULL,                         -- día de salida
  kind        TEXT NOT NULL CHECK (kind IN ('reserved', 'blocked')),
  run_id      UUID NOT NULL REFERENCES public.calendar_sync_runs(id),
  CONSTRAINT calendar_events_dates CHECK (end_date > start_date),
  CONSTRAINT calendar_events_unique UNIQUE (property_id, source, uid)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_property_dates
  ON public.calendar_events (property_id, start_date, end_date);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin can read calendar events"
  ON public.calendar_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members WHERE id = auth.uid() AND role = 'admin'));

CREATE OR REPLACE FUNCTION public.record_calendar_sync(
  p_source        TEXT,
  p_started_at    TIMESTAMPTZ,
  p_data_as_of    TIMESTAMPTZ,
  p_coverage_from DATE,
  p_coverage_to   DATE,
  p_property_ids  UUID[],
  p_events        JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_run UUID;
BEGIN
  -- Una sola sincronización a la vez: la segunda espera a que termine la primera.
  PERFORM pg_advisory_xact_lock(hashtext('record_calendar_sync'));

  IF p_source IS NULL OR p_source = '' THEN RAISE EXCEPTION 'fuente vacía'; END IF;
  IF p_data_as_of IS NULL OR p_data_as_of > now() + interval '60 seconds' THEN RAISE EXCEPTION 'data_as_of inválido'; END IF;
  IF p_coverage_from IS NULL OR p_coverage_to IS NULL OR p_coverage_to < p_coverage_from THEN
    RAISE EXCEPTION 'cobertura inválida';
  END IF;
  IF coalesce(array_length(p_property_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'sin apartamentos'; END IF;
  IF jsonb_typeof(p_events) <> 'array' THEN RAISE EXCEPTION 'eventos inválidos'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) e
    WHERE e->>'property_id' IS NULL OR NOT ((e->>'property_id')::uuid = ANY (p_property_ids))
  ) THEN
    RAISE EXCEPTION 'evento de un apartamento que no está en la corrida';
  END IF;

  INSERT INTO public.calendar_sync_runs
    (source, started_at, completed_at, data_as_of, status, verified, coverage_from, coverage_to, property_ids)
  VALUES
    (p_source, p_started_at, now(), p_data_as_of, 'complete', true, p_coverage_from, p_coverage_to, p_property_ids)
  RETURNING id INTO v_run;

  DELETE FROM public.calendar_events WHERE source = p_source AND property_id = ANY (p_property_ids);

  INSERT INTO public.calendar_events (property_id, source, uid, start_date, end_date, kind, run_id)
  SELECT (e->>'property_id')::uuid, p_source, e->>'uid', (e->>'start')::date, (e->>'end')::date, e->>'kind', v_run
  FROM jsonb_array_elements(p_events) e;

  RETURN v_run;
END;
$$;

-- Solo el servidor (clave de servicio) puede registrar sincronizaciones.
REVOKE ALL ON FUNCTION public.record_calendar_sync(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, DATE, DATE, UUID[], JSONB) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.record_calendar_sync(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, DATE, DATE, UUID[], JSONB) FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.record_calendar_sync(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, DATE, DATE, UUID[], JSONB) TO service_role;
  END IF;
END $$;


-- Additive correction for 005/006. No changes to reservations or apartment rules.
-- Proposed for review: do not apply to production automatically.
-- Monotonic calendar replacement plus one consistent, read-only availability snapshot.

CREATE OR REPLACE FUNCTION public.record_calendar_sync(
  p_source        TEXT,
  p_started_at    TIMESTAMPTZ,
  p_data_as_of    TIMESTAMPTZ,
  p_coverage_from DATE,
  p_coverage_to   DATE,
  p_property_ids  UUID[],
  p_events        JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_run UUID;
BEGIN
  -- Una sola sincronización a la vez: la segunda espera a que termine la primera.
  PERFORM pg_advisory_xact_lock(hashtext('record_calendar_sync'));

  IF p_source IS NULL OR p_source = '' THEN RAISE EXCEPTION 'fuente vacía'; END IF;
  IF p_data_as_of IS NULL OR p_data_as_of > now() + interval '60 seconds' THEN RAISE EXCEPTION 'data_as_of inválido'; END IF;
  IF p_coverage_from IS NULL OR p_coverage_to IS NULL OR p_coverage_to < p_coverage_from THEN
    RAISE EXCEPTION 'cobertura inválida';
  END IF;
  IF coalesce(array_length(p_property_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'sin apartamentos'; END IF;
  IF jsonb_typeof(p_events) <> 'array' THEN RAISE EXCEPTION 'eventos inválidos'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_events) e
    WHERE e->>'property_id' IS NULL OR NOT ((e->>'property_id')::uuid = ANY (p_property_ids))
  ) THEN
    RAISE EXCEPTION 'evento de un apartamento que no está en la corrida';
  END IF;

  -- Downloads happen before the lock: an older fetch must never replace a newer commit.
  IF EXISTS (
    SELECT 1 FROM public.calendar_sync_runs
    WHERE source = p_source AND status = 'complete' AND verified
      AND property_ids && p_property_ids AND data_as_of >= p_data_as_of
  ) THEN
    RAISE EXCEPTION 'sincronizacion superada por una corrida mas reciente';
  END IF;

  INSERT INTO public.calendar_sync_runs
    (source, started_at, completed_at, data_as_of, status, verified, coverage_from, coverage_to, property_ids)
  VALUES
    (p_source, p_started_at, now(), p_data_as_of, 'complete', true, p_coverage_from, p_coverage_to, p_property_ids)
  RETURNING id INTO v_run;

  DELETE FROM public.calendar_events WHERE source = p_source AND property_id = ANY (p_property_ids);

  INSERT INTO public.calendar_events (property_id, source, uid, start_date, end_date, kind, run_id)
  SELECT (e->>'property_id')::uuid, p_source, e->>'uid', (e->>'start')::date, (e->>'end')::date, e->>'kind', v_run
  FROM jsonb_array_elements(p_events) e;

  RETURN v_run;
END;
$$;

-- All subqueries run inside ONE SQL statement and share its MVCC snapshot.
-- Fixed property IDs: anonymous callers can never choose a tenant or expand the catalog.
CREATE OR REPLACE FUNCTION public.read_casa_blue_availability(p_arrival DATE, p_departure DATE)
RETURNS JSONB
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH ids(id) AS (VALUES
  ('0b6170ff-6049-4e21-b6bc-c4237cc2c0f6'::uuid),
  ('4b10f347-cf1b-4b89-81b6-b73c41d697a3'::uuid),
  ('2be6deec-8061-453e-b1ae-ce0bd177fadd'::uuid),
  ('b73c70dd-204b-42f1-a1e1-674de53eca84'::uuid),
  ('823591d2-e4a9-4893-bd01-f1394a38545d'::uuid),
  ('097d3266-e9d6-4ed0-a403-6dd051c5d042'::uuid),
  ('66a7c1ee-2117-4178-890e-181cd904778c'::uuid),
  ('6a878ed2-148b-4078-9f66-90aab3e76b19'::uuid)
), run AS MATERIALIZED (
  SELECT id, data_as_of, coverage_from, coverage_to, property_ids
  FROM public.calendar_sync_runs
  WHERE source = 'airbnb-ical' AND status = 'complete' AND verified AND data_as_of IS NOT NULL
  ORDER BY data_as_of DESC, completed_at DESC, id DESC LIMIT 1
)
SELECT jsonb_build_object(
  'run', (SELECT to_jsonb(r) FROM run r),
  'consistent', NOT EXISTS (
    SELECT 1 FROM public.calendar_events e JOIN ids i ON i.id = e.property_id
    WHERE e.source = 'airbnb-ical' AND e.run_id IS DISTINCT FROM (SELECT id FROM run)
  ),
  'properties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'capacity', p.capacity, 'active', p.active
  )) FROM public.properties p JOIN ids i ON i.id = p.id), '[]'::jsonb),
  'rules', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'property_id', r.property_id, 'min_nights', r.min_nights, 'max_nights', r.max_nights,
    'date_overrides', r.date_overrides, 'advance_notice_hours', r.advance_notice_hours,
    'booking_window_days', r.booking_window_days, 'preparation_nights', r.preparation_nights,
    'same_day_turnover', r.same_day_turnover, 'turnover_hours', r.turnover_hours,
    'check_in_days', r.check_in_days, 'check_out_days', r.check_out_days,
    'check_in_time', r.check_in_time, 'check_out_time', r.check_out_time
  )) FROM public.availability_rules r JOIN ids i ON i.id = r.property_id
    WHERE r.verified_at IS NOT NULL), '[]'::jsonb),
  'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'property_id', e.property_id, 'start_date', e.start_date, 'end_date', e.end_date
  )) FROM public.calendar_events e JOIN ids i ON i.id = e.property_id JOIN run r ON r.id = e.run_id
    WHERE e.source = 'airbnb-ical' AND e.start_date <= p_departure + 8 AND e.end_date >= p_arrival - 8), '[]'::jsonb),
  'manual', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', r.id, 'property_id', r.property_id, 'check_in', r.check_in, 'check_out', r.check_out,
    'notes', r.notes, 'pending_change', r.pending_change
  )) FROM public.reservations r JOIN ids i ON i.id = r.property_id
    WHERE r.status IN ('confirmed', 'blocked') AND (r.source = 'direct' OR r.status = 'blocked')
      AND ((r.check_in <= p_departure + 8 AND r.check_out >= p_arrival - 8)
        OR r.pending_change IS NOT NULL OR r.notes LIKE '%⚠️%')), '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION public.read_casa_blue_availability(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_casa_blue_availability(DATE, DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_casa_blue_availability(DATE, DATE) TO service_role;


-- Compatibility with the currently deployed PR #12 reader; no verified rule rows are inserted.
ALTER TABLE public.availability_rules
  ADD COLUMN IF NOT EXISTS min_nights_overrides JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(min_nights_overrides) = 'array');

-- Explicit privileges for the new objects only. Never expose calendar data to anon.
REVOKE ALL ON public.calendar_sync_runs, public.calendar_events, public.availability_rules FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.calendar_sync_runs TO service_role;
GRANT SELECT, INSERT, DELETE ON public.calendar_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.availability_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_sync_runs, public.availability_rules TO authenticated;
GRANT SELECT ON public.calendar_events TO authenticated;
NOTIFY pgrst, 'reload schema';
