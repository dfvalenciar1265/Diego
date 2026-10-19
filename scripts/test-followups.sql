-- Pruebas de la migración 20261019130000 (cobros adicionales y solicitudes especiales).
-- Solo datos sintéticos, en la base local temporal de scripts/test-migrations.sh.
\set ON_ERROR_STOP 1

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000c1');
INSERT INTO public.team_members (id, name, email, role) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'Admin Sintético', 'admin@example.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'Limpieza Sintética', 'limpieza@example.test', 'cleaning');
INSERT INTO public.properties (id, name, capacity) VALUES
  ('00000000-0000-0000-0000-0000000013a3', 'Torres 1303 (sintético)', 8),
  ('00000000-0000-0000-0000-0000000013b3', 'Otro (sintético)', 4);
INSERT INTO public.reservations (id, property_id, source, guest_name, check_in, check_out, amount, status, airbnb_code) VALUES
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000013a3', 'airbnb', 'Huésped Enero', '2027-01-02', '2027-01-09', 7000000, 'confirmed', 'HMSYNTH01'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000013a3', 'airbnb', 'Huésped Octubre', '2026-10-24', '2026-10-26', 900000, 'confirmed', 'HMSYNTH02');

-- ── Cobro adicional: Torres 1303, 2–9 ene 2027, $500.000 a cobrar el 9 ─────
INSERT INTO public.reservation_charges (id, reservation_id, property_id, concept, amount, due_date, created_by, updated_via)
VALUES ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000e001',
        '00000000-0000-0000-0000-0000000013b3',  -- apartamento equivocado: el trigger usa el de la reserva
        'Adicional estadía', 500000, '2027-01-09', '00000000-0000-0000-0000-0000000000d1', 'mcp');

DO $$ BEGIN
  IF (SELECT property_id FROM public.reservation_charges WHERE id = '00000000-0000-0000-0000-0000000c0001')
     <> '00000000-0000-0000-0000-0000000013a3' THEN RAISE EXCEPTION 'FALLA: el cobro no tomó el apartamento de la reserva'; END IF;
  IF (SELECT count(*) FROM public.followup_history WHERE entity = 'charge' AND action = 'insert') <> 1 THEN
    RAISE EXCEPTION 'FALLA: alta sin historial'; END IF;
  IF (SELECT amount FROM public.reservations WHERE id = '00000000-0000-0000-0000-00000000e001') <> 7000000 THEN
    RAISE EXCEPTION 'FALLA: el cobro tocó el precio de la reserva'; END IF;

  BEGIN
    INSERT INTO public.reservation_charges (reservation_id, property_id, concept, amount, due_date, created_by)
    VALUES ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000013a3', '  ADICIONAL estadía ', 500000, '2027-01-09', '00000000-0000-0000-0000-0000000000d1');
    RAISE EXCEPTION 'FALLA: aceptó un cobro duplicado';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.reservation_charges (reservation_id, property_id, concept, amount, due_date, created_by, currency)
    VALUES ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000013a3', 'Otro', 10, '2027-01-09', '00000000-0000-0000-0000-0000000000d1', 'USD');
    RAISE EXCEPTION 'FALLA: aceptó una moneda distinta de COP';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.reservation_charges SET status = 'collected', collected_on = '2027-01-09', updated_by = '00000000-0000-0000-0000-0000000000d1', updated_via = 'mcp'
     WHERE id = '00000000-0000-0000-0000-0000000c0001';
    RAISE EXCEPTION 'FALLA: dio por cobrado sin confirmación';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK: cobro separado del precio, sin duplicados y con prueba de cobro obligatoria';
END $$;

