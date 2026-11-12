#!/usr/bin/env bash
# SOLO stack Supabase LOCAL nuevo. No crea/reemplaza auth/storage y no resetea bases.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${AIRADMIN_LOCAL_DB_URL:?URL PostgreSQL del stack LOCAL aislado requerida}"
node --input-type=module <<'JS'
const u=new URL(process.env.AIRADMIN_LOCAL_DB_URL);
if(!['postgres:','postgresql:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.port!=='54322'||u.pathname!=='/postgres')throw Error('Solo PostgreSQL local 54322/postgres');
JS
unset PGDATABASE
unset PGHOSTADDR PGSERVICE PGSERVICEFILE
if ! command -v psql >/dev/null && [[ -x /opt/homebrew/opt/postgresql@17/bin/psql ]]; then export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"; fi
command -v psql >/dev/null || { echo 'Falta psql local; configura PATH al cliente PostgreSQL instalado.' >&2; exit 1; }
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$AIRADMIN_LOCAL_DB_URL")
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF to_regclass('public.team_members') IS NOT NULL THEN RAISE EXCEPTION 'La base ya tiene AirAdmin. No se sobrescribe. Usa un stack local nuevo.'; END IF;
 IF to_regclass('auth.users') IS NULL OR to_regclass('storage.objects') IS NULL THEN RAISE EXCEPTION 'Faltan Auth/Storage reales de Supabase.'; END IF;
END $$;
SQL
for f in supabase/migrations/00{1,2}_*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" <<'SQL'
-- Compatibilidad del baseline, solo local. No representa esquema completo de gastos.
ALTER TABLE public.properties ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE public.reservations ADD COLUMN pending_change jsonb;
ALTER TABLE public.reservations ADD COLUMN guests smallint;
ALTER TABLE public.tasks ADD COLUMN building_notified_at timestamptz;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS next_due date;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS last_done date;
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS interval_months int;
CREATE TABLE public.expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),property_id uuid,date date);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
SQL
for f in supabase/migrations/00{3,4}_*.sql; do "${PSQL[@]}" -f "$f"; done
for f in supabase/migrations/20*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -c "NOTIFY pgrst, 'reload schema';"
echo 'Migraciones locales aplicadas; no se importaron datos reales.'
