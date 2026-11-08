#!/usr/bin/env bash
# Solo contra la base LOCAL temporal de test-migrations.sh. Datos sintéticos.
set -euo pipefail
DB="$1"
[[ "$DB" =~ ^airadmin_migrations_test_[a-zA-Z0-9_]+$ ]] || exit 1
if [[ -n "${PGHOSTADDR:-}" || -n "${PGSERVICE:-}" || ( -n "${PGHOST:-}" && "$PGHOST" != /* ) ]]; then exit 1; fi
LOGDIR=$(mktemp -d)
trap 'rm -rf "$LOGDIR"' EXIT
PSQL=(psql -X -qAt -v ON_ERROR_STOP=1 -d "$DB")
"${PSQL[@]}" <<'SQL'
INSERT INTO auth.users(id) VALUES('00000000-0000-0000-0000-00000000f001');
INSERT INTO public.team_members(id,name,email,role,active) VALUES
 ('00000000-0000-0000-0000-00000000f001','Admin Concurrencia Avisos Sintético','concurrent-notice@example.test','admin',true);
INSERT INTO public.properties(id,name,capacity) VALUES('00000000-0000-0000-0000-00000000f101','Avisos Concurrentes Sintético',4);
INSERT INTO public.reservations(id,property_id,source,guest_name,guests,check_in,check_out)
 SELECT ('00000000-0000-0000-0000-00000000f20'||n)::uuid,'00000000-0000-0000-0000-00000000f101',
 'direct','Titular Concurrencia Sintético',2,(now() AT TIME ZONE 'America/Bogota')::date+n,
 (now() AT TIME ZONE 'America/Bogota')::date+n+2 FROM generate_series(1,3) n;
INSERT INTO public.building_recipients(id,property_id,channel,address,verified_at,verified_by,verification_evidence,version) VALUES
 ('00000000-0000-0000-0000-00000000f301','00000000-0000-0000-0000-00000000f101','email','porteria-concurrente@example.test',
 clock_timestamp(),'00000000-0000-0000-0000-00000000f001','Contacto Sintético verificado',1);
CREATE TABLE public.building_test_inputs AS
 SELECT r.id,jsonb_build_object('reservation_id',r.id,'recipient_id',c.id,'snapshot',airadmin_building.snapshot(r,c,p.name)) AS input
 FROM public.reservations r JOIN public.properties p ON p.id=r.property_id
 JOIN public.building_recipients c ON c.property_id=p.id WHERE p.id='00000000-0000-0000-0000-00000000f101';
GRANT SELECT ON public.building_test_inputs TO authenticated;
SQL
pair() {
 local mode="$1" key
 for writer in 1 2; do
  key="$mode-$writer"; [[ "$mode" == retry ]] && key='same-record-request'
  "${PSQL[@]}" -v mode="$mode" -v key="$key" >"$LOGDIR/$mode-$writer" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000f001';
SELECT CASE WHEN :'mode'='prepare' THEN public.manage_building_notice('prepare',input||jsonb_build_object('request_key',:'key'))
 ELSE public.manage_building_notice('record',jsonb_build_object('notice_id',n.id,
 'expected_version',CASE WHEN :'mode'='retry' THEN 2 ELSE 1 END,'request_key',:'key',
 'action',CASE WHEN :'mode'='retry' THEN 'sent' ELSE 'uncertain' END,
 'evidence_kind',CASE WHEN :'mode'='retry' THEN 'operator_confirmation' ELSE 'uncertain_result' END,
 'occurred_at',date_trunc('minute',n.created_at),'confirmed',true,'evidence','Referencia Concurrente Sintética')) END
 FROM public.building_test_inputs i LEFT JOIN public.building_notices n ON n.reservation_id=i.id
 WHERE i.id='00000000-0000-0000-0000-00000000f201';
SELECT pg_sleep(0.15);
COMMIT;
SQL
  if [[ "$writer" == 1 ]]; then first=$!; else second=$!; fi
 done
 wait "$first"; wait "$second"
}
pair prepare
[[ $(rg -l '"ok": true' "$LOGDIR/prepare-"* | wc -l | tr -d ' ') == 2 ]] || { cat "$LOGDIR/prepare-"*; exit 1; }
pair conflict
[[ $(rg -l '"conflict": true' "$LOGDIR/conflict-"* | wc -l | tr -d ' ') == 1 ]] || { cat "$LOGDIR/conflict-"*; exit 1; }
pair retry
[[ $(rg -l '"replayed": true' "$LOGDIR/retry-"* | wc -l | tr -d ' ') == 1 ]] || { cat "$LOGDIR/retry-"*; exit 1; }
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.building_notices WHERE reservation_id='00000000-0000-0000-0000-00000000f201' AND version=3 AND status='sent')<>1
 OR (SELECT count(*) FROM public.building_notice_history WHERE reservation_id='00000000-0000-0000-0000-00000000f201' AND action IN ('sent','uncertain'))<>2
 THEN RAISE EXCEPTION 'FALLA: avisos simultáneos duplicaron contenido o confirmación'; END IF;
END $$;
SQL
# Una modificación que espera al borrador debe invalidarlo al obtener el bloqueo.
"${PSQL[@]}" >"$LOGDIR/date-race" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000f001';
SELECT public.manage_building_notice('prepare',input||'{"request_key":"date-race"}'::jsonb)
 FROM public.building_test_inputs WHERE id='00000000-0000-0000-0000-00000000f202';
\echo LOCKED
SELECT pg_sleep(0.7);
COMMIT;
SQL
first=$!
for _ in {1..80}; do rg -q LOCKED "$LOGDIR/date-race" && break; sleep 0.03; done
rg -q LOCKED "$LOGDIR/date-race" || { cat "$LOGDIR/date-race"; exit 1; }
"${PSQL[@]}" -c "UPDATE public.reservations SET check_in=check_in+1,check_out=check_out+1 WHERE id='00000000-0000-0000-0000-00000000f202'"
wait "$first"
# A la inversa, un snapshot capturado antes de la cancelación no puede prepararse.
"${PSQL[@]}" >"$LOGDIR/cancel-race" 2>&1 <<'SQL' &
BEGIN;
UPDATE public.reservations SET status='cancelled' WHERE id='00000000-0000-0000-0000-00000000f203';
\echo LOCKED
SELECT pg_sleep(0.7);
COMMIT;
SQL
first=$!
for _ in {1..80}; do rg -q LOCKED "$LOGDIR/cancel-race" && break; sleep 0.03; done
rg -q LOCKED "$LOGDIR/cancel-race" || { cat "$LOGDIR/cancel-race"; exit 1; }
"${PSQL[@]}" >"$LOGDIR/after-cancel" <<'SQL'
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0000-00000000f001';
SELECT public.manage_building_notice('prepare',input||'{"request_key":"cancel-race"}'::jsonb)
 FROM public.building_test_inputs WHERE id='00000000-0000-0000-0000-00000000f203';
SQL
wait "$first"
rg -q '"ok": false' "$LOGDIR/after-cancel" || { cat "$LOGDIR/after-cancel"; exit 1; }
if "${PSQL[@]}" >"$LOGDIR/isolation" 2>&1 <<'SQL'
\set VERBOSITY verbose
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-00000000f001';
SELECT public.manage_building_notice('prepare',input||'{"request_key":"isolation"}'::jsonb)
 FROM public.building_test_inputs WHERE id='00000000-0000-0000-0000-00000000f201';
COMMIT;
SQL
then echo 'FALLA: avisos aceptan snapshot fijo'; exit 1; fi
rg -q '40001' "$LOGDIR/isolation" || { cat "$LOGDIR/isolation"; exit 1; }
"${PSQL[@]}" <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.building_notices WHERE reservation_id='00000000-0000-0000-0000-00000000f202' AND version=2 AND review_reason IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.building_notices WHERE reservation_id='00000000-0000-0000-0000-00000000f203')
 THEN RAISE EXCEPTION 'FALLA: fecha/cancelación concurrente permitió aviso obsoleto'; END IF;
 RAISE NOTICE 'OK: avisos simultáneos, dedupe, conflicto, reintento, fechas y cancelación concurrentes';
END $$;
SQL
