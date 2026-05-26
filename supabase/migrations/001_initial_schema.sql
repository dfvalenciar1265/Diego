-- Extensiones
create extension if not exists "uuid-ossp";

-- Tabla de team members (extiende auth.users)
create table public.team_members (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'cleaning', 'maintenance')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Propiedades
create table public.properties (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text not null default '',
  access_code text not null default '',
  instructions text not null default '',
  capacity int not null default 2,
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Reservas
create table public.reservations (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source text not null check (source in ('airbnb', 'direct')),
  guest_name text not null default '',
  check_in date not null,
  check_out date not null,
  amount numeric(10,2) not null default 0,
  notes text not null default '',
  status text not null default 'confirmed' check (status in ('confirmed', 'blocked', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint check_dates check (check_out > check_in)
);

-- Tareas
create table public.tasks (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  type text not null check (type in ('cleaning', 'preparation', 'other')),
  assigned_to uuid references public.team_members(id) on delete set null,
  scheduled_for date not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done')),
  notes text not null default '',
  photo_url text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Mantenimiento
create table public.maintenance (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null,
  description text not null default '',
  photo_url text,
  priority text not null default 'normal' check (priority in ('urgent', 'normal', 'scheduled')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  assigned_to uuid references public.team_members(id) on delete set null,
  cost numeric(10,2),
  reported_by uuid not null references public.team_members(id),
  resolved_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Insumos (catálogo global)
create table public.supplies (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  unit text not null default 'unidad',
  created_at timestamptz not null default now()
);

-- Stock por apartamento
create table public.property_supplies (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  supply_id uuid not null references public.supplies(id) on delete cascade,
  current_qty int not null default 0,
  min_qty int not null default 1,
  updated_by uuid references public.team_members(id),
  updated_at timestamptz not null default now(),
  unique(property_id, supply_id)
);

-- Solicitudes de compra
create table public.purchase_requests (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid not null references public.properties(id) on delete cascade,
  supply_id uuid references public.supplies(id) on delete set null,
  description text not null,
  requested_by uuid not null references public.team_members(id),
  status text not null default 'pending' check (status in ('pending', 'purchased')),
  resolved_by uuid references public.team_members(id),
  created_at timestamptz not null default now()
);

-- ── Row Level Security ─────────────────────────────────────────────────────

alter table public.team_members enable row level security;
alter table public.properties enable row level security;
alter table public.reservations enable row level security;
alter table public.tasks enable row level security;
alter table public.maintenance enable row level security;
alter table public.supplies enable row level security;
alter table public.property_supplies enable row level security;
alter table public.purchase_requests enable row level security;

-- Política: todos los usuarios autenticados pueden leer

create policy "authenticated users can read"
  on public.team_members for select to authenticated using (true);

create policy "authenticated users can read"
  on public.properties for select to authenticated using (true);

create policy "authenticated users can read"
  on public.reservations for select to authenticated using (true);

create policy "authenticated users can read"
  on public.tasks for select to authenticated using (true);

create policy "authenticated users can read"
  on public.maintenance for select to authenticated using (true);

create policy "authenticated users can read"
  on public.supplies for select to authenticated using (true);

create policy "authenticated users can read"
  on public.property_supplies for select to authenticated using (true);

create policy "authenticated users can read"
  on public.purchase_requests for select to authenticated using (true);

-- Política: solo admins modifican propiedades y reservas

create policy "admin can modify"
  on public.properties for all to authenticated
  using ((select role from public.team_members where id = auth.uid()) = 'admin');

create policy "admin can modify"
  on public.reservations for all to authenticated
  using ((select role from public.team_members where id = auth.uid()) = 'admin');

-- Política: todos los autenticados pueden modificar tareas, mantenimiento, stock y compras

create policy "authenticated can modify"
  on public.tasks for all to authenticated using (true);

create policy "authenticated can modify"
  on public.maintenance for all to authenticated using (true);

create policy "authenticated can modify"
  on public.property_supplies for all to authenticated using (true);

create policy "authenticated can modify"
  on public.purchase_requests for all to authenticated using (true);

-- ── Storage bucket (aplicar manualmente en Supabase Dashboard) ─────────────
-- Storage → New Bucket → Name: photos → Public: true
