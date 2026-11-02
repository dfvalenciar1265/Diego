-- Solo datos sintéticos dentro de la base LOCAL temporal de test-migrations.sh.
BEGIN;
INSERT INTO public.properties(id,name,capacity,active)
SELECT id, 'Casa Blue Sintético ' || ord, 8, true FROM unnest(ARRAY[
 '0b6170ff-6049-4e21-b6bc-c4237cc2c0f6','4b10f347-cf1b-4b89-81b6-b73c41d697a3',
 '2be6deec-8061-453e-b1ae-ce0bd177fadd','b73c70dd-204b-42f1-a1e1-674de53eca84',
 '823591d2-e4a9-4893-bd01-f1394a38545d','097d3266-e9d6-4ed0-a403-6dd051c5d042',
 '66a7c1ee-2117-4178-890e-181cd904778c','6a878ed2-148b-4078-9f66-90aab3e76b19'
]::uuid[]) WITH ORDINALITY AS x(id,ord)
ON CONFLICT(id) DO UPDATE SET active=true;
INSERT INTO public.availability_rules(property_id,min_nights,max_nights,advance_notice_hours,preparation_nights,same_day_turnover,verified_at,source_note)
SELECT id,2,180,0,0,true,now(),'Regla Sintética' FROM public.properties WHERE name LIKE 'Casa Blue Sintético%'
ON CONFLICT(property_id) DO UPDATE SET verified_at=now();
CREATE TEMP TABLE test_days AS SELECT (now() AT TIME ZONE 'America/Bogota')::date AS today;
INSERT INTO public.reservations(property_id,source,guest_name,check_in,check_out,status,notes)
SELECT '0b6170ff-6049-4e21-b6bc-c4237cc2c0f6'::uuid,'airbnb','Correo Sintético',today+10,today+13,'confirmed','Nota privada Sintética' FROM test_days
UNION ALL SELECT '4b10f347-cf1b-4b89-81b6-b73c41d697a3','direct','Bloqueo Sintético',today+10,today+13,'blocked','' FROM test_days
UNION ALL SELECT '2be6deec-8061-453e-b1ae-ce0bd177fadd','airbnb','Cancelado Sintético',today+10,today+13,'cancelled','' FROM test_days;
GRANT SELECT ON test_days TO service_role;
SET LOCAL TIME ZONE 'Asia/Tokyo';
CREATE TEMP TABLE before_airadmin_read AS SELECT md5(string_agg(r::text,',' ORDER BY id)) AS h FROM public.reservations r;

SET ROLE service_role;
DO $$ DECLARE s jsonb; t date; BEGIN
 SELECT today INTO t FROM test_days;
 s := public.read_casa_blue_airadmin_availability(t+10,t+13);
 IF jsonb_array_length(s->'properties')<>8 OR jsonb_array_length(s->'rules')<>8 THEN RAISE EXCEPTION 'FALLA: faltan apartamentos/reglas'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'reservations') r WHERE r->>'property_id'='0b6170ff-6049-4e21-b6bc-c4237cc2c0f6') THEN RAISE EXCEPTION 'FALLA: omitió reservas Airbnb'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'reservations') r WHERE r->>'property_id'='4b10f347-cf1b-4b89-81b6-b73c41d697a3') THEN RAISE EXCEPTION 'FALLA: omitió bloqueos directos'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'reservations') r WHERE r->>'property_id'='2be6deec-8061-453e-b1ae-ce0bd177fadd') THEN RAISE EXCEPTION 'FALLA: incluye reserva cancelada'; END IF;
 IF (s->'coverage'->>'to')::date<>t+180 THEN RAISE EXCEPTION 'FALLA: horizonte maestro'; END IF;
 IF s::text LIKE '%guest_name%' OR s::text LIKE '%amount%' OR s::text LIKE '%notes%' OR s::text LIKE '%Nota privada%' THEN RAISE EXCEPTION 'FALLA: expone columnas privadas'; END IF;
 RAISE NOTICE 'OK: reservas Airbnb, bloqueos directos, cancelaciones, horizonte y privacidad';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT h FROM before_airadmin_read) IS DISTINCT FROM (SELECT md5(string_agg(r::text,',' ORDER BY id)) FROM public.reservations r) THEN RAISE EXCEPTION 'FALLA: la lectura modificó reservas'; END IF;
 IF has_function_privilege('anon','public.read_casa_blue_airadmin_availability(date,date)','EXECUTE') OR has_function_privilege('authenticated','public.read_casa_blue_airadmin_availability(date,date)','EXECUTE') THEN RAISE EXCEPTION 'FALLA: función expuesta fuera del servidor'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.read_casa_blue_airadmin_availability(date,date)'::regprocedure) THEN RAISE EXCEPTION 'FALLA: SECURITY DEFINER'; END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.read_casa_blue_airadmin_availability(current_date+10,current_date+13);
  RAISE EXCEPTION 'FALLA: anon pudo ejecutar la lectura';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Más de 1000 periodos: la agregación SQL no trunca resultados por PostgREST.
INSERT INTO public.reservations(property_id,source,guest_name,check_in,check_out,status)
SELECT 'b73c70dd-204b-42f1-a1e1-674de53eca84','airbnb','Volumen Sintético '||n,today+20,today+22,'confirmed'
FROM test_days CROSS JOIN generate_series(1,1100) n;
DO $$ DECLARE s jsonb; t date; BEGIN
 SELECT today INTO t FROM test_days;
 s:=public.read_casa_blue_airadmin_availability(t+20,t+22);
 IF (SELECT count(*) FROM jsonb_array_elements(s->'reservations') r WHERE r->>'property_id'='b73c70dd-204b-42f1-a1e1-674de53eca84')<>1100 THEN RAISE EXCEPTION 'FALLA: truncó periodos'; END IF;
END $$;

-- Un cambio guardado se lee inmediatamente; conserva la alternativa pendiente y las marcas.
UPDATE public.reservations SET check_in=(SELECT today+30 FROM test_days), check_out=(SELECT today+33 FROM test_days),
 pending_change=jsonb_build_object('check_in_to',(SELECT today+40 FROM test_days),'check_out_to',(SELECT today+43 FROM test_days)), notes='⚠️ Diferencia con Airbnb'
WHERE guest_name='Correo Sintético';
DO $$ DECLARE s jsonb; r jsonb; t date; BEGIN
 SELECT today INTO t FROM test_days;
 s:=public.read_casa_blue_airadmin_availability(t+40,t+43);
 SELECT e INTO r FROM jsonb_array_elements(s->'reservations') e WHERE e->>'property_id'='0b6170ff-6049-4e21-b6bc-c4237cc2c0f6';
 IF r->>'start'<>(t+30)::text OR r->'alternate'->>'start'<>(t+40)::text OR r->>'dates_uncertain'<>'true' THEN RAISE EXCEPTION 'FALLA: perdió cambios o contradicciones'; END IF;
 RAISE NOTICE 'OK: lectura no escribe, permisos, más de 1000 periodos y cambios de fecha';
END $$;
ROLLBACK;
