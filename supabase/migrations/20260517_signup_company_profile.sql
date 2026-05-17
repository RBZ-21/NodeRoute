-- Signup company profile fields used by the public account creation flow.
alter table public.companies
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text;
