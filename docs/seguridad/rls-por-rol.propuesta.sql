-- ─────────────────────────────────────────────────────────────────────────────
-- PROPUESTA — NO APLICADA. Reglas de acceso (RLS) por rol para AirAdmin.
--
-- Por qué: hoy la base deja a CUALQUIER usuario con sesión (incluido el personal
-- de limpieza) leer los montos de las reservas y modificar/borrar cualquier tarea,
-- insumo o incidencia llamando a Supabase directo con su sesión (la llave anónima
-- es pública). La app ya oculta y valida esto en el servidor, pero la base no.
--
-- Antes de aplicar:
--   1. Las migraciones del repo no reflejan todo el esquema real (falta `expenses`,
--      columnas como `pending_change`, `next_due`…). Revisar las políticas reales:
--        select tablename, policyname, cmd, qual, with_check
--        from pg_policies where schemaname = 'public' order by tablename;
--   2. Probar en una rama de Supabase (o un proyecto de prueba) con un usuario de
--      cada rol: limpieza inicia/termina limpiezas y ajusta stock; mantenimiento
--      gestiona incidencias; todos reportan incidencias y solicitan compras.
--   3. La sincronización de Gmail, el cron y la API de ChatGPT usan la llave de
--      servicio: RLS no los afecta.
-- ─────────────────────────────────────────────────────────────────────────────

-- Rol del usuario actual, solo si está activo (una persona desactivada = sin rol).
create or replace function public.current_role_active()
returns text language sql stable security definer set search_path = public as $$
  select role from public.team_members where id = auth.uid() and active
$$;

-- ── Gastos: solo administradores ────────────────────────────────────────────
alter table public.expenses enable row level security;
drop policy if exists "admin manages expenses" on public.expenses;
create policy "admin manages expenses" on public.expenses for all to authenticated
  using (public.current_role_active() = 'admin')
  with check (public.current_role_active() = 'admin');
-- (eliminar las políticas existentes de expenses que permitan más que esto)

-- ── Tareas: cualquier miembro activo lee y actualiza (limpieza las toma y las
--    cierra); crear y borrar, solo admin. ────────────────────────────────────
drop policy if exists "authenticated can modify tasks" on public.tasks;
create policy "active members update tasks" on public.tasks for update to authenticated
  using (public.current_role_active() is not null)
  with check (public.current_role_active() is not null);
create policy "active members create tasks" on public.tasks for insert to authenticated
  with check (public.current_role_active() is not null);   -- todos tienen tasks:create
create policy "admin deletes tasks" on public.tasks for delete to authenticated
  using (public.current_role_active() = 'admin');

-- ── Mantenimiento: todos reportan; gestionan admin y mantenimiento ──────────
drop policy if exists "authenticated can modify maintenance" on public.maintenance;
create policy "active members report maintenance" on public.maintenance for insert to authenticated
  with check (public.current_role_active() is not null);
create policy "managers update maintenance" on public.maintenance for update to authenticated
  using (public.current_role_active() in ('admin', 'maintenance'))
  with check (public.current_role_active() in ('admin', 'maintenance'));
create policy "admin deletes maintenance" on public.maintenance for delete to authenticated
  using (public.current_role_active() = 'admin');

-- ── Stock por apartamento: ajustan admin y limpieza (supplies:update_stock) ──
drop policy if exists "authenticated can modify property_supplies" on public.property_supplies;
create policy "stock keepers modify property_supplies" on public.property_supplies for all to authenticated
  using (public.current_role_active() in ('admin', 'cleaning'))
  with check (public.current_role_active() in ('admin', 'cleaning'));

-- ── Montos de reservas ───────────────────────────────────────────────────────
-- RLS filtra filas, no columnas: para que el personal no vea `amount` hay que
-- (a) revocar la columna y (b) leer los montos de los reportes con la llave de
-- servicio después de comprobar que es admin (actions/reports.ts ya lo exige).
-- Es un cambio de código + base que conviene hacer junto; queda como paso 2:
--   revoke select on public.reservations from authenticated;
--   grant select (id, property_id, source, airbnb_code, guest_name, check_in,
--                 check_out, guests, notes, status, pending_change, created_at)
--     on public.reservations to authenticated;
