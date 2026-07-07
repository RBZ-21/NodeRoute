-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260706110000_rls_remove_null_tenant_failopen
-- Finding  : DB-010 (Root Depth Scan, commit 904d7119)
-- Purpose  : The tenant policies on customer_visit_logs and sms_blast_log
--            (20260517000100:51-58, 117-124) used
--              "company_id IS NULL OR company_id = auth_company_id()"
--            in both USING and WITH CHECK — any authenticated tenant could
--            read AND write NULL-tenant rows, and could insert new rows with
--            company_id NULL to share data across tenants.
--
--            Per remediation plan: backfill existing NULL company_id rows to
--            their owner first, then remove the IS NULL disjunct — do not
--            just tighten the policy and orphan rows.
--
--            Backfill target: the designated system/default tenant
--            00000000-0000-0000-0000-000000000001, the same company id used
--            by the original multi-company backfill (20260416_multi_company)
--            and by column defaults across the schema. Rows created before
--            tenant scoping existed belong to that original single-tenant
--            deployment by construction.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Backfill NULL-tenant rows before tightening ───────────────────────────

update public.customer_visit_logs
set company_id = '00000000-0000-0000-0000-000000000001'
where company_id is null;

update public.sms_blast_log
set company_id = '00000000-0000-0000-0000-000000000001'
where company_id is null;

-- ── 2. Recreate the policies without the fail-open disjunct ─────────────────

drop policy if exists "customer_visit_logs: tenant scoped" on public.customer_visit_logs;
create policy "customer_visit_logs: tenant scoped"
  on public.customer_visit_logs
  for all
  to authenticated
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());

drop policy if exists "sms_blast_log: tenant scoped" on public.sms_blast_log;
create policy "sms_blast_log: tenant scoped"
  on public.sms_blast_log
  for all
  to authenticated
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());

-- ── 3. Keep future rows owned: default the tenant column ────────────────────
-- Backend service-role writes stamp company_id explicitly; this default only
-- protects any legacy code path that still omits it (such rows would
-- otherwise become invisible to every tenant rather than fail-open).

alter table public.customer_visit_logs
  alter column company_id set default '00000000-0000-0000-0000-000000000001';

alter table public.sms_blast_log
  alter column company_id set default '00000000-0000-0000-0000-000000000001';
