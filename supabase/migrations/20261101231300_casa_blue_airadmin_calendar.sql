-- Casa Blue: AirAdmin es el calendario maestro por decisión de Diego (1-nov-2026).
-- Solo agrega una lectura; no inserta/actualiza reservas, reglas, cron ni datos iCal.
-- Recuperación: volver al HTML/API anterior; después, con aprobación, REVOKE EXECUTE
-- y DROP FUNCTION public.read_casa_blue_airadmin_availability(date,date).
-- No borrar reservas, reglas, eventos ni historiales para recuperar la versión anterior.
BEGIN;
CREATE OR REPLACE FUNCTION public.read_casa_blue_airadmin_availability(p_arrival DATE, p_departure DATE)
RETURNS JSONB
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
WITH ids(id) AS (VALUES
  ('0b6170ff-6049-4e21-b6bc-c4237cc2c0f6'::uuid),
  ('4b10f347-cf1b-4b89-81b6-b73c41d697a3'::uuid),
  ('2be6deec-8061-453e-b1ae-ce0bd177fadd'::uuid),
  ('b73c70dd-204b-42f1-a1e1-674de53eca84'::uuid),
  ('823591d2-e4a9-4893-bd01-f1394a38545d'::uuid),
  ('097d3266-e9d6-4ed0-a403-6dd051c5d042'::uuid),
  ('66a7c1ee-2117-4178-890e-181cd904778c'::uuid),
  ('6a878ed2-148b-4078-9f66-90aab3e76b19'::uuid)
), bounds AS (
  SELECT (statement_timestamp() AT TIME ZONE 'America/Bogota')::date AS today
)
SELECT jsonb_build_object(
  'read_at', statement_timestamp(),
  -- Se incluyen vecinos para evaluar preparación; venta limitada a los 180 días autorizados.
  'coverage', (SELECT jsonb_build_object('from', today - 8, 'to', today + 180) FROM bounds),
  'properties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', p.id, 'active', p.active, 'capacity', p.capacity
  )) FROM public.properties p JOIN ids i ON i.id = p.id), '[]'::jsonb),
  'rules', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'property_id', r.property_id, 'min_nights', r.min_nights, 'max_nights', r.max_nights,
    'date_overrides', r.date_overrides, 'advance_notice_hours', r.advance_notice_hours,
    'booking_window_days', r.booking_window_days, 'preparation_nights', r.preparation_nights,
    'same_day_turnover', r.same_day_turnover, 'turnover_hours', r.turnover_hours,
    'check_in_days', r.check_in_days, 'check_out_days', r.check_out_days,
    'check_in_time', r.check_in_time, 'check_out_time', r.check_out_time
  )) FROM public.availability_rules r JOIN ids i ON i.id = r.property_id
    WHERE r.verified_at IS NOT NULL), '[]'::jsonb),
  'reservations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'property_id', r.property_id, 'start', r.check_in, 'end', r.check_out,
    'dates_uncertain', COALESCE(r.notes LIKE '%⚠️ Fechas actualizadas%' OR r.notes LIKE '%⚠️ Diferencia con Airbnb%', false),
    'alternate', CASE WHEN (NULLIF(r.pending_change->>'check_in_to','') IS NOT NULL
                              AND r.pending_change->>'check_in_to' <> r.check_in::text)
                        OR (NULLIF(r.pending_change->>'check_out_to','') IS NOT NULL
                              AND r.pending_change->>'check_out_to' <> r.check_out::text)
      THEN jsonb_build_object(
        'start', COALESCE(NULLIF(r.pending_change->>'check_in_to',''), r.check_in::text),
        'end', COALESCE(NULLIF(r.pending_change->>'check_out_to',''), r.check_out::text)
      ) ELSE NULL END
  )) FROM public.reservations r JOIN ids i ON i.id = r.property_id
    WHERE r.status IN ('confirmed', 'blocked')
      AND ((r.check_in <= p_departure + 8 AND r.check_out >= p_arrival - 8)
        OR r.pending_change IS NOT NULL
        OR r.notes LIKE '%⚠️ Fechas actualizadas%' OR r.notes LIKE '%⚠️ Diferencia con Airbnb%')
  ), '[]'::jsonb)
);
$$;
REVOKE ALL ON FUNCTION public.read_casa_blue_airadmin_availability(DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_casa_blue_airadmin_availability(DATE, DATE) TO service_role;
COMMENT ON FUNCTION public.read_casa_blue_airadmin_availability(DATE, DATE)
  IS 'Lectura coherente del calendario maestro AirAdmin para Casa Blue, sin datos de huéspedes. Solo service_role.';
COMMIT;
