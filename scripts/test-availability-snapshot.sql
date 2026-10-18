-- Synthetic regression data only; test-migrations.sh runs this in a disposable LOCAL DB.
INSERT INTO public.properties (id, name, capacity)
VALUES ('097d3266-e9d6-4ed0-a403-6dd051c5d042', 'Sintetico calendario', 6);

INSERT INTO public.reservations (id, property_id, source, guest_name, check_in, check_out, status, pending_change)
VALUES
 ('10000000-0000-0000-0000-000000000001', '097d3266-e9d6-4ed0-a403-6dd051c5d042', 'direct', 'Sintetico pendiente',
  '2026-12-10', '2026-12-13', 'confirmed', '{"check_in_to":"2026-11-11","check_out_to":"2026-11-14"}'),
 ('10000000-0000-0000-0000-000000000002', '097d3266-e9d6-4ed0-a403-6dd051c5d042', 'airbnb', 'Sintetico correo',
  '2026-11-11', '2026-11-14', 'confirmed', NULL),
 ('10000000-0000-0000-0000-000000000003', '097d3266-e9d6-4ed0-a403-6dd051c5d042', 'direct', 'Sintetico cancelado',
  '2026-11-11', '2026-11-14', 'cancelled', NULL);

INSERT INTO public.availability_rules
 (property_id, min_nights, advance_notice_hours, preparation_nights, same_day_turnover, verified_at)
VALUES ('097d3266-e9d6-4ed0-a403-6dd051c5d042', 2, 0, 0, true, now());

SET ROLE service_role;
DO $$
DECLARE
  v_new UUID;
  v_as_of TIMESTAMPTZ := clock_timestamp();
  v_snapshot JSONB;
BEGIN
  v_new := public.record_calendar_sync('airbnb-ical', v_as_of, v_as_of, '2026-10-18', '2027-10-18',
    ARRAY['097d3266-e9d6-4ed0-a403-6dd051c5d042']::uuid[],
    '[{"property_id":"097d3266-e9d6-4ed0-a403-6dd051c5d042","uid":"nuevo","start":"2026-11-12","end":"2026-11-15","kind":"reserved"}]');

  -- Simulate A starting first and finishing AFTER B. It cannot overwrite B.
  BEGIN
    PERFORM public.record_calendar_sync('airbnb-ical', v_as_of - interval '30 seconds', v_as_of - interval '30 seconds',
      '2026-10-18', '2027-10-18', ARRAY['097d3266-e9d6-4ed0-a403-6dd051c5d042']::uuid[], '[]'::jsonb);
    RAISE EXCEPTION 'FALLA: la descarga antigua reemplazo la nueva';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'sincronizacion superada%' THEN RAISE; END IF;
  END;

  v_snapshot := public.read_casa_blue_availability('2026-11-10', '2026-11-13');
  IF (v_snapshot->'run'->>'id')::uuid <> v_new OR v_snapshot->>'consistent' <> 'true' THEN
    RAISE EXCEPTION 'FALLA: metadatos y eventos no corresponden';
  END IF;
  IF jsonb_array_length(v_snapshot->'events') <> 1 OR v_snapshot->'events'->0->>'start_date' <> '2026-11-12' THEN
    RAISE EXCEPTION 'FALLA: se perdio la ocupacion nueva';
  END IF;
  IF jsonb_array_length(v_snapshot->'manual') <> 1
    OR v_snapshot->'manual'->0->>'id' <> '10000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FALLA: cambio pendiente omitido o reserva de correo/cancelada incluida';
  END IF;
  IF jsonb_array_length(v_snapshot->'rules') <> 1 THEN RAISE EXCEPTION 'FALLA: reglas verificadas ausentes'; END IF;

  -- An inherited corrupt/mixed snapshot must be detected even if the selected run has no events.
  UPDATE public.calendar_events SET run_id = (SELECT id FROM public.calendar_sync_runs WHERE id <> v_new LIMIT 1)
    WHERE property_id = '097d3266-e9d6-4ed0-a403-6dd051c5d042';
  v_snapshot := public.read_casa_blue_availability('2026-11-10', '2026-11-13');
  IF v_snapshot->>'consistent' <> 'false' THEN RAISE EXCEPTION 'FALLA: eventos de otra corrida parecen libres'; END IF;
  UPDATE public.calendar_events SET run_id = v_new WHERE property_id = '097d3266-e9d6-4ed0-a403-6dd051c5d042';

  -- Aggregate inside SQL: the PostgREST row cap cannot truncate calendar rows.
  INSERT INTO public.calendar_events(property_id, source, uid, start_date, end_date, kind, run_id)
  SELECT '097d3266-e9d6-4ed0-a403-6dd051c5d042', 'airbnb-ical', 'sintetico-' || n,
    '2026-11-11', '2026-11-12', 'blocked', v_new FROM generate_series(1, 1001) n;
  v_snapshot := public.read_casa_blue_availability('2026-11-10', '2026-11-13');
  IF jsonb_array_length(v_snapshot->'events') <> 1002 THEN RAISE EXCEPTION 'FALLA: calendario truncado'; END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.read_casa_blue_availability(date,date)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'FALLA: lectura no es STABLE';
  END IF;
  RAISE NOTICE 'OK: corridas monotonic as, snapshot coherente, cambio pendiente, correo/canceladas excluidos, >1000 eventos';
END $$;
RESET ROLE;

SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.read_casa_blue_availability('2026-11-10', '2026-11-13');
    RAISE EXCEPTION 'FALLA: anon puede leer el snapshot privado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
