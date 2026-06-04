-- ─────────────────────────────────────────────────────────────────────────────
-- 003_performance_indexes.sql
--
-- Postgres does NOT auto-create indexes on foreign-key columns, and the app
-- filters/sorts heavily on dates and status. These indexes keep calendar,
-- dashboard, cleaning and report queries fast as the data grows.
--
-- Safe to run multiple times (IF NOT EXISTS). Run once in the Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- reservations: calendar/dashboard/reports filter by dates + status, join by property
CREATE INDEX IF NOT EXISTS idx_reservations_check_in     ON public.reservations (check_in);
CREATE INDEX IF NOT EXISTS idx_reservations_check_out    ON public.reservations (check_out);
CREATE INDEX IF NOT EXISTS idx_reservations_status       ON public.reservations (status);
CREATE INDEX IF NOT EXISTS idx_reservations_property_id  ON public.reservations (property_id);

-- tasks: dashboard/cleaning/tasks filter by type+status+date, join by reservation/property/assignee
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_for   ON public.tasks (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_tasks_status          ON public.tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_type            ON public.tasks (type);
CREATE INDEX IF NOT EXISTS idx_tasks_reservation_id  ON public.tasks (reservation_id);
CREATE INDEX IF NOT EXISTS idx_tasks_property_id     ON public.tasks (property_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to     ON public.tasks (assigned_to);

-- Composite: the most common dashboard query (type + status + date together)
CREATE INDEX IF NOT EXISTS idx_tasks_type_status_date
  ON public.tasks (type, status, scheduled_for);

-- maintenance & expenses: join by property, filter by status/date
CREATE INDEX IF NOT EXISTS idx_maintenance_property_id ON public.maintenance (property_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_status      ON public.maintenance (status);
CREATE INDEX IF NOT EXISTS idx_expenses_property_id    ON public.expenses (property_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date           ON public.expenses (date);
