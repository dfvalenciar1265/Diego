#!/usr/bin/env bash
# Solo contra la base LOCAL temporal del ejecutor; nunca Supabase.
set -euo pipefail
DB="$1"
[[ "$DB" =~ ^airadmin_migrations_test_[a-zA-Z0-9_]+$ ]] || exit 1
if [[ -n "${PGHOSTADDR:-}" || -n "${PGSERVICE:-}" || ( -n "${PGHOST:-}" && "$PGHOST" != /* ) ]]; then exit 1; fi
LOGDIR=$(mktemp -d)
trap 'rm -rf "$LOGDIR"' EXIT
PSQL=(psql -X -qAt -v ON_ERROR_STOP=1 -d "$DB")
"${PSQL[@]}" <<'SQL'
INSERT INTO public.properties(id,name,capacity) VALUES
 ('00000000-0000-0000-0000-00000000b701','Concurrente Sintético A',4),('00000000-0000-0000-0000-00000000b702','Concurrente Sintético B',4),
 ('00000000-0000-0000-0000-00000000b703','Concurrente Sintético C',4),('00000000-0000-0000-0000-00000000b704','Concurrente Sintético D',4);
INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out)
 SELECT r.id::uuid,r.property::uuid,'direct','Concurrente Sintético',(now() AT TIME ZONE 'America/Bogota')::date,(now() AT TIME ZONE 'America/Bogota')::date+2 FROM (VALUES
 ('00000000-0000-0000-0000-00000000b601','00000000-0000-0000-0000-00000000b701'),('00000000-0000-0000-0000-00000000b602','00000000-0000-0000-0000-00000000b702'),
 ('00000000-0000-0000-0000-00000000b603','00000000-0000-0000-0000-00000000b703'),('00000000-0000-0000-0000-00000000b604','00000000-0000-0000-0000-00000000b704')) r(id,property);
SQL
pair() {
 local rid="$1" mode="$2" key
 for writer in 1 2; do
  key="pair-$mode-$writer"; [[ "$mode" == retry ]] && key='same-request'
  "${PSQL[@]}" -v rid="$rid" -v key="$key" >"$LOGDIR/$mode-$writer" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d1';
SELECT public.record_arrival_preparation(:'rid','cleaning',true,0,:'key',r.check_in,r.check_out) FROM public.reservations r WHERE id=:'rid';
SELECT pg_sleep(0.15);
COMMIT;
SQL
  if [[ "$writer" == 1 ]]; then first=$!; else second=$!; fi
 done
 wait "$first"; wait "$second"
}
pair '00000000-0000-0000-0000-00000000b601' conflict
[[ $(rg -l '"conflict": true' "$LOGDIR/conflict-"* | wc -l | tr -d ' ') == 1 ]] || { cat "$LOGDIR/conflict-"*; exit 1; }
pair '00000000-0000-0000-0000-00000000b602' retry
[[ $(rg -l '"replayed": true' "$LOGDIR/retry-"* | wc -l | tr -d ' ') == 1 ]] || { cat "$LOGDIR/retry-"*; exit 1; }
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.arrival_preparations WHERE reservation_id IN ('00000000-0000-0000-0000-00000000b601','00000000-0000-0000-0000-00000000b602') AND version=1)<>2
  OR (SELECT count(*) FROM public.arrival_preparation_history WHERE reservation_id IN ('00000000-0000-0000-0000-00000000b601','00000000-0000-0000-0000-00000000b602'))<>2 THEN RAISE EXCEPTION 'FALLA: concurrencia duplicó confirmaciones'; END IF;
END $$;
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d1';
SELECT public.record_arrival_preparation(r.id,'cleaning',true,0,'race-clean',r.check_in,r.check_out) FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000b603';
SELECT public.record_arrival_preparation(r.id,'functioning',true,1,'race-check',r.check_in,r.check_out) FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000b603';
SQL
# Una urgencia que llega mientras se confirma listo debe retirar también la revisión anterior.
"${PSQL[@]}" >"$LOGDIR/ready-race" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d1';
SELECT public.record_arrival_preparation(r.id,'ready',true,2,'race-ready',r.check_in,r.check_out) FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000b603';
\echo LOCKED
SELECT pg_sleep(0.7);
COMMIT;
SQL
first=$!
for _ in {1..80}; do rg -q LOCKED "$LOGDIR/ready-race" && break; sleep 0.03; done
rg -q LOCKED "$LOGDIR/ready-race" || { cat "$LOGDIR/ready-race"; exit 1; }
"${PSQL[@]}" <<'SQL'
INSERT INTO public.maintenance(property_id,title,priority,reported_by)
 VALUES('00000000-0000-0000-0000-00000000b703','Urgencia concurrente Sintética','urgent','00000000-0000-0000-0000-0000000000d1');
SQL
wait "$first"
# Un cambio de fechas que espera una confirmación concurrente debe invalidarla al terminar.
"${PSQL[@]}" >"$LOGDIR/date-race" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d1';
SELECT public.record_arrival_preparation(r.id,'cleaning',true,0,'race-date',r.check_in,r.check_out) FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000b604';
\echo LOCKED
SELECT pg_sleep(0.7);
COMMIT;
SQL
first=$!
for _ in {1..80}; do rg -q LOCKED "$LOGDIR/date-race" && break; sleep 0.03; done
rg -q LOCKED "$LOGDIR/date-race" || { cat "$LOGDIR/date-race"; exit 1; }
"${PSQL[@]}" -c "UPDATE public.reservations SET check_in=check_in+1,check_out=check_out+1 WHERE id='00000000-0000-0000-0000-00000000b604'"
wait "$first"

# También cubre una estancia nueva mientras se confirma limpieza para la llegada siguiente.
"${PSQL[@]}" <<'SQL'
INSERT INTO public.properties(id,name,capacity) VALUES('00000000-0000-0000-0000-00000000b705','Intermedia Sintética',4);
INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out) VALUES
 ('00000000-0000-0000-0000-00000000b605','00000000-0000-0000-0000-00000000b705','direct','Llegada siguiente Sintética',(now() AT TIME ZONE 'America/Bogota')::date+1,(now() AT TIME ZONE 'America/Bogota')::date+3);
SQL
"${PSQL[@]}" >"$LOGDIR/stay-race" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d1';
SELECT public.record_arrival_preparation(r.id,'cleaning',true,0,'race-stay',r.check_in,r.check_out) FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000b605';
\echo LOCKED
SELECT pg_sleep(0.7);
COMMIT;
SQL
first=$!
for _ in {1..80}; do rg -q LOCKED "$LOGDIR/stay-race" && break; sleep 0.03; done
rg -q LOCKED "$LOGDIR/stay-race" || { cat "$LOGDIR/stay-race"; exit 1; }
"${PSQL[@]}" <<'SQL'
INSERT INTO public.reservations(property_id,source,guest_name,check_in,check_out) VALUES
 ('00000000-0000-0000-0000-00000000b705','direct','Estancia intermedia Sintética',(now() AT TIME ZONE 'America/Bogota')::date,(now() AT TIME ZONE 'America/Bogota')::date+1);
SQL
wait "$first"
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000b605' AND version=2 AND cleaned_at IS NULL AND review_reason IS NOT NULL) THEN RAISE EXCEPTION 'FALLA: otra estancia concurrente reutilizó limpieza'; END IF;
END $$;
SQL
# Un snapshot fijo no puede ignorar una confirmación creada después de comenzar la transacción.
if "${PSQL[@]}" >"$LOGDIR/isolation" 2>&1 <<'SQL'
\set VERBOSITY verbose
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d1';
SELECT public.record_arrival_preparation(r.id,'cleaning',false,1,'isolation',r.check_in,r.check_out,'Revisión Sintética') FROM public.reservations r WHERE id='00000000-0000-0000-0000-00000000b601';
COMMIT;
SQL
then echo 'FALLA: aceptó snapshot fijo'; exit 1; fi
rg -q '40001' "$LOGDIR/isolation" || { cat "$LOGDIR/isolation"; exit 1; }

"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000b603' AND version=4 AND ready_at IS NULL AND checked_at IS NULL AND cleaned_at IS NOT NULL) THEN RAISE EXCEPTION 'FALLA: urgencia concurrente dejó listo'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.arrival_preparations WHERE reservation_id='00000000-0000-0000-0000-00000000b604' AND version=2 AND ready_at IS NULL AND cleaned_at IS NULL AND review_reason IS NOT NULL) THEN RAISE EXCEPTION 'FALLA: cambio concurrente reutilizó limpieza'; END IF;
 RAISE NOTICE 'OK: concurrencia real, conflicto, reintento idempotente, urgencia y cambio de fechas';
END $$;
SQL
