#!/usr/bin/env bash
# Prueba las migraciones 001–004 + 20261018130754 (base de calendarios aplicada) + 20261019130000 (cobros y solicitudes) en una base Postgres LOCAL y temporal (nunca en Supabase).
# Requiere psql/createdb (p. ej. Postgres.app). Uso: bash scripts/test-migrations.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Refuse network/service selectors: this test must never create a DB on Supabase.
if [[ -n "${PGHOSTADDR:-}" || -n "${PGSERVICE:-}" || ( -n "${PGHOST:-}" && "${PGHOST}" != /* ) ]]; then
  echo 'La prueba solo admite un socket Unix local; no admite PGHOST remoto, PGHOSTADDR ni PGSERVICE.' >&2
  exit 1
fi
DB="${CASA_BLUE_LOCAL_TEST_DB:-airadmin_migrations_test_$$}"
[[ "$DB" =~ ^airadmin_migrations_test_[a-zA-Z0-9_]+$ ]] || { echo 'Solo se admiten nombres de base local de prueba.' >&2; exit 1; }
createdb "$DB"
if [[ "${CASA_BLUE_KEEP_LOCAL_TEST_DB:-0}" != 1 ]]; then
  trap 'dropdb --if-exists "$DB" >/dev/null 2>&1 || true' EXIT
fi
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

# Lo que Supabase trae de fábrica y las columnas que se agregaron fuera de las migraciones.
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
SQL

for f in supabase/migrations/00{1,2}_*.sql; do "${PSQL[@]}" -f "$f"; done
# Existing app columns added outside the checked-in baseline migrations.
"${PSQL[@]}" -c "ALTER TABLE public.properties ADD COLUMN active boolean NOT NULL DEFAULT true;
  ALTER TABLE public.reservations ADD COLUMN pending_change jsonb;"
"${PSQL[@]}" -c "CREATE TABLE public.expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid, date date);"
for f in supabase/migrations/00{3,4}_*.sql; do "${PSQL[@]}" -f "$f"; done
# La base de calendarios tal como se aplicó en Supabase el 18-oct-2026 (incluye las antiguas 005–007).
"${PSQL[@]}" -f supabase/migrations/20261018130754_casa_blue_calendar_foundation.sql
# Como en Supabase: los roles de la API tienen permisos de tabla y RLS decide qué filas ven.
"${PSQL[@]}" -c "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;"

"${PSQL[@]}" <<'SQL'
\set ON_ERROR_STOP 1
INSERT INTO public.properties (id, name, capacity) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'Sintético A', 4),
  ('00000000-0000-0000-0000-00000000000b', 'Sintético B', 6);
-- Una reserva de correo y una directa: el sincronizador no debe tocarlas.
INSERT INTO public.reservations (property_id, source, guest_name, check_in, check_out, notes, status, airbnb_code) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'airbnb', 'Huésped Sintético', '2026-11-10', '2026-11-13', 'nota', 'confirmed', 'HMTEST01'),
  ('00000000-0000-0000-0000-00000000000b', 'direct', 'Directo Sintético', '2026-11-20', '2026-11-22', '', 'blocked', NULL);
CREATE TEMP TABLE before_res AS SELECT md5(string_agg(r::text, ',' ORDER BY id)) AS h FROM public.reservations r;

CREATE TEMP TABLE payload AS SELECT '[
  {"property_id":"00000000-0000-0000-0000-00000000000a","uid":"u1@airbnb.com","start":"2026-11-10","end":"2026-11-13","kind":"reserved"},
  {"property_id":"00000000-0000-0000-0000-00000000000b","uid":"u2@airbnb.com","start":"2026-11-20","end":"2026-11-22","kind":"blocked"}
]'::jsonb AS events;
GRANT SELECT ON payload TO service_role;

SET ROLE service_role;
SELECT public.record_calendar_sync('airbnb-ical', now(), now(), '2026-10-18', '2027-10-18',
  ARRAY['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b']::uuid[], (SELECT events FROM payload));
-- Idempotencia: la misma descarga otra vez deja exactamente los mismos eventos.
SELECT public.record_calendar_sync('airbnb-ical', now(), now(), '2026-10-18', '2027-10-18',
  ARRAY['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b']::uuid[], (SELECT events FROM payload));
RESET ROLE;

DO $$ BEGIN
  IF (SELECT count(*) FROM public.calendar_events) <> 2 THEN RAISE EXCEPTION 'FALLA: idempotencia (eventos %)', (SELECT count(*) FROM public.calendar_events); END IF;
  IF (SELECT count(*) FROM public.calendar_sync_runs WHERE status = 'complete' AND verified) <> 2 THEN RAISE EXCEPTION 'FALLA: corridas verificadas'; END IF;
  IF (SELECT count(DISTINCT run_id) FROM public.calendar_events) <> 1 THEN RAISE EXCEPTION 'FALLA: eventos de corridas mezcladas'; END IF;
  IF (SELECT h FROM before_res) <> (SELECT md5(string_agg(r::text, ',' ORDER BY id)) FROM public.reservations r) THEN RAISE EXCEPTION 'FALLA: el sincronizador alteró reservations'; END IF;
  RAISE NOTICE 'OK: corrida atómica, idempotente y sin tocar reservations';
END $$;

-- Atomicidad: un evento de un apartamento fuera de la corrida aborta TODO (ni corrida ni borrado).
DO $$ BEGIN
  BEGIN
    PERFORM public.record_calendar_sync('airbnb-ical', now(), now(), '2026-10-18', '2027-10-18',
      ARRAY['00000000-0000-0000-0000-00000000000a']::uuid[],
      '[{"property_id":"00000000-0000-0000-0000-00000000000b","uid":"x","start":"2026-12-01","end":"2026-12-03","kind":"reserved"}]'::jsonb);
    RAISE EXCEPTION 'FALLA: aceptó un evento ajeno';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF;
  END;
  -- Fechas al revés: el CHECK de la tabla aborta la transacción después de haber borrado.
  BEGIN
    PERFORM public.record_calendar_sync('airbnb-ical', now(), now(), '2026-10-18', '2027-10-18',
      ARRAY['00000000-0000-0000-0000-00000000000a']::uuid[],
      '[{"property_id":"00000000-0000-0000-0000-00000000000a","uid":"y","start":"2026-12-05","end":"2026-12-01","kind":"reserved"}]'::jsonb);
    RAISE EXCEPTION 'FALLA: aceptó fechas al revés';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_calendar_sync('airbnb-ical', now(), now() + interval '1 hour', '2026-10-18', '2027-10-18',
      ARRAY['00000000-0000-0000-0000-00000000000a']::uuid[], '[]'::jsonb);
    RAISE EXCEPTION 'FALLA: aceptó data_as_of en el futuro';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALLA%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.calendar_events) <> 2 THEN RAISE EXCEPTION 'FALLA: una corrida rechazada borró eventos'; END IF;
  IF (SELECT count(*) FROM public.calendar_sync_runs) <> 2 THEN RAISE EXCEPTION 'FALLA: una corrida rechazada quedó registrada'; END IF;
  RAISE NOTICE 'OK: corridas inválidas no certifican ni borran nada';
END $$;

-- Una corrida "complete" sin cobertura ni data_as_of no se puede guardar.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.calendar_sync_runs (source, started_at, completed_at, status, verified) VALUES ('airbnb-ical', now(), now(), 'complete', true);
    RAISE EXCEPTION 'FALLA: corrida completa sin cobertura';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.availability_rules (property_id, min_nights, advance_notice_hours, preparation_nights, same_day_turnover)
      VALUES ('00000000-0000-0000-0000-00000000000a', 0, 0, 0, true);
    RAISE EXCEPTION 'FALLA: aceptó min_nights 0';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.availability_rules (property_id, min_nights, advance_notice_hours, preparation_nights, same_day_turnover, date_overrides)
      VALUES ('00000000-0000-0000-0000-00000000000a', 2, 0, 0, true, '{}'::jsonb);
    RAISE EXCEPTION 'FALLA: aceptó date_overrides que no es lista';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK: restricciones de corridas y reglas';
END $$;

-- RLS: anónimo no ve nada ni puede registrar corridas.
SET ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.calendar_events) <> 0 OR (SELECT count(*) FROM public.calendar_sync_runs) <> 0
     OR (SELECT count(*) FROM public.availability_rules) <> 0 OR (SELECT count(*) FROM public.reservations) <> 0 THEN
    RAISE EXCEPTION 'FALLA: anon ve filas';
  END IF;
  BEGIN
    PERFORM public.record_calendar_sync('airbnb-ical', now(), now(), '2026-10-18', '2027-10-18',
      ARRAY['00000000-0000-0000-0000-00000000000a']::uuid[], '[]'::jsonb);
    RAISE EXCEPTION 'FALLA: anon pudo registrar una corrida';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.calendar_sync_runs (source, started_at, status) VALUES ('x', now(), 'failed');
    RAISE EXCEPTION 'FALLA: anon pudo insertar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK: RLS cierra todo a anon';
END $$;
RESET ROLE;
SQL
"${PSQL[@]}" -f scripts/test-availability-snapshot.sql
# Cobros adicionales y solicitudes especiales (base ya aplicada en Supabase).
"${PSQL[@]}" -f supabase/migrations/20261019130000_reservation_followups.sql
"${PSQL[@]}" -f scripts/test-followups.sql
"${PSQL[@]}" -f scripts/test-reservation-times-before.sql
"${PSQL[@]}" -f supabase/migrations/20261030131630_reservation_times.sql
"${PSQL[@]}" -f scripts/test-reservation-times.sql
bash scripts/test-reservation-times-concurrency.sh "$DB"
echo "Migraciones 001–004 + 20261018130754 + 20261019130000 + horarios: todas las comprobaciones pasaron."
