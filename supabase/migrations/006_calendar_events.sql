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
