-- Datos sintéticos previos a la migración para comprobar la compatibilidad heredada.
INSERT INTO public.reservations (id, property_id, source, guest_name, check_in, check_out, status)
VALUES ('00000000-0000-0000-0000-000000007001','00000000-0000-0000-0000-0000000013a3','direct','Horarios Sintético','2027-02-10','2027-02-13','confirmed');
INSERT INTO public.tasks (id, property_id, reservation_id, type, scheduled_for, notes) VALUES
('00000000-0000-0000-0000-000000007101','00000000-0000-0000-0000-0000000013a3','00000000-0000-0000-0000-000000007001','cleaning','2027-02-13','12:30|Nota sintética'),
('00000000-0000-0000-0000-000000007102','00000000-0000-0000-0000-0000000013a3','00000000-0000-0000-0000-000000007001','preparation','2027-02-09','14:00|Cuna sintética');
INSERT INTO public.reservations (id, property_id, source, guest_name, check_in, check_out, status)
VALUES ('00000000-0000-0000-0000-000000007004','00000000-0000-0000-0000-0000000013a3','direct','Estancia Sintética Modificada','2027-02-20','2027-02-23','confirmed');
INSERT INTO public.tasks (id, property_id, reservation_id, type, scheduled_for, notes)
VALUES ('00000000-0000-0000-0000-000000007104','00000000-0000-0000-0000-0000000013a3','00000000-0000-0000-0000-000000007004','cleaning','2027-02-13','16:00|Nota de estancia anterior');
