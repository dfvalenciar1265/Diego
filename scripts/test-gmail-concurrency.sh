#!/usr/bin/env bash
# Dos conexiones reales a la base local temporal; nunca se conecta a Supabase.
set -euo pipefail
DB="$1"
[[ "$DB" =~ ^airadmin_migrations_test_[a-zA-Z0-9_]+$ ]] || exit 1
LOGDIR=$(mktemp -d)
trap 'rm -rf "$LOGDIR"' EXIT
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
for writer in 1 2; do
  (
    "${PSQL[@]}" >"$LOGDIR/$writer.log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.gmail_sync_begin('00000000-0000-0000-0000-00000000b10$writer','cron')->>'busy';
SELECT pg_sleep(0.2);
COMMIT;
SQL
  ) &
  if [[ "$writer" == 1 ]]; then first=$!; else second=$!; fi
done
wait "$first"; wait "$second"
[[ $(rg -l '^ false' "$LOGDIR" | wc -l | tr -d ' ') == 1 && $(rg -l '^ true' "$LOGDIR" | wc -l | tr -d ' ') == 1 ]] || { cat "$LOGDIR/1.log" "$LOGDIR/2.log"; exit 1; }
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.gmail_sync_runs WHERE status='running')<>1 THEN RAISE EXCEPTION 'FALLA: trabajadores simultáneos'; END IF;
 RAISE NOTICE 'OK: dos conexiones Gmail concurrentes, una admitida y otra ocupada';
END $$;
SQL
