-- Retail tax preferences, processing invoice linkage, and required cold-chain logs.

alter table if exists public."Customers"
  add column if not exists address text,
  add column if not exists tax_enabled boolean not null default false;

alter table if exists public.orders
  add column if not exists tax_enabled boolean not null default false,
  add column if not exists tax_rate numeric not null default 0.09,
  add column if not exists invoice_id text;

alter table if exists public.invoices
  add column if not exists tax_enabled boolean not null default false,
  add column if not exists tax_rate numeric not null default 0.09,
  add column if not exists order_id text;

create table if not exists public.temperature_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  location_id uuid,
  logged_at timestamptz not null default now(),
  storage_area text not null,
  temperature numeric not null,
  unit text not null default 'F',
  check_type text not null default 'routine',
  corrective_action text,
  initials text,
  notes text,
  recorded_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_temperature_logs_logged_at on public.temperature_logs(logged_at desc);
create index if not exists idx_temperature_logs_location on public.temperature_logs(location_id);

alter table public.temperature_logs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'temperature_logs'
      and policyname = 'Allow all for authenticated'
  ) then
    create policy "Allow all for authenticated" on public.temperature_logs for all using (true);
  end if;
end $$;
