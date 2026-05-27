-- Migration 002: Gmail sync support
-- Adds airbnb_code for deduplication + app_settings for OAuth tokens

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Add airbnb_code column to reservations (nullable, unique)
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS airbnb_code TEXT;

ALTER TABLE public.reservations
  ADD CONSTRAINT IF NOT EXISTS reservations_airbnb_code_key UNIQUE (airbnb_code);

-- Backfill existing reservations: extract code from notes field
-- Notes format: "... | Código: HMXXXXXX | ..."
UPDATE public.reservations
SET airbnb_code = (regexp_match(notes, 'Código: ([A-Z0-9]+)'))[1]
WHERE airbnb_code IS NULL AND notes LIKE '%Código:%';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. App settings table (key-value for OAuth tokens and config)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- FOR ALL needs both USING (for SELECT/UPDATE/DELETE) and WITH CHECK (for INSERT)
CREATE POLICY "admin can manage settings"
  ON public.app_settings FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Sync log table
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gmail_sync_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by TEXT NOT NULL DEFAULT 'cron',
  new_count    INT  NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gmail_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read sync log"
  ON public.gmail_sync_log FOR SELECT TO authenticated
  USING (true);

-- INSERT policy must use WITH CHECK (not USING)
CREATE POLICY "authenticated can insert sync log"
  ON public.gmail_sync_log FOR INSERT TO authenticated
  WITH CHECK (true);
