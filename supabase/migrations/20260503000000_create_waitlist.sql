-- Waitlist table for landing-v2 early-access signups
create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  name        text,
  company     text,
  source      text default 'landing',
  created_at  timestamptz not null default now()
);

create unique index if not exists waitlist_email_idx on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

create policy "waitlist_insert_anon"
  on public.waitlist
  for insert
  to anon
  with check (true);
