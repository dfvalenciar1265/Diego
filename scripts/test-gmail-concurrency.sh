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
# Dos escritores de tareas (app/MCP) que no pasan por Gmail también quedan serializados.
"${PSQL[@]}" -c "INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out,status) VALUES
 ('00000000-0000-0000-0000-00000000a203','00000000-0000-0000-0000-0000000013b3','direct','Carrera Tareas Sintético','2032-07-20','2032-07-23','confirmed');"
for writer in 1 2; do
  (
    "${PSQL[@]}" >"$LOGDIR/tasks-$writer.log" 2>&1 <<SQL
\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE service_role;
INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,notes) VALUES
 ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a203','cleaning','2032-07-23','Escritor sintético $writer');
SELECT pg_sleep(0.2);
COMMIT;
SQL
  ) &
  if [[ "$writer" == 1 ]]; then first=$!; else second=$!; fi
done
first_status=0;second_status=0
wait "$first" || first_status=$?
wait "$second" || second_status=$?
if [[ ( "$first_status" == 0 && "$second_status" == 0 ) || ( "$first_status" != 0 && "$second_status" != 0 ) ]]; then
 cat "$LOGDIR/tasks-1.log" "$LOGDIR/tasks-2.log";exit 1
fi
rg -q '23505' "$LOGDIR/tasks-"* || { cat "$LOGDIR/tasks-1.log" "$LOGDIR/tasks-2.log";exit 1; }
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.tasks WHERE reservation_id='00000000-0000-0000-0000-00000000a203' AND type='cleaning')<>1 THEN RAISE EXCEPTION 'FALLA: tareas concurrentes duplicadas'; END IF;
 RAISE NOTICE 'OK: dos escritores de tareas, un ganador y un rechazo 23505';
END $$;
SQL
# Un snapshot fijo no sirve para esta comprobación por fila: exigir reintento con el aislamiento de la app.
"${PSQL[@]}" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,notes) VALUES
   ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a203','preparation','2032-07-19','Aislamiento sintético');
  RAISE EXCEPTION 'FALLA: guardia con snapshot fijo';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 RAISE NOTICE 'OK: snapshot fijo solicita reintento y no crea tareas';
END $$;
ROLLBACK;
SQL