-- Concurrencia optimista: dos escritores leen version 1; solo el primero gana.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.reservation_charges SET notes = 'primero', updated_by = '00000000-0000-0000-0000-0000000000d1', updated_via = 'app'
   WHERE id = '00000000-0000-0000-0000-0000000c0001' AND version = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FALLA: el primer escritor no actualizó'; END IF;
  UPDATE public.reservation_charges SET notes = 'segundo', updated_by = '00000000-0000-0000-0000-0000000000d1', updated_via = 'app'
   WHERE id = '00000000-0000-0000-0000-0000000c0001' AND version = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA: el segundo escritor pisó el cambio'; END IF;
  IF (SELECT notes FROM public.reservation_charges WHERE id = '00000000-0000-0000-0000-0000000c0001') <> 'primero' THEN
    RAISE EXCEPTION 'FALLA: se perdió el primer cambio'; END IF;
  RAISE NOTICE 'OK: version evita sobrescrituras concurrentes';
END $$;

-- Cambio de fechas de la reserva → el cobro pendiente queda para revisar, sin borrarse.
UPDATE public.reservations SET check_out = '2027-01-10' WHERE id = '00000000-0000-0000-0000-00000000e001';
DO $$ BEGIN
  IF (SELECT review_reason FROM public.reservation_charges WHERE id = '00000000-0000-0000-0000-0000000c0001') IS NULL THEN
    RAISE EXCEPTION 'FALLA: el cambio de fechas no dejó el cobro para revisar'; END IF;
  IF (SELECT status FROM public.reservation_charges WHERE id = '00000000-0000-0000-0000-0000000c0001') <> 'pending' THEN
    RAISE EXCEPTION 'FALLA: el cambio de fechas resolvió el cobro'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.followup_history WHERE via = 'system' AND actor_id IS NULL) THEN
    RAISE EXCEPTION 'FALLA: la marca de revisión no quedó en el historial'; END IF;
  BEGIN
    UPDATE public.reservation_charges SET notes = 'sin autor' WHERE id = '00000000-0000-0000-0000-0000000c0001';
    RAISE EXCEPTION 'FALLA: un escritor heredó el autor "system"';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK: cambio de fechas → revisar, sin borrar ni resolver';
END $$;

-- Cobrado con fecha real y comprobante → estado final; no se borra.
UPDATE public.reservation_charges
   SET status = 'collected', collected_on = '2027-01-09', confirmation = 'Transferencia ref. SINT-1',
       review_reason = NULL, updated_by = '00000000-0000-0000-0000-0000000000d1', updated_via = 'mcp'
 WHERE id = '00000000-0000-0000-0000-0000000c0001';
DO $$ BEGIN
  BEGIN
    UPDATE public.reservation_charges SET amount = 400000, updated_by = '00000000-0000-0000-0000-0000000000d1', updated_via = 'app'
     WHERE id = '00000000-0000-0000-0000-0000000c0001';
    RAISE EXCEPTION 'FALLA: cambió el monto de un cobro ya cobrado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.reservation_charges WHERE id = '00000000-0000-0000-0000-0000000c0001';
    RAISE EXCEPTION 'FALLA: borró un cobro';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.followup_history WHERE entity_id = '00000000-0000-0000-0000-0000000c0001') <> 4 THEN
    RAISE EXCEPTION 'FALLA: historial incompleto (%)', (SELECT count(*) FROM public.followup_history WHERE entity_id = '00000000-0000-0000-0000-0000000c0001'); END IF;
  RAISE NOTICE 'OK: cobrado es final, no se borra y todo quedó en el historial';
END $$;

-- ── Solicitud: cuna, Torres 1303, 24–26 oct 2026, lista el 23 temprano ─────
INSERT INTO public.special_requests (id, reservation_id, property_id, kind, description, due_at, created_by, updated_via)
VALUES ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000013a3',
        'crib', 'Cuna instalada antes de la llegada', '2026-10-23 08:00-05', '00000000-0000-0000-0000-0000000000d1', 'mcp');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.special_requests (reservation_id, property_id, kind, description, due_at, created_by)
    VALUES ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000013a3', 'crib', 'Otra cuna', '2026-10-23 08:00-05', '00000000-0000-0000-0000-0000000000d1');
    RAISE EXCEPTION 'FALLA: aceptó una cuna duplicada';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.special_requests SET status = 'notified', notified_at = now(), notified_note = 'Aviso a limpieza (sintético)',
         updated_by = '00000000-0000-0000-0000-0000000000d1', updated_via = 'mcp'
   WHERE id = '00000000-0000-0000-0000-0000000a0001';
  BEGIN
    UPDATE public.special_requests SET status = 'ready', updated_by = '00000000-0000-0000-0000-0000000000d1', updated_via = 'mcp'
     WHERE id = '00000000-0000-0000-0000-0000000a0001';
    RAISE EXCEPTION 'FALLA: dio la cuna por lista sin confirmación';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.special_requests SET status = 'registered', updated_by = '00000000-0000-0000-0000-0000000000d1', updated_via = 'mcp'
     WHERE id = '00000000-0000-0000-0000-0000000a0001';
    RAISE EXCEPTION 'FALLA: una solicitud avisada volvió a registrada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'OK: avisar no es dejar lista; sin duplicados';
