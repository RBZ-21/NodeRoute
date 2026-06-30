alter table if exists "Customers"
  add column if not exists billing_name text,
  add column if not exists billing_contact text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists billing_address text;

alter table if exists invoices
  add column if not exists billing_name text,
  add column if not exists billing_contact text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists billing_address text;
