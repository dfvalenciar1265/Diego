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
