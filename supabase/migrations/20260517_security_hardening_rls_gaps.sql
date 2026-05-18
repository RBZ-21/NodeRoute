-- Security hardening: fix overly permissive RLS policies and cover missing tables.
--
-- Background:
--   customer_visit_logs was created with USING (true) — every authenticated user
--   could read/write every company's CRM notes across tenant boundaries.
--   companies and company_config had no RLS at all.
--
-- The backend uses the service_role key and bypasses RLS entirely (by design).
-- These policies protect direct Supabase client access (anon/authenticated role).

-- ── Helpers (idempotent) ─────────────────────────────────────────────────────
-- auth_company_id() and is_admin_or_manager() may already exist from prior
-- migrations; use CREATE OR REPLACE to keep this migration idempotent.

create or replace function public.auth_company_id()
returns uuid
language sql
stable
as $$
  select nullif(coalesce(
    auth.jwt() ->> 'activeCompanyId',
    auth.jwt() ->> 'companyId',
    auth.jwt() ->> 'company_id',
    auth.jwt() -> 'app_metadata' ->> 'company_id'
  ), '')::uuid
$$;

create or replace function public.is_admin_or_manager()
returns boolean
language sql
stable
as $$
  select coalesce(
    auth.jwt() ->> 'role',
    auth.jwt() -> 'app_metadata' ->> 'role'
  ) in ('admin', 'manager', 'superadmin')
$$;

-- ── customer_visit_logs ───────────────────────────────────────────────────────
-- Replace the wildcard "USING (true)" policy with a tenant-scoped one.
-- Old policy allowed every authenticated session to read/write all CRM logs.

drop policy if exists "service role full access" on public.customer_visit_logs;

alter table public.customer_visit_logs enable row level security;

create policy "customer_visit_logs: tenant scoped"
  on public.customer_visit_logs
  for all
  to authenticated
  using (
    company_id is null
    or company_id = public.auth_company_id()
  )
  with check (
    company_id is null
    or company_id = public.auth_company_id()
  );

-- ── companies ────────────────────────────────────────────────────────────────
-- Each tenant should only see their own company row.
-- Superadmin access is handled at the service_role layer, not RLS.

alter table public.companies enable row level security;

drop policy if exists "companies: own company only" on public.companies;
create policy "companies: own company only"
  on public.companies
  for all
  to authenticated
  using (id = public.auth_company_id())
  with check (id = public.auth_company_id());

-- ── company_config ────────────────────────────────────────────────────────────

alter table public.company_config enable row level security;

drop policy if exists "company_config: own company only" on public.company_config;
create policy "company_config: own company only"
  on public.company_config
  for all
  to authenticated
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());

-- ── waitlist ──────────────────────────────────────────────────────────────────
-- Waitlist is write-only for anonymous; reads are superadmin-only (service role).
-- Block all direct authenticated reads — superadmin uses service role anyway.

alter table public.waitlist enable row level security;

drop policy if exists "waitlist: insert only" on public.waitlist;
create policy "waitlist: insert only"
  on public.waitlist
  for insert
  to anon, authenticated
  with check (true);

-- No SELECT policy → direct reads return 0 rows for all anon/authenticated roles.

-- ── stripe_webhook_events ─────────────────────────────────────────────────────
-- Webhook events are backend-only; no direct client access needed.

alter table public.stripe_webhook_events enable row level security;
-- No policies → table is inaccessible to anon/authenticated roles.
-- Service role (backend) retains full access regardless of RLS.

-- ── sms_blast_log ─────────────────────────────────────────────────────────────

alter table public.sms_blast_log enable row level security;

drop policy if exists "sms_blast_log: tenant scoped" on public.sms_blast_log;
create policy "sms_blast_log: tenant scoped"
  on public.sms_blast_log
  for all
  to authenticated
  using (
    company_id is null
    or company_id = public.auth_company_id()
  )
  with check (
    company_id is null
    or company_id = public.auth_company_id()
  );
