-- Migration 002: Gmail sync support
-- Adds airbnb_code for deduplication + app_settings for OAuth tokens

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Add airbnb_code column to reservations (nullable, unique)
--    Allows idempotent imports: re-syncing skips already-imported reservations
-- ──────────────────────────────────────────────────────────────────────────────
alter table public.reservations
  add column if not exists airbnb_code text unique;

-- Backfill existing reservations: extract code from notes field
-- Notes format: "... | Código: HMXXXXXX | ..."
update public.reservations
set airbnb_code = (
  regexp_match(notes, 'Código: ([A-Z0-9]+)')
)[1]
where airbnb_code is null
  and notes like '%Código:%';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. App settings table (key-value store for OAuth tokens and config)
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key   text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Only admins can read/write settings
alter table public.app_settings enable row level security;

create policy "admin can manage settings"
  on public.app_settings for all to authenticated
  using (
    exists (
      select 1 from public.team_members
      where id = auth.uid() and role = 'admin'
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Sync log table — tracks every sync run for the dashboard
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.gmail_sync_log (
  id           uuid primary key default gen_random_uuid(),
  triggered_by text not null default 'cron', -- 'cron' | 'manual'
  new_count    int  not null default 0,
  error        text,
  created_at   timestamptz not null default now()
);

alter table public.gmail_sync_log enable row level security;

create policy "authenticated can read sync log"
  on public.gmail_sync_log for select to authenticated using (true);

-- Service role can insert (used by the API route with service key)
create policy "service role can insert sync log"
  on public.gmail_sync_log for insert to authenticated using (true);
