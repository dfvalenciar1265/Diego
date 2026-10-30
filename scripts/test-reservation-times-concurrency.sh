#!/usr/bin/env bash
# Invocado solo por test-migrations.sh sobre su base local temporal, con datos sintéticos.
set -euo pipefail
DB="$1"
[[ "$DB" =~ ^airadmin_migrations_test_[a-zA-Z0-9_]+$ ]] || exit 1
LOGDIR=$(mktemp -d)
trap 'rm -rf "$LOGDIR"' EXIT
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
"${PSQL[@]}" -c "INSERT INTO public.reservations (id,property_id,source,guest_name,check_in,check_out,status)
VALUES ('00000000-0000-0000-0000-000000007003','00000000-0000-0000-0000-0000000013a3','direct','Concurrente Sintético','2027-03-01','2027-03-03','confirmed');
INSERT INTO public.tasks (property_id,reservation_id,type,scheduled_for,notes) VALUES
('00000000-0000-0000-0000-0000000013a3','00000000-0000-0000-0000-000000007003','cleaning','2027-03-03','Limpieza sintética');"
# Dos conexiones parten de la misma versión. Solo una puede confirmar el cambio.
for writer in 1 2; do
  (
    "${PSQL[@]}" >"$LOGDIR/$writer.log" 2>&1 <<SQL
\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.record_reservation_time('00000000-0000-0000-0000-000000007003','checkout','authorization','12:0$writer',0,'concurrent-$writer','mcp','00000000-0000-0000-0000-0000000000d1',NULL,'2027-03-01','2027-03-03');
SELECT pg_sleep(0.3);
COMMIT;
SQL
  ) &
  if [[ "$writer" == 1 ]]; then first=$!; else second=$!; fi
done
first_status=0; second_status=0
wait "$first" || first_status=$?
wait "$second" || second_status=$?
if [[ ( "$first_status" == 0 && "$second_status" == 0 ) || ( "$first_status" != 0 && "$second_status" != 0 ) ]]; then
  cat "$LOGDIR/1.log" "$LOGDIR/2.log"; exit 1
fi
rg -q '40001' "$LOGDIR" || { cat "$LOGDIR/1.log" "$LOGDIR/2.log"; exit 1; }
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.reservation_time_events WHERE reservation_id='00000000-0000-0000-0000-000000007003') <> 1 THEN RAISE EXCEPTION 'FALLA: concurrencia real duplicó/sobrescribió'; END IF;
 RAISE NOTICE 'OK: dos conexiones concurrentes, un ganador y un conflicto 40001';
END $$;
SQL
