-- Solo la base temporal local: reproducir duplicados anteriores a la migración, sin datos reales.
\set ON_ERROR_STOP 1
INSERT INTO public.reservations(id,property_id,source,guest_name,check_in,check_out,status) VALUES
 ('00000000-0000-0000-0000-00000000a201','00000000-0000-0000-0000-0000000013b3','direct','Duplicados Futuros Sintético','2032-06-20','2032-06-23','confirmed'),
 ('00000000-0000-0000-0000-00000000a202','00000000-0000-0000-0000-0000000013b3','direct','Duplicados Pasados Sintético','2026-01-20','2026-01-23','confirmed');
INSERT INTO public.tasks(property_id,reservation_id,type,scheduled_for,status,notes,assigned_to) VALUES
 ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a201','cleaning','2032-06-23','pending','Nota sintética A','00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a201','cleaning','2032-06-24','done','Nota sintética B',NULL),
 ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a201','preparation','2032-06-19','pending','Preparación sintética A',NULL),
 ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a201','preparation','2032-06-19','pending','Preparación sintética B','00000000-0000-0000-0000-0000000000c1'),
 ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a202','cleaning','2026-01-23','pending','Nota sintética C',NULL),
 ('00000000-0000-0000-0000-0000000013b3','00000000-0000-0000-0000-00000000a202','cleaning','2026-01-24','in_progress','Nota sintética D','00000000-0000-0000-0000-0000000000c1');
CREATE TABLE public.test_gmail_legacy_snapshot AS SELECT * FROM public.tasks
 WHERE reservation_id IN ('00000000-0000-0000-0000-00000000a201','00000000-0000-0000-0000-00000000a202');