END $$;

-- ── RLS por rol ─────────────────────────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.reservation_charges) <> 0 THEN RAISE EXCEPTION 'FALLA: limpieza ve cobros'; END IF;
  IF (SELECT count(*) FROM public.followup_history) <> 0 THEN RAISE EXCEPTION 'FALLA: limpieza ve el historial'; END IF;
  IF (SELECT count(*) FROM public.special_requests) <> 1 THEN RAISE EXCEPTION 'FALLA: limpieza no ve la cuna'; END IF;
  BEGIN
    UPDATE public.special_requests SET description = 'cambiada', updated_by = '00000000-0000-0000-0000-0000000000c1', updated_via = 'app'
     WHERE id = '00000000-0000-0000-0000-0000000a0001';
    RAISE EXCEPTION 'FALLA: limpieza cambió la descripción';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.special_requests (reservation_id, property_id, kind, description, due_at, created_by)
    VALUES ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000013a3', 'beds', 'Camas separadas', now(), '00000000-0000-0000-0000-0000000000c1');
    RAISE EXCEPTION 'FALLA: limpieza creó una solicitud';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.special_requests SET status = 'ready', ready_at = now(), ready_by = '00000000-0000-0000-0000-0000000000c1',
         ready_confirmation = 'Cuna armada y revisada', updated_by = '00000000-0000-0000-0000-0000000000c1', updated_via = 'app'
   WHERE id = '00000000-0000-0000-0000-0000000a0001';
  RAISE NOTICE 'OK: limpieza confirma la cuna, pero no ve cobros ni cambia la solicitud';
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.reservation_charges) <> 1 THEN RAISE EXCEPTION 'FALLA: admin no ve el cobro'; END IF;
  IF (SELECT status FROM public.special_requests WHERE id = '00000000-0000-0000-0000-0000000a0001') <> 'ready' THEN
    RAISE EXCEPTION 'FALLA: no quedó lista'; END IF;
  RAISE NOTICE 'OK: admin ve cobros e historial';
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM public.reservation_charges;
    RAISE EXCEPTION 'FALLA: anon puede consultar cobros';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK: anon sin acceso';
END $$;
RESET ROLE;

-- Cancelación: la solicitud ya lista no se toca; un cobro pendiente nuevo queda para revisar.
INSERT INTO public.reservation_charges (reservation_id, property_id, concept, amount, due_date, created_by, updated_via)
VALUES ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000013a3', 'Persona adicional', 120000, '2026-10-26', '00000000-0000-0000-0000-0000000000d1', 'app');
UPDATE public.reservations SET status = 'cancelled' WHERE id = '00000000-0000-0000-0000-00000000e002';
DO $$ BEGIN
  IF (SELECT review_reason FROM public.reservation_charges WHERE concept = 'Persona adicional') NOT LIKE 'La reserva se canceló%' THEN
    RAISE EXCEPTION 'FALLA: la cancelación no dejó el cobro para revisar'; END IF;
  IF (SELECT review_reason FROM public.special_requests WHERE id = '00000000-0000-0000-0000-0000000a0001') IS NOT NULL THEN
    RAISE EXCEPTION 'FALLA: marcó para revisar una solicitud ya terminada'; END IF;
  RAISE NOTICE 'OK: cancelación → revisar lo abierto, sin borrar';
END $$;
