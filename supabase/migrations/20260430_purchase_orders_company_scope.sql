-- Ensure purchase_orders participates fully in multi-tenant scoping.

alter table public.purchase_orders
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.purchase_orders
set company_id = coalesce(company_id, '00000000-0000-0000-0000-000000000001')
where company_id is null;

alter table public.purchase_orders
  alter column company_id set default '00000000-0000-0000-0000-000000000001';

create index if not exists idx_po_company on public.purchase_orders(company_id);
