# Superadmin Dashboard Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Superadmin billing dashboard that lets the NodeRoute platform owner assign each tenant company a pricing tier, override custom pricing, and enable or disable add-on features from the workbook-backed tier matrix.

**Architecture:** Keep the current Express backend and React/Vite `frontend-v2` admin app. Store the workbook tier catalog in Supabase/Postgres tables, store per-company billing profiles and entitlements separately, expose only superadmin-only Express APIs, and render the pricing controls inside the existing `/superadmin` and `/companies` superadmin surfaces.

**Tech Stack:** Express 5, Node 20+ / Node 22-compatible npm workspaces, `@supabase/supabase-js`, Supabase/Postgres with RLS enabled on public tables, Zod, React 18, Vite, TanStack Query, Vitest/Testing Library, `node --test`, existing cookie auth with CSRF for mutations, existing `requireSuperadmin` role/email gate.

## Global Constraints

- Work from `/Users/ryan/NodeRoute Systems`; this is the live Git root.
- Do not commit generated reports, scans, Playwright reports, audit exports, or similar artifacts; keep them under `/Users/ryan/NodeRoute Systems/Reports`.
- Use `/Users/ryan/NodeRoute Systems/Reports/noderoute-pricing-tiers-replacement.xlsx` as the source workbook for pricing defaults.
- Base tiers are exactly `track`, `dispatch`, `operations`, `erp`, and `enterprise`.
- Custom pricing can be changed only by a user who passes `requireSuperadmin`.
- Add-on features must render as list-style checkboxes on each tenant billing profile.
- The paying client is a tenant row in `public.companies`; do not mix this with distributor customer rows in `public."Customers"`.
- All new tables in `public` must have RLS enabled, explicit service-role grants, and no broad anon/authenticated table grants unless the implementation intentionally exposes them through the Data API.
- Do not put authorization decisions in user-editable `user_metadata`; use the existing app user row and `requireSuperadmin` middleware for backend writes.
- Keep the existing onboarding `company_config` vertical flags; the new billing entitlement system complements them and does not replace them in this branch.
- Backend mutation routes must rely on existing cookie auth and CSRF behavior via `sendWithAuth`.
- Each task ends with a runnable test command and a commit.

---

## Source Workbook Defaults

Use these workbook-derived defaults when seeding the catalog and when writing tests.

### Tiers

| Code | Name | Monthly | Setup | Locations | Drivers | Staff Users | Monthly Stops | Included Scope |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `track` | Track | 299 | 750 | 1 | 2 | 3 | 500 | Driver app, proof of delivery, public tracking links, basic customer portal, CSV import. |
| `dispatch` | Dispatch | 799 | 1500 | 1 | 5 | 8 | 2500 | Track plus full route planning, live map, invoices/payment links, full customer portal. |
| `operations` | Operations | 1499 | 3500 | 1 | 10 | 15 | 5000 | Dispatch plus orders, full inventory, purchasing/receiving, pricing/promotions, sales rep tools, scheduled reports, reorder suggestions. |
| `erp` | ERP | 2499 | 7500 | 2 | 15 | 30 | 10000 | Operations plus AR, credit holds, AP/vendor bills, warehouse/bin/cycle counts, lot traceability/compliance, audit log, API access. |
| `enterprise` | Enterprise | 3999 | 15000 | 3 | 25 | 60 | 20000 | ERP plus custom integrations, assisted migration, custom support model, SLA, high-volume limits. |

### Feature Matrix

| Feature Code | Feature Name | Track | Dispatch | Operations | ERP | Enterprise |
| --- | --- | --- | --- | --- | --- | --- |
| `driver_pwa` | Driver PWA | yes | yes | yes | yes | yes |
| `proof_of_delivery` | Proof of delivery photos/signatures | yes | yes | yes | yes | yes |
| `public_tracking_links` | Public tracking links | yes | yes | yes | yes | yes |
| `route_planning_live_map` | Route planning/live map | basic | full | full | full | full |
| `customer_portal` | Customer portal | basic | full | full | full | custom |
| `invoices_payment_links` | Invoices/payment links | no | yes | yes | yes | custom |
| `order_entry_workbench` | Order entry/workbench | no | basic | full | full | custom |
| `product_customer_csv_import` | Product/customer CSV import | yes | yes | yes | yes | assisted_migration |
| `inventory_availability` | Inventory availability | no | basic | full | full | full |
| `purchasing_receiving` | Purchasing/receiving | no | no | yes | yes | yes |
| `pricing_promotions_order_guides` | Pricing/promotions/order guides | no | no | yes | yes | yes |
| `reorder_suggestions` | Reorder suggestions | no | no | yes | yes | custom |
| `sales_rep_tools` | Sales rep tools | no | no | yes | yes | yes |
| `scheduled_reports` | Scheduled reports | no | basic | yes | yes | custom |
| `ar_credit_holds` | AR/credit holds | no | no | basic | full | full |
| `ap_vendor_bills` | AP/vendor bills | no | no | no | full | full |
| `warehouse_bin_cycle_counts` | Warehouse/bin/cycle counts | no | no | basic | full | full |
| `lot_traceability_compliance` | Lot traceability/compliance | no | no | basic | full | full |
| `audit_log` | Audit log | basic | basic | yes | yes | yes |
| `api_integrations` | API/integrations | no | no | limited | yes | custom |
| `ai_po_scan_reorder_help` | AI PO scan/reorder help | no | add_on | included_fair_use | included_fair_use | custom |
| `ai_phone_orders` | AI phone orders | add_on | add_on | add_on | discounted_add_on | custom |

### Add-ons

| Code | Add-on | Base Monthly | Usage / Setup | Eligible Tiers |
| --- | --- | ---: | --- | --- |
| `ai_phone_orders` | AI Phone Orders | 499 | $0.20 per connected minute | All tiers |
| `sms_product_blasts` | SMS Product Blasts | 99 | Pass-through messaging cost | Dispatch+ |
| `accounting_integration` | Accounting Integration | 250 | From $2,500 setup | ERP+ |
| `custom_edi_trading_partner` | Custom EDI / Trading Partner | null | Quote only | Enterprise |
| `data_cleanup_migration` | Data Cleanup / Migration | null | $150/hr or fixed quote | All tiers |
| `after_hours_support` | After-Hours Support | null | Quote only | Enterprise |
| `extra_driver` | Extra Driver | 39 | Per driver per month | All tiers |
| `extra_staff_user` | Extra Staff User | 15 | Per user per month | All tiers |
| `extra_location` | Extra Location | 300 | $300-$500/location/mo | Dispatch+ |

## File Structure

- Create `supabase/migrations/20260704000000_superadmin_billing_catalog.sql`: catalog, per-company billing profiles, entitlements, add-ons, and audit events.
- Modify `backend/services/supabase.js`: add offline demo arrays for new tables so backend tests can run in demo mode.
- Create `backend/lib/superadmin-billing-schemas.js`: Zod schemas for billing profile updates and addon/feature override payloads.
- Create `backend/services/superadmin-billing.js`: catalog loading, company billing hydration, totals calculation, profile mutation, entitlement mutation, audit event insertion.
- Create `backend/routes/superadmin-billing.js`: superadmin-only catalog, company billing, save, audit, and analytics endpoints.
- Modify `backend/routes/superadmin.js`: mount `superadmin-billing` after existing `requireSuperadmin` middleware.
- Modify `backend/services/plan-limits.js`: derive driver and stop limits from the new billing catalog/profile, with compatibility fallback for old plan names.
- Create `backend/tests/superadmin-billing.test.js`: route tests for catalog, authorization, profile updates, addon toggles, custom pricing, and audit rows.
- Modify `backend/tests/noderoute-billing.test.js`: assert Stripe billing config reports the new plan code/label without creating live subscriptions.
- Create `frontend-v2/src/pages/superadmin/billing-types.ts`: frontend API types matching backend payloads.
- Create `frontend-v2/src/hooks/useSuperadminBilling.ts`: TanStack Query hooks for catalog, analytics, company billing, and save mutations.
- Create `frontend-v2/src/pages/superadmin/BillingDashboardPanel.tsx`: MRR/ARR, tier distribution, add-on adoption, and billing alert panel.
- Create `frontend-v2/src/pages/superadmin/ClientBillingDrawer.tsx`: tier selector, custom pricing fields, feature override table, and list-style add-on checkboxes.
- Create `frontend-v2/src/pages/superadmin/AddonChecklist.tsx`: controlled checkbox list for add-on selections.
- Create `frontend-v2/src/pages/superadmin/FeatureMatrixTable.tsx`: compact tier/feature breakdown table.
- Modify `frontend-v2/src/pages/SuperadminPage.tsx`: replace old hardcoded `free/starter/pro/enterprise` tier estimates with catalog-backed analytics and the new panel.
- Modify `frontend-v2/src/pages/CompaniesPage.tsx`: add a Billing action that opens `ClientBillingDrawer` for the selected tenant.
- Create `frontend-v2/src/pages/SuperadminPage.test.tsx`: verifies dashboard uses catalog-backed pricing and opens company billing editor.
- Create `frontend-v2/src/pages/CompaniesPage.billing.test.tsx`: verifies add-on checkbox toggles, custom price saving, and non-overlapping table layout.
- Modify `docs/erp-feature-matrix.md`: append a platform billing section that maps the workbook tiers to code-owned catalog rows.

## Interfaces

Backend API shapes:

```ts
type BillingCatalogResponse = {
  tiers: PlanTier[];
  features: PlanFeature[];
  featureMatrix: PlanFeatureMatrixRow[];
  limits: PlanLimit[];
  addons: PlanAddon[];
};

type CompanyBillingResponse = {
  company: { id: string; name: string; slug: string | null; status: string; plan: string | null };
  profile: CompanyBillingProfile;
  selectedTier: PlanTier;
  effectiveMonthlyCents: number;
  effectiveSetupCents: number;
  effectiveAnnualContractValueCents: number;
  features: CompanyFeatureEntitlement[];
  addons: CompanyAddonEntitlement[];
  auditEvents: PlatformPricingAuditEvent[];
};

type SaveCompanyBillingPayload = {
  plan_tier_code: 'track' | 'dispatch' | 'operations' | 'erp' | 'enterprise';
  billing_status: 'trial' | 'active' | 'paused' | 'cancelled';
  billing_interval: 'monthly' | 'annual';
  custom_pricing_enabled: boolean;
  custom_monthly_price_cents: number | null;
  custom_setup_price_cents: number | null;
  annual_discount_bps: number;
  contract_start_date: string | null;
  contract_end_date: string | null;
  pricing_notes: string;
  feature_overrides: Array<{
    feature_code: string;
    enabled: boolean;
    inclusion: 'no' | 'basic' | 'full' | 'yes' | 'limited' | 'add_on' | 'included_fair_use' | 'discounted_add_on' | 'custom' | 'assisted_migration';
    notes: string;
  }>;
  addons: Array<{
    addon_code: string;
    enabled: boolean;
    quantity: number;
    monthly_price_cents: number | null;
    setup_price_cents: number | null;
    usage_terms: string;
    notes: string;
  }>;
};
```

Frontend component contracts:

```ts
type ClientBillingDrawerProps = {
  companyId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type AddonChecklistProps = {
  addons: EditableAddon[];
  disabled?: boolean;
  onChange: (addons: EditableAddon[]) => void;
};

type FeatureMatrixTableProps = {
  catalog: BillingCatalogResponse;
  editableFeatures?: EditableFeatureOverride[];
  onChange?: (features: EditableFeatureOverride[]) => void;
};
```

---

### Task 1: Supabase Billing Catalog Migration

**Files:**
- Create: `supabase/migrations/20260704000000_superadmin_billing_catalog.sql`
- Modify: `backend/services/supabase.js`
- Modify: `docs/erp-feature-matrix.md`

**Interfaces:**
- Produces: `platform_plan_tiers`, `platform_plan_features`, `platform_plan_feature_matrix`, `platform_plan_limits`, `platform_addons`, `company_billing_profiles`, `company_feature_entitlements`, `company_addon_entitlements`, `platform_pricing_audit_events`.
- Produces: seeded tier codes and add-on codes consumed by all later backend and frontend tasks.

- [ ] **Step 1: Create the migration file**

Run:

```bash
touch supabase/migrations/20260704000000_superadmin_billing_catalog.sql
```

Expected: the file exists and `git status -sb` shows it as untracked.

- [ ] **Step 2: Write the migration**

Paste this SQL into `supabase/migrations/20260704000000_superadmin_billing_catalog.sql`:

```sql
-- Superadmin billing catalog and tenant-specific pricing controls.
-- Source workbook: Reports/noderoute-pricing-tiers-replacement.xlsx

create table if not exists public.platform_plan_tiers (
  code text primary key,
  name text not null,
  display_order integer not null unique,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  setup_price_cents integer not null check (setup_price_cents >= 0),
  best_for text not null default '',
  included_scope text not null default '',
  excluded_gated text not null default '',
  upgrade_trigger text not null default '',
  sales_note text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_plan_features (
  code text primary key,
  name text not null,
  category text not null default 'platform',
  description text not null default '',
  display_order integer not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_plan_feature_matrix (
  tier_code text not null references public.platform_plan_tiers(code) on delete cascade,
  feature_code text not null references public.platform_plan_features(code) on delete cascade,
  inclusion text not null check (
    inclusion in (
      'no', 'yes', 'basic', 'full', 'limited', 'add_on',
      'included_fair_use', 'discounted_add_on', 'custom', 'assisted_migration'
    )
  ),
  detail text not null default '',
  pricing_scope_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tier_code, feature_code)
);

create table if not exists public.platform_plan_limits (
  tier_code text not null references public.platform_plan_tiers(code) on delete cascade,
  metric_code text not null,
  metric_label text not null,
  metric_value text not null,
  numeric_value numeric,
  unit text not null default '',
  notes text not null default '',
  display_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tier_code, metric_code)
);

create table if not exists public.platform_addons (
  code text primary key,
  name text not null,
  base_monthly_cents integer check (base_monthly_cents is null or base_monthly_cents >= 0),
  default_setup_cents integer check (default_setup_cents is null or default_setup_cents >= 0),
  usage_terms text not null default '',
  eligible_tier_codes text[] not null default '{}',
  when_to_sell text not null default '',
  pricing_rationale text not null default '',
  quote_only boolean not null default false,
  display_order integer not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_billing_profiles (
  company_id uuid primary key references public.companies(id) on delete cascade,
  plan_tier_code text not null references public.platform_plan_tiers(code),
  billing_status text not null default 'trial' check (billing_status in ('trial', 'active', 'paused', 'cancelled')),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'annual')),
  custom_pricing_enabled boolean not null default false,
  custom_monthly_price_cents integer check (custom_monthly_price_cents is null or custom_monthly_price_cents >= 0),
  custom_setup_price_cents integer check (custom_setup_price_cents is null or custom_setup_price_cents >= 0),
  annual_discount_bps integer not null default 0 check (annual_discount_bps between 0 and 5000),
  contract_start_date date,
  contract_end_date date,
  pricing_notes text not null default '',
  updated_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (contract_end_date is null or contract_start_date is null or contract_end_date >= contract_start_date),
  check (
    custom_pricing_enabled = false
    or custom_monthly_price_cents is not null
    or custom_setup_price_cents is not null
  )
);

create table if not exists public.company_feature_entitlements (
  company_id uuid not null references public.companies(id) on delete cascade,
  feature_code text not null references public.platform_plan_features(code),
  enabled boolean not null default false,
  inclusion text not null check (
    inclusion in (
      'no', 'yes', 'basic', 'full', 'limited', 'add_on',
      'included_fair_use', 'discounted_add_on', 'custom', 'assisted_migration'
    )
  ),
  source text not null default 'tier' check (source in ('tier', 'addon', 'custom')),
  notes text not null default '',
  updated_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, feature_code)
);

create table if not exists public.company_addon_entitlements (
  company_id uuid not null references public.companies(id) on delete cascade,
  addon_code text not null references public.platform_addons(code),
  enabled boolean not null default false,
  quantity numeric not null default 1 check (quantity >= 0),
  monthly_price_cents integer check (monthly_price_cents is null or monthly_price_cents >= 0),
  setup_price_cents integer check (setup_price_cents is null or setup_price_cents >= 0),
  usage_terms text not null default '',
  notes text not null default '',
  updated_by text references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, addon_code)
);

create table if not exists public.platform_pricing_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'billing_profile_created', 'tier_changed', 'pricing_changed',
      'feature_entitlement_changed', 'addon_entitlement_changed',
      'billing_status_changed'
    )
  ),
  performed_by text references public.users(id) on delete set null,
  previous_value jsonb not null default '{}'::jsonb,
  next_value jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists company_billing_profiles_plan_idx on public.company_billing_profiles(plan_tier_code, billing_status);
create index if not exists company_addon_entitlements_enabled_idx on public.company_addon_entitlements(addon_code, enabled);
create index if not exists platform_pricing_audit_events_company_idx on public.platform_pricing_audit_events(company_id, created_at desc);

alter table public.platform_plan_tiers enable row level security;
alter table public.platform_plan_features enable row level security;
alter table public.platform_plan_feature_matrix enable row level security;
alter table public.platform_plan_limits enable row level security;
alter table public.platform_addons enable row level security;
alter table public.company_billing_profiles enable row level security;
alter table public.company_feature_entitlements enable row level security;
alter table public.company_addon_entitlements enable row level security;
alter table public.platform_pricing_audit_events enable row level security;

grant select, insert, update, delete on public.platform_plan_tiers to service_role;
grant select, insert, update, delete on public.platform_plan_features to service_role;
grant select, insert, update, delete on public.platform_plan_feature_matrix to service_role;
grant select, insert, update, delete on public.platform_plan_limits to service_role;
grant select, insert, update, delete on public.platform_addons to service_role;
grant select, insert, update, delete on public.company_billing_profiles to service_role;
grant select, insert, update, delete on public.company_feature_entitlements to service_role;
grant select, insert, update, delete on public.company_addon_entitlements to service_role;
grant select, insert, update, delete on public.platform_pricing_audit_events to service_role;

revoke all on public.platform_plan_tiers from anon, authenticated;
revoke all on public.platform_plan_features from anon, authenticated;
revoke all on public.platform_plan_feature_matrix from anon, authenticated;
revoke all on public.platform_plan_limits from anon, authenticated;
revoke all on public.platform_addons from anon, authenticated;
revoke all on public.company_billing_profiles from anon, authenticated;
revoke all on public.company_feature_entitlements from anon, authenticated;
revoke all on public.company_addon_entitlements from anon, authenticated;
revoke all on public.platform_pricing_audit_events from anon, authenticated;

drop policy if exists "platform billing catalog: platform admin only" on public.platform_plan_tiers;
create policy "platform billing catalog: platform admin only" on public.platform_plan_tiers
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "platform billing features: platform admin only" on public.platform_plan_features;
create policy "platform billing features: platform admin only" on public.platform_plan_features
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "platform billing matrix: platform admin only" on public.platform_plan_feature_matrix;
create policy "platform billing matrix: platform admin only" on public.platform_plan_feature_matrix
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "platform billing limits: platform admin only" on public.platform_plan_limits;
create policy "platform billing limits: platform admin only" on public.platform_plan_limits
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "platform billing addons: platform admin only" on public.platform_addons;
create policy "platform billing addons: platform admin only" on public.platform_addons
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "company billing profiles: platform admin only" on public.company_billing_profiles;
create policy "company billing profiles: platform admin only" on public.company_billing_profiles
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "company feature entitlements: platform admin only" on public.company_feature_entitlements;
create policy "company feature entitlements: platform admin only" on public.company_feature_entitlements
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "company addon entitlements: platform admin only" on public.company_addon_entitlements;
create policy "company addon entitlements: platform admin only" on public.company_addon_entitlements
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "pricing audit events: platform admin only" on public.platform_pricing_audit_events;
create policy "pricing audit events: platform admin only" on public.platform_pricing_audit_events
  for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

insert into public.platform_plan_tiers
  (code, name, display_order, monthly_price_cents, setup_price_cents, best_for, included_scope, excluded_gated, upgrade_trigger, sales_note)
values
  ('track', 'Track', 10, 29900, 75000, 'Small distributor that only wants delivery tracking and proof of delivery.', 'Driver app, proof of delivery, public tracking links, basic customer portal, CSV import.', 'Orders, inventory, purchasing, AR/AP, AI phone orders, integrations.', 'Customer asks for invoices, route management depth, or more than 2 drivers.', 'Publishable tier.'),
  ('dispatch', 'Dispatch', 20, 79900, 150000, '3-5 driver operation needing routes, customer tracking, invoices, and portal.', 'Everything in Track plus full route planning, live map, invoices/payment links, full customer portal.', 'Purchasing, full inventory control, pricing engine, AP, full traceability.', 'Customer needs inventory availability, order entry workbench, purchasing, or more than 5 drivers.', 'Publishable tier.'),
  ('operations', 'Operations', 30, 149900, 350000, 'Distributor ready to run daily operations from one system.', 'Everything in Dispatch plus orders, full inventory, purchasing/receiving, pricing/promotions, sales rep tools, scheduled reports, reorder suggestions.', 'Full AP, advanced warehouse/bin control, full compliance, custom integrations.', 'Customer needs credit holds, AP, compliance audit trail, bin control, or more than 10 drivers.', 'Publishable tier.'),
  ('erp', 'ERP', 40, 249900, 750000, 'Distributor using NodeRoute as core back-office operating system.', 'Everything in Operations plus AR, credit holds, AP/vendor bills, warehouse/bin/cycle counts, lot traceability/compliance, audit log, API access.', 'High-volume AI voice, two-way accounting/ERP sync, custom EDI, dedicated SLA.', 'Customer has multiple locations, custom trading partners, or heavy AI/voice volume.', 'Publishable tier.'),
  ('enterprise', 'Enterprise', 50, 399900, 1500000, 'Multi-location distributor or high-complexity implementation.', 'Everything in ERP plus custom integrations, assisted migration, custom support model, SLA, high-volume limits.', 'Nothing fixed; quote by scope, support, integrations, volume, and risk.', 'Use only after discovery. Do not present as the normal full-suite price.', 'Use from pricing after discovery.')
on conflict (code) do update set
  name = excluded.name,
  display_order = excluded.display_order,
  monthly_price_cents = excluded.monthly_price_cents,
  setup_price_cents = excluded.setup_price_cents,
  best_for = excluded.best_for,
  included_scope = excluded.included_scope,
  excluded_gated = excluded.excluded_gated,
  upgrade_trigger = excluded.upgrade_trigger,
  sales_note = excluded.sales_note,
  updated_at = now();

insert into public.platform_plan_features (code, name, category, description, display_order)
values
  ('driver_pwa', 'Driver PWA', 'delivery', 'Driver route, status updates, and mobile workflow.', 10),
  ('proof_of_delivery', 'Proof of delivery photos/signatures', 'delivery', 'Photo and signature capture for delivery confirmation.', 20),
  ('public_tracking_links', 'Public tracking links', 'delivery', 'Customer-facing delivery status visibility.', 30),
  ('route_planning_live_map', 'Route planning/live map', 'dispatch', 'Route planning, assignment, and live map operations.', 40),
  ('customer_portal', 'Customer portal', 'customer', 'Customer self-service portal scope by tier.', 50),
  ('invoices_payment_links', 'Invoices/payment links', 'financials', 'Invoice visibility and payment links.', 60),
  ('order_entry_workbench', 'Order entry/workbench', 'orders', 'Order creation, editing, imports, and operational order workflows.', 70),
  ('product_customer_csv_import', 'Product/customer CSV import', 'onboarding', 'Template-based product and customer import.', 80),
  ('inventory_availability', 'Inventory availability', 'inventory', 'Stock availability and inventory control depth.', 90),
  ('purchasing_receiving', 'Purchasing/receiving', 'purchasing', 'PO creation, receiving, variance handling, and vendor workflows.', 100),
  ('pricing_promotions_order_guides', 'Pricing/promotions/order guides', 'pricing', 'Price levels, promotions, order guides, and margin controls.', 110),
  ('reorder_suggestions', 'Reorder suggestions', 'purchasing', 'Low-stock, reorder policy, and purchasing decision support.', 120),
  ('sales_rep_tools', 'Sales rep tools', 'sales', 'Customer book, activity, history, and follow-up workflows.', 130),
  ('scheduled_reports', 'Scheduled reports', 'reporting', 'Recurring report schedules and standard management views.', 140),
  ('ar_credit_holds', 'AR/credit holds', 'financials', 'AR visibility, credit status, and credit hold operations.', 150),
  ('ap_vendor_bills', 'AP/vendor bills', 'financials', 'Vendor bill intake, AP ledger, approvals, and payment batches.', 160),
  ('warehouse_bin_cycle_counts', 'Warehouse/bin/cycle counts', 'warehouse', 'Warehouse visibility, bin control, and cycle counts.', 170),
  ('lot_traceability_compliance', 'Lot traceability/compliance', 'compliance', 'Lot genealogy, recall support, and compliance reports.', 180),
  ('audit_log', 'Audit log', 'admin', 'Operational and support audit history.', 190),
  ('api_integrations', 'API/integrations', 'integrations', 'API access, exports, and integration support.', 200),
  ('ai_po_scan_reorder_help', 'AI PO scan/reorder help', 'ai', 'AI scan, reorder draft support, and purchasing assistance.', 210),
  ('ai_phone_orders', 'AI phone orders', 'ai', 'AI voice order intake, review queue, and draft order creation.', 220)
on conflict (code) do update set
  name = excluded.name,
  category = excluded.category,
  description = excluded.description,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.platform_plan_feature_matrix (tier_code, feature_code, inclusion)
values
  ('track','driver_pwa','yes'),('dispatch','driver_pwa','yes'),('operations','driver_pwa','yes'),('erp','driver_pwa','yes'),('enterprise','driver_pwa','yes'),
  ('track','proof_of_delivery','yes'),('dispatch','proof_of_delivery','yes'),('operations','proof_of_delivery','yes'),('erp','proof_of_delivery','yes'),('enterprise','proof_of_delivery','yes'),
  ('track','public_tracking_links','yes'),('dispatch','public_tracking_links','yes'),('operations','public_tracking_links','yes'),('erp','public_tracking_links','yes'),('enterprise','public_tracking_links','yes'),
  ('track','route_planning_live_map','basic'),('dispatch','route_planning_live_map','full'),('operations','route_planning_live_map','full'),('erp','route_planning_live_map','full'),('enterprise','route_planning_live_map','full'),
  ('track','customer_portal','basic'),('dispatch','customer_portal','full'),('operations','customer_portal','full'),('erp','customer_portal','full'),('enterprise','customer_portal','custom'),
  ('track','invoices_payment_links','no'),('dispatch','invoices_payment_links','yes'),('operations','invoices_payment_links','yes'),('erp','invoices_payment_links','yes'),('enterprise','invoices_payment_links','custom'),
  ('track','order_entry_workbench','no'),('dispatch','order_entry_workbench','basic'),('operations','order_entry_workbench','full'),('erp','order_entry_workbench','full'),('enterprise','order_entry_workbench','custom'),
  ('track','product_customer_csv_import','yes'),('dispatch','product_customer_csv_import','yes'),('operations','product_customer_csv_import','yes'),('erp','product_customer_csv_import','yes'),('enterprise','product_customer_csv_import','assisted_migration'),
  ('track','inventory_availability','no'),('dispatch','inventory_availability','basic'),('operations','inventory_availability','full'),('erp','inventory_availability','full'),('enterprise','inventory_availability','full'),
  ('track','purchasing_receiving','no'),('dispatch','purchasing_receiving','no'),('operations','purchasing_receiving','yes'),('erp','purchasing_receiving','yes'),('enterprise','purchasing_receiving','yes'),
  ('track','pricing_promotions_order_guides','no'),('dispatch','pricing_promotions_order_guides','no'),('operations','pricing_promotions_order_guides','yes'),('erp','pricing_promotions_order_guides','yes'),('enterprise','pricing_promotions_order_guides','yes'),
  ('track','reorder_suggestions','no'),('dispatch','reorder_suggestions','no'),('operations','reorder_suggestions','yes'),('erp','reorder_suggestions','yes'),('enterprise','reorder_suggestions','custom'),
  ('track','sales_rep_tools','no'),('dispatch','sales_rep_tools','no'),('operations','sales_rep_tools','yes'),('erp','sales_rep_tools','yes'),('enterprise','sales_rep_tools','yes'),
  ('track','scheduled_reports','no'),('dispatch','scheduled_reports','basic'),('operations','scheduled_reports','yes'),('erp','scheduled_reports','yes'),('enterprise','scheduled_reports','custom'),
  ('track','ar_credit_holds','no'),('dispatch','ar_credit_holds','no'),('operations','ar_credit_holds','basic'),('erp','ar_credit_holds','full'),('enterprise','ar_credit_holds','full'),
  ('track','ap_vendor_bills','no'),('dispatch','ap_vendor_bills','no'),('operations','ap_vendor_bills','no'),('erp','ap_vendor_bills','full'),('enterprise','ap_vendor_bills','full'),
  ('track','warehouse_bin_cycle_counts','no'),('dispatch','warehouse_bin_cycle_counts','no'),('operations','warehouse_bin_cycle_counts','basic'),('erp','warehouse_bin_cycle_counts','full'),('enterprise','warehouse_bin_cycle_counts','full'),
  ('track','lot_traceability_compliance','no'),('dispatch','lot_traceability_compliance','no'),('operations','lot_traceability_compliance','basic'),('erp','lot_traceability_compliance','full'),('enterprise','lot_traceability_compliance','full'),
  ('track','audit_log','basic'),('dispatch','audit_log','basic'),('operations','audit_log','yes'),('erp','audit_log','yes'),('enterprise','audit_log','yes'),
  ('track','api_integrations','no'),('dispatch','api_integrations','no'),('operations','api_integrations','limited'),('erp','api_integrations','yes'),('enterprise','api_integrations','custom'),
  ('track','ai_po_scan_reorder_help','no'),('dispatch','ai_po_scan_reorder_help','add_on'),('operations','ai_po_scan_reorder_help','included_fair_use'),('erp','ai_po_scan_reorder_help','included_fair_use'),('enterprise','ai_po_scan_reorder_help','custom'),
  ('track','ai_phone_orders','add_on'),('dispatch','ai_phone_orders','add_on'),('operations','ai_phone_orders','add_on'),('erp','ai_phone_orders','discounted_add_on'),('enterprise','ai_phone_orders','custom')
on conflict (tier_code, feature_code) do update set inclusion = excluded.inclusion, updated_at = now();

insert into public.platform_plan_limits (tier_code, metric_code, metric_label, metric_value, numeric_value, unit, notes, display_order)
values
  ('track','locations','Locations','1',1,'count','Extra location: $300-$500/mo depending on tier.',10),
  ('dispatch','locations','Locations','1',1,'count','Extra location: $300-$500/mo depending on tier.',10),
  ('operations','locations','Locations','1',1,'count','Extra location: $300-$500/mo depending on tier.',10),
  ('erp','locations','Locations','2',2,'count','Extra location: $300-$500/mo depending on tier.',10),
  ('enterprise','locations','Locations','3',3,'count','Extra location: $300-$500/mo depending on tier.',10),
  ('track','drivers','Drivers','2',2,'count','Extra driver: $39/driver/mo.',20),
  ('dispatch','drivers','Drivers','5',5,'count','Extra driver: $39/driver/mo.',20),
  ('operations','drivers','Drivers','10',10,'count','Extra driver: $39/driver/mo.',20),
  ('erp','drivers','Drivers','15',15,'count','Extra driver: $39/driver/mo.',20),
  ('enterprise','drivers','Drivers','25',25,'count','Extra driver: $39/driver/mo.',20),
  ('track','staff_users','Staff users','3',3,'count','Extra staff user: $15/user/mo.',30),
  ('dispatch','staff_users','Staff users','8',8,'count','Extra staff user: $15/user/mo.',30),
  ('operations','staff_users','Staff users','15',15,'count','Extra staff user: $15/user/mo.',30),
  ('erp','staff_users','Staff users','30',30,'count','Extra staff user: $15/user/mo.',30),
  ('enterprise','staff_users','Staff users','60',60,'count','Extra staff user: $15/user/mo.',30),
  ('track','monthly_stops','Monthly stops/tasks','500',500,'count','Quote overages above limits if usage drives map/SMS/support cost.',40),
  ('dispatch','monthly_stops','Monthly stops/tasks','2500',2500,'count','Quote overages above limits if usage drives map/SMS/support cost.',40),
  ('operations','monthly_stops','Monthly stops/tasks','5000',5000,'count','Quote overages above limits if usage drives map/SMS/support cost.',40),
  ('erp','monthly_stops','Monthly stops/tasks','10000',10000,'count','Quote overages above limits if usage drives map/SMS/support cost.',40),
  ('enterprise','monthly_stops','Monthly stops/tasks','20000',20000,'count','Quote overages above limits if usage drives map/SMS/support cost.',40),
  ('track','support','Support','Email',null,'level','Support level should rise with operational reliance.',50),
  ('dispatch','support','Support','Email + scheduled calls',null,'level','Support level should rise with operational reliance.',50),
  ('operations','support','Support','Priority',null,'level','Support level should rise with operational reliance.',50),
  ('erp','support','Support','Priority + onboarding',null,'level','Support level should rise with operational reliance.',50),
  ('enterprise','support','Support','SLA/custom',null,'level','Support level should rise with operational reliance.',50),
  ('track','historical_reporting','Historical reporting','90 days',90,'days','Retention can become a cost driver.',60),
  ('dispatch','historical_reporting','Historical reporting','1 year',365,'days','Retention can become a cost driver.',60),
  ('operations','historical_reporting','Historical reporting','2 years',730,'days','Retention can become a cost driver.',60),
  ('erp','historical_reporting','Historical reporting','Lifetime',null,'duration','Retention can become a cost driver.',60),
  ('enterprise','historical_reporting','Historical reporting','Custom retention',null,'duration','Retention can become a cost driver.',60),
  ('track','included_onboarding_hours','Included onboarding hours','2',2,'hours','Use fixed setup scope; bill additional work.',70),
  ('dispatch','included_onboarding_hours','Included onboarding hours','4',4,'hours','Use fixed setup scope; bill additional work.',70),
  ('operations','included_onboarding_hours','Included onboarding hours','8',8,'hours','Use fixed setup scope; bill additional work.',70),
  ('erp','included_onboarding_hours','Included onboarding hours','16',16,'hours','Use fixed setup scope; bill additional work.',70),
  ('enterprise','included_onboarding_hours','Included onboarding hours','40',40,'hours','Use fixed setup scope; bill additional work.',70)
on conflict (tier_code, metric_code) do update set
  metric_label = excluded.metric_label,
  metric_value = excluded.metric_value,
  numeric_value = excluded.numeric_value,
  unit = excluded.unit,
  notes = excluded.notes,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.platform_addons
  (code, name, base_monthly_cents, default_setup_cents, usage_terms, eligible_tier_codes, when_to_sell, pricing_rationale, quote_only, display_order)
values
  ('ai_phone_orders', 'AI Phone Orders', 49900, null, '$0.20 per connected minute', array['track','dispatch','operations','erp','enterprise'], 'Customer has high manual phone-order volume.', 'Charge enough to cover Bland/voice cost, QA, and failures.', false, 10),
  ('sms_product_blasts', 'SMS Product Blasts', 9900, null, 'Pass-through messaging cost', array['dispatch','operations','erp','enterprise'], 'Customer sends daily inventory/product availability messages.', 'Keep SMS pass-through separate from platform fee.', false, 20),
  ('accounting_integration', 'Accounting Integration', 25000, 250000, 'From $2,500 setup', array['erp','enterprise'], 'Customer needs QuickBooks/NetSuite/SAP sync.', 'Never include custom accounting sync in low tiers.', false, 30),
  ('custom_edi_trading_partner', 'Custom EDI / Trading Partner', null, null, 'Quote only', array['enterprise'], 'Customer requires live trading-partner exchange.', 'Scope by partner, document type, testing, and support.', true, 40),
  ('data_cleanup_migration', 'Data Cleanup / Migration', null, null, '$150/hr or fixed quote', array['track','dispatch','operations','erp','enterprise'], 'Customer data is messy or source export is inconsistent.', 'Do not absorb bad historical data cleanup.', true, 50),
  ('after_hours_support', 'After-Hours Support', null, null, 'Quote only', array['enterprise'], 'Customer depends on NodeRoute outside normal support windows.', 'Requires SLA, escalation rules, and response windows.', true, 60),
  ('extra_driver', 'Extra Driver', 3900, null, 'Per driver per month', array['track','dispatch','operations','erp','enterprise'], 'Customer exceeds included driver limit.', 'Useful expansion pricing without forcing tier jump immediately.', false, 70),
  ('extra_staff_user', 'Extra Staff User', 1500, null, 'Per user per month', array['track','dispatch','operations','erp','enterprise'], 'Customer exceeds included staff limit.', 'Keep low enough to avoid adoption friction.', false, 80),
  ('extra_location', 'Extra Location', 30000, null, '$300-$500/location/mo', array['dispatch','operations','erp','enterprise'], 'Customer has additional warehouse/location.', 'Use higher price when data separation/setup is complex.', false, 90)
on conflict (code) do update set
  name = excluded.name,
  base_monthly_cents = excluded.base_monthly_cents,
  default_setup_cents = excluded.default_setup_cents,
  usage_terms = excluded.usage_terms,
  eligible_tier_codes = excluded.eligible_tier_codes,
  when_to_sell = excluded.when_to_sell,
  pricing_rationale = excluded.pricing_rationale,
  quote_only = excluded.quote_only,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.company_billing_profiles (company_id, plan_tier_code, billing_status)
select id, case when lower(coalesce(plan, '')) = 'enterprise' then 'erp' else 'track' end, coalesce(nullif(status, ''), 'trial')
from public.companies
on conflict (company_id) do nothing;
```

- [ ] **Step 3: Add offline demo table arrays**

Modify `backend/services/supabase.js` inside `defaultState()` so the returned object includes these arrays near the other table arrays:

```js
    platform_plan_tiers: [],
    platform_plan_features: [],
    platform_plan_feature_matrix: [],
    platform_plan_limits: [],
    platform_addons: [],
    company_billing_profiles: [],
    company_feature_entitlements: [],
    company_addon_entitlements: [],
    platform_pricing_audit_events: [],
```

- [ ] **Step 4: Document the mapping**

Append this section to `docs/erp-feature-matrix.md`:

```markdown
## Platform Billing Catalog

The Superadmin billing catalog is sourced from `Reports/noderoute-pricing-tiers-replacement.xlsx` and lives in `platform_plan_tiers`, `platform_plan_features`, `platform_plan_feature_matrix`, `platform_plan_limits`, and `platform_addons`.

Tenant-specific pricing lives in `company_billing_profiles`, `company_feature_entitlements`, and `company_addon_entitlements`. The distributor customer table `Customers` is not used for platform billing.
```

- [ ] **Step 5: Verify migration syntax with a static parse**

Run:

```bash
rg -n "create table if not exists public.platform_plan_tiers|company_billing_profiles|platform_pricing_audit_events|enable row level security|revoke all" supabase/migrations/20260704000000_superadmin_billing_catalog.sql
```

Expected: matches for all new tables, RLS statements, and revoke statements.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260704000000_superadmin_billing_catalog.sql backend/services/supabase.js docs/erp-feature-matrix.md
git commit -m "feat: add superadmin billing catalog schema"
```

### Task 2: Backend Billing Schemas And Service

**Files:**
- Create: `backend/lib/superadmin-billing-schemas.js`
- Create: `backend/services/superadmin-billing.js`
- Test: `backend/tests/superadmin-billing.test.js`

**Interfaces:**
- Consumes: tables from Task 1.
- Produces: `loadBillingCatalog(db)`, `loadCompanyBilling(db, companyId)`, `saveCompanyBilling(db, companyId, payload, actor)`, and `billingAnalytics(db)`.

- [ ] **Step 1: Write failing service tests**

Create `backend/tests/superadmin-billing.test.js` with this first test block:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateEffectiveMonthlyCents,
  calculateEffectiveSetupCents,
  normalizeBillingPayload,
} = require('../services/superadmin-billing');

test('superadmin billing calculations use custom pricing and enabled add-ons', () => {
  const profile = {
    custom_pricing_enabled: true,
    custom_monthly_price_cents: 125000,
    custom_setup_price_cents: 200000,
  };
  const tier = { monthly_price_cents: 79900, setup_price_cents: 150000 };
  const addons = [
    { enabled: true, quantity: 2, monthly_price_cents: 3900, setup_price_cents: null },
    { enabled: false, quantity: 1, monthly_price_cents: 49900, setup_price_cents: null },
  ];

  assert.equal(calculateEffectiveMonthlyCents({ profile, tier, addons }), 132800);
  assert.equal(calculateEffectiveSetupCents({ profile, tier, addons }), 200000);
});

test('superadmin billing payload rejects invalid tier codes and negative prices', () => {
  assert.throws(() => normalizeBillingPayload({
    plan_tier_code: 'starter',
    billing_status: 'active',
    billing_interval: 'monthly',
    custom_pricing_enabled: true,
    custom_monthly_price_cents: -1,
    custom_setup_price_cents: 0,
    annual_discount_bps: 0,
    contract_start_date: null,
    contract_end_date: null,
    pricing_notes: '',
    feature_overrides: [],
    addons: [],
  }), /plan_tier_code/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test backend/tests/superadmin-billing.test.js
```

Expected: FAIL with `Cannot find module '../services/superadmin-billing'`.

- [ ] **Step 3: Add Zod schemas**

Create `backend/lib/superadmin-billing-schemas.js`:

```js
'use strict';

const { z } = require('zod');

const tierCodeSchema = z.enum(['track', 'dispatch', 'operations', 'erp', 'enterprise']);
const billingStatusSchema = z.enum(['trial', 'active', 'paused', 'cancelled']);
const billingIntervalSchema = z.enum(['monthly', 'annual']);
const inclusionSchema = z.enum([
  'no', 'yes', 'basic', 'full', 'limited', 'add_on',
  'included_fair_use', 'discounted_add_on', 'custom', 'assisted_migration',
]);

const centsSchema = z.number().int().min(0).nullable();

const featureOverrideSchema = z.object({
  feature_code: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  inclusion: inclusionSchema,
  notes: z.string().max(2000).default(''),
}).strict();

const addonSchema = z.object({
  addon_code: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  quantity: z.number().min(0).default(1),
  monthly_price_cents: centsSchema,
  setup_price_cents: centsSchema,
  usage_terms: z.string().max(1000).default(''),
  notes: z.string().max(2000).default(''),
}).strict();

const saveCompanyBillingSchema = z.object({
  plan_tier_code: tierCodeSchema,
  billing_status: billingStatusSchema,
  billing_interval: billingIntervalSchema,
  custom_pricing_enabled: z.boolean(),
  custom_monthly_price_cents: centsSchema,
  custom_setup_price_cents: centsSchema,
  annual_discount_bps: z.number().int().min(0).max(5000).default(0),
  contract_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  contract_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  pricing_notes: z.string().max(4000).default(''),
  feature_overrides: z.array(featureOverrideSchema).default([]),
  addons: z.array(addonSchema).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.contract_start_date && value.contract_end_date && value.contract_end_date < value.contract_start_date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contract_end_date'], message: 'contract_end_date must be on or after contract_start_date' });
  }
  if (value.custom_pricing_enabled && value.custom_monthly_price_cents === null && value.custom_setup_price_cents === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['custom_pricing_enabled'], message: 'custom pricing requires a monthly or setup override' });
  }
});

function parseSaveCompanyBilling(input) {
  return saveCompanyBillingSchema.parse(input);
}

module.exports = {
  parseSaveCompanyBilling,
  saveCompanyBillingSchema,
  tierCodeSchema,
  inclusionSchema,
};
```

- [ ] **Step 4: Add the service implementation**

Create `backend/services/superadmin-billing.js`:

```js
'use strict';

const { parseSaveCompanyBilling } = require('../lib/superadmin-billing-schemas');

const DEFAULT_SELECT_LIMIT = 10000;

function extractRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

function normalizeMoneyCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number);
}

function normalizeBillingPayload(input) {
  return parseSaveCompanyBilling(input);
}

function addonMonthlyCents(addon) {
  if (!addon?.enabled) return 0;
  const quantity = Number(addon.quantity ?? 1);
  const price = normalizeMoneyCents(addon.monthly_price_cents) ?? 0;
  return Math.round(quantity * price);
}

function addonSetupCents(addon) {
  if (!addon?.enabled) return 0;
  return normalizeMoneyCents(addon.setup_price_cents) ?? 0;
}

function calculateEffectiveMonthlyCents({ profile, tier, addons = [] }) {
  const base = profile?.custom_pricing_enabled
    ? normalizeMoneyCents(profile.custom_monthly_price_cents)
    : null;
  const tierBase = normalizeMoneyCents(tier?.monthly_price_cents) ?? 0;
  return (base ?? tierBase) + addons.reduce((sum, addon) => sum + addonMonthlyCents(addon), 0);
}

function calculateEffectiveSetupCents({ profile, tier, addons = [] }) {
  const base = profile?.custom_pricing_enabled
    ? normalizeMoneyCents(profile.custom_setup_price_cents)
    : null;
  const tierBase = normalizeMoneyCents(tier?.setup_price_cents) ?? 0;
  return (base ?? tierBase) + addons.reduce((sum, addon) => sum + addonSetupCents(addon), 0);
}

async function loadBillingCatalog(db) {
  const [tiers, features, featureMatrix, limits, addons] = await Promise.all([
    db.from('platform_plan_tiers').select('*').order('display_order', { ascending: true }).limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_plan_features').select('*').order('display_order', { ascending: true }).limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_plan_feature_matrix').select('*').limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_plan_limits').select('*').order('display_order', { ascending: true }).limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_addons').select('*').order('display_order', { ascending: true }).limit(DEFAULT_SELECT_LIMIT),
  ]);

  for (const result of [tiers, features, featureMatrix, limits, addons]) {
    if (result.error) throw result.error;
  }

  return {
    tiers: extractRows(tiers),
    features: extractRows(features),
    featureMatrix: extractRows(featureMatrix),
    limits: extractRows(limits),
    addons: extractRows(addons),
  };
}

function defaultProfile(company, catalog) {
  const plan = String(company?.plan || '').toLowerCase();
  const tier = catalog.tiers.find((row) => row.code === plan)
    || catalog.tiers.find((row) => row.code === 'track')
    || catalog.tiers[0];
  return {
    company_id: company.id,
    plan_tier_code: tier.code,
    billing_status: company.status === 'suspended' ? 'paused' : (company.status || 'trial'),
    billing_interval: 'monthly',
    custom_pricing_enabled: false,
    custom_monthly_price_cents: null,
    custom_setup_price_cents: null,
    annual_discount_bps: 0,
    contract_start_date: null,
    contract_end_date: null,
    pricing_notes: '',
  };
}

function defaultFeatureEntitlements(companyId, profile, catalog) {
  const matrixRows = catalog.featureMatrix.filter((row) => row.tier_code === profile.plan_tier_code);
  return catalog.features.map((feature) => {
    const matrix = matrixRows.find((row) => row.feature_code === feature.code);
    const inclusion = matrix?.inclusion || 'no';
    return {
      company_id: companyId,
      feature_code: feature.code,
      enabled: !['no', 'add_on'].includes(inclusion),
      inclusion,
      source: 'tier',
      notes: '',
      feature,
    };
  });
}

function defaultAddonEntitlements(companyId, catalog) {
  return catalog.addons.map((addon) => ({
    company_id: companyId,
    addon_code: addon.code,
    enabled: false,
    quantity: 1,
    monthly_price_cents: addon.base_monthly_cents,
    setup_price_cents: addon.default_setup_cents,
    usage_terms: addon.usage_terms || '',
    notes: '',
    addon,
  }));
}

async function loadCompanyBilling(db, companyId) {
  const catalog = await loadBillingCatalog(db);
  const [companyResult, profileResult, featuresResult, addonsResult, auditResult] = await Promise.all([
    db.from('companies').select('id,name,slug,status,plan').eq('id', companyId).single(),
    db.from('company_billing_profiles').select('*').eq('company_id', companyId).single(),
    db.from('company_feature_entitlements').select('*').eq('company_id', companyId).limit(DEFAULT_SELECT_LIMIT),
    db.from('company_addon_entitlements').select('*').eq('company_id', companyId).limit(DEFAULT_SELECT_LIMIT),
    db.from('platform_pricing_audit_events').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(25),
  ]);

  if (companyResult.error) throw companyResult.error;
  if (featuresResult.error) throw featuresResult.error;
  if (addonsResult.error) throw addonsResult.error;
  if (auditResult.error) throw auditResult.error;
  if (profileResult.error && profileResult.error.code !== 'PGRST116') throw profileResult.error;

  const company = companyResult.data;
  const profile = profileResult.data || defaultProfile(company, catalog);
  const selectedTier = catalog.tiers.find((tier) => tier.code === profile.plan_tier_code) || catalog.tiers[0];
  const savedFeatures = extractRows(featuresResult);
  const savedAddons = extractRows(addonsResult);
  const features = defaultFeatureEntitlements(companyId, profile, catalog).map((row) => ({
    ...row,
    ...(savedFeatures.find((saved) => saved.feature_code === row.feature_code) || {}),
    feature: row.feature,
  }));
  const addons = defaultAddonEntitlements(companyId, catalog).map((row) => ({
    ...row,
    ...(savedAddons.find((saved) => saved.addon_code === row.addon_code) || {}),
    addon: row.addon,
  }));

  const effectiveMonthlyCents = calculateEffectiveMonthlyCents({ profile, tier: selectedTier, addons });
  const effectiveSetupCents = calculateEffectiveSetupCents({ profile, tier: selectedTier, addons });

  return {
    catalog,
    company,
    profile,
    selectedTier,
    effectiveMonthlyCents,
    effectiveSetupCents,
    effectiveAnnualContractValueCents: effectiveMonthlyCents * 12 + effectiveSetupCents,
    features,
    addons,
    auditEvents: extractRows(auditResult),
  };
}

async function upsertRows(db, table, rows) {
  if (!rows.length) return [];
  const { data, error } = await db.from(table).upsert(rows).select();
  if (error) throw error;
  return data || [];
}

async function saveCompanyBilling(db, companyId, input, actor) {
  const payload = normalizeBillingPayload(input);
  const before = await loadCompanyBilling(db, companyId).catch(() => null);
  const now = new Date().toISOString();

  const profile = {
    company_id: companyId,
    plan_tier_code: payload.plan_tier_code,
    billing_status: payload.billing_status,
    billing_interval: payload.billing_interval,
    custom_pricing_enabled: payload.custom_pricing_enabled,
    custom_monthly_price_cents: payload.custom_monthly_price_cents,
    custom_setup_price_cents: payload.custom_setup_price_cents,
    annual_discount_bps: payload.annual_discount_bps,
    contract_start_date: payload.contract_start_date,
    contract_end_date: payload.contract_end_date,
    pricing_notes: payload.pricing_notes,
    updated_by: actor?.id || null,
    updated_at: now,
  };

  const { error: companyErr } = await db.from('companies').update({
    plan: payload.plan_tier_code,
    status: payload.billing_status === 'paused' ? 'suspended' : payload.billing_status,
  }).eq('id', companyId);
  if (companyErr) throw companyErr;

  await upsertRows(db, 'company_billing_profiles', [profile]);
  await upsertRows(db, 'company_feature_entitlements', payload.feature_overrides.map((feature) => ({
    company_id: companyId,
    feature_code: feature.feature_code,
    enabled: feature.enabled,
    inclusion: feature.inclusion,
    source: 'custom',
    notes: feature.notes,
    updated_by: actor?.id || null,
    updated_at: now,
  })));
  await upsertRows(db, 'company_addon_entitlements', payload.addons.map((addon) => ({
    company_id: companyId,
    addon_code: addon.addon_code,
    enabled: addon.enabled,
    quantity: addon.quantity,
    monthly_price_cents: addon.monthly_price_cents,
    setup_price_cents: addon.setup_price_cents,
    usage_terms: addon.usage_terms,
    notes: addon.notes,
    updated_by: actor?.id || null,
    updated_at: now,
  })));

  await db.from('platform_pricing_audit_events').insert({
    company_id: companyId,
    event_type: before?.profile?.plan_tier_code === payload.plan_tier_code ? 'pricing_changed' : 'tier_changed',
    performed_by: actor?.id || null,
    previous_value: before ? {
      profile: before.profile,
      addons: before.addons.map((addon) => ({ addon_code: addon.addon_code, enabled: addon.enabled, monthly_price_cents: addon.monthly_price_cents })),
    } : {},
    next_value: payload,
    notes: payload.pricing_notes || '',
  });

  return loadCompanyBilling(db, companyId);
}

async function billingAnalytics(db) {
  const [companiesResult, profilesResult, addonsResult, catalog] = await Promise.all([
    db.from('companies').select('id,name,status,plan').limit(DEFAULT_SELECT_LIMIT),
    db.from('company_billing_profiles').select('*').limit(DEFAULT_SELECT_LIMIT),
    db.from('company_addon_entitlements').select('*').eq('enabled', true).limit(DEFAULT_SELECT_LIMIT),
    loadBillingCatalog(db),
  ]);
  if (companiesResult.error) throw companiesResult.error;
  if (profilesResult.error) throw profilesResult.error;
  if (addonsResult.error) throw addonsResult.error;

  const companies = extractRows(companiesResult);
  const profiles = extractRows(profilesResult);
  const addons = extractRows(addonsResult);
  const tierMap = new Map(catalog.tiers.map((tier) => [tier.code, tier]));

  let mrrCents = 0;
  const tierBreakdown = new Map();
  for (const company of companies) {
    const profile = profiles.find((row) => String(row.company_id) === String(company.id)) || defaultProfile(company, catalog);
    const tier = tierMap.get(profile.plan_tier_code) || catalog.tiers[0];
    const companyAddons = addons.filter((row) => String(row.company_id) === String(company.id));
    const monthly = calculateEffectiveMonthlyCents({ profile, tier, addons: companyAddons });
    mrrCents += profile.billing_status === 'active' ? monthly : 0;
    const current = tierBreakdown.get(profile.plan_tier_code) || { tier: profile.plan_tier_code, count: 0, mrr_cents: 0 };
    current.count += 1;
    if (profile.billing_status === 'active') current.mrr_cents += monthly;
    tierBreakdown.set(profile.plan_tier_code, current);
  }

  return {
    total_companies: companies.length,
    active_companies: companies.filter((company) => company.status === 'active').length,
    mrr_cents: mrrCents,
    arr_cents: mrrCents * 12,
    custom_pricing_companies: profiles.filter((profile) => profile.custom_pricing_enabled).length,
    enabled_addons: addons.length,
    tier_breakdown: Array.from(tierBreakdown.values()).sort((a, b) => String(a.tier).localeCompare(String(b.tier))),
  };
}

module.exports = {
  billingAnalytics,
  calculateEffectiveMonthlyCents,
  calculateEffectiveSetupCents,
  loadBillingCatalog,
  loadCompanyBilling,
  normalizeBillingPayload,
  saveCompanyBilling,
};
```

- [ ] **Step 5: Run service tests**

Run:

```bash
node --test backend/tests/superadmin-billing.test.js
```

Expected: PASS for the calculation and validation tests.

- [ ] **Step 6: Commit**

```bash
git add backend/lib/superadmin-billing-schemas.js backend/services/superadmin-billing.js backend/tests/superadmin-billing.test.js
git commit -m "feat: add superadmin billing service"
```

### Task 3: Superadmin Billing API Routes

**Files:**
- Create: `backend/routes/superadmin-billing.js`
- Modify: `backend/routes/superadmin.js`
- Test: `backend/tests/superadmin-billing.test.js`

**Interfaces:**
- Consumes: `loadBillingCatalog`, `loadCompanyBilling`, `saveCompanyBilling`, `billingAnalytics`.
- Produces: `GET /api/superadmin/billing/catalog`, `GET /api/superadmin/billing/analytics`, `GET /api/superadmin/companies/:id/billing`, `PATCH /api/superadmin/companies/:id/billing`.

- [ ] **Step 1: Extend tests for API behavior**

Append this route-test scaffold to `backend/tests/superadmin-billing.test.js`:

```js
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearBillingModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.includes(`${path.sep}backend${path.sep}services${path.sep}supabase.js`) ||
      key.includes(`${path.sep}backend${path.sep}middleware${path.sep}auth.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}superadmin.js`) ||
      key.includes(`${path.sep}backend${path.sep}routes${path.sep}superadmin-billing.js`)
    ) {
      delete require.cache[key];
    }
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('superadmin billing API rejects tenant admins and lets superadmin save custom pricing', async () => {
  const previousBackupPath = process.env.NODEROUTE_BACKUP_PATH;
  const previousForceDemoMode = process.env.NODEROUTE_FORCE_DEMO_MODE;
  const previousSuperadminEmail = process.env.SUPERADMIN_EMAIL;
  const backupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'noderoute-superadmin-billing-'));

  process.env.NODEROUTE_BACKUP_PATH = backupPath;
  process.env.NODEROUTE_FORCE_DEMO_MODE = 'true';
  process.env.SUPERADMIN_EMAIL = 'owner@noderoute.test';
  clearBillingModuleCache();

  let server;
  try {
    const { supabase } = require('../services/supabase');
    const superadminRouter = require('../routes/superadmin');
    const jwtSecret = process.env.JWT_SECRET || 'noderoute-dev-secret-change-in-production';

    await supabase.from('companies').insert({ id: '00000000-0000-0000-0000-00000000b111', name: 'Blue Harbor', slug: 'blue-harbor', plan: 'track', status: 'trial' });
    await supabase.from('users').insert({ id: 'sa-001', name: 'Owner', email: 'owner@noderoute.test', role: 'superadmin', status: 'active', company_id: '00000000-0000-0000-0000-00000000b111' });
    await supabase.from('users').insert({ id: 'admin-002', name: 'Tenant Admin', email: 'admin@noderoute.test', role: 'admin', status: 'active', company_id: '00000000-0000-0000-0000-00000000b111' });
    await supabase.from('platform_plan_tiers').insert({ code: 'operations', name: 'Operations', display_order: 30, monthly_price_cents: 149900, setup_price_cents: 350000 });
    await supabase.from('platform_plan_tiers').insert({ code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 });
    await supabase.from('platform_addons').insert({ code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track','operations'], display_order: 10 });

    const app = express();
    app.use(express.json());
    app.use('/api/superadmin', superadminRouter);
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const adminToken = jwt.sign({ userId: 'admin-002' }, jwtSecret, { expiresIn: '1h' });
    const superToken = jwt.sign({ userId: 'sa-001' }, jwtSecret, { expiresIn: '1h' });

    const denied = await fetch(`${baseUrl}/api/superadmin/billing/catalog`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(denied.status, 403);

    const saved = await fetch(`${baseUrl}/api/superadmin/companies/00000000-0000-0000-0000-00000000b111/billing`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${superToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_tier_code: 'operations',
        billing_status: 'active',
        billing_interval: 'monthly',
        custom_pricing_enabled: true,
        custom_monthly_price_cents: 180000,
        custom_setup_price_cents: 400000,
        annual_discount_bps: 0,
        contract_start_date: null,
        contract_end_date: null,
        pricing_notes: 'First customer custom price',
        feature_overrides: [],
        addons: [{ addon_code: 'ai_phone_orders', enabled: true, quantity: 1, monthly_price_cents: 49900, setup_price_cents: null, usage_terms: '$0.20 per connected minute', notes: '' }],
      }),
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.profile.plan_tier_code, 'operations');
    assert.equal(body.profile.custom_monthly_price_cents, 180000);
    assert.equal(body.effectiveMonthlyCents, 229900);
    assert.equal(body.addons.find((addon) => addon.addon_code === 'ai_phone_orders').enabled, true);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (previousBackupPath === undefined) delete process.env.NODEROUTE_BACKUP_PATH;
    else process.env.NODEROUTE_BACKUP_PATH = previousBackupPath;
    if (previousForceDemoMode === undefined) delete process.env.NODEROUTE_FORCE_DEMO_MODE;
    else process.env.NODEROUTE_FORCE_DEMO_MODE = previousForceDemoMode;
    if (previousSuperadminEmail === undefined) delete process.env.SUPERADMIN_EMAIL;
    else process.env.SUPERADMIN_EMAIL = previousSuperadminEmail;
    clearBillingModuleCache();
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test backend/tests/superadmin-billing.test.js
```

Expected: FAIL with route not found or module not found.

- [ ] **Step 3: Create the billing router**

Create `backend/routes/superadmin-billing.js`:

```js
'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');
const {
  billingAnalytics,
  loadBillingCatalog,
  loadCompanyBilling,
  saveCompanyBilling,
} = require('../services/superadmin-billing');

const router = express.Router();

router.get('/catalog', async (_req, res) => {
  try {
    res.json(await loadBillingCatalog(supabase));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load billing catalog' });
  }
});

router.get('/analytics', async (_req, res) => {
  try {
    res.json(await billingAnalytics(supabase));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load billing analytics' });
  }
});

async function getCompanyBilling(req, res) {
  try {
    res.json(await loadCompanyBilling(supabase, req.params.id));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not load company billing' });
  }
}

async function patchCompanyBilling(req, res) {
  try {
    res.json(await saveCompanyBilling(supabase, req.params.id, req.body, req.user));
  } catch (error) {
    const status = error.name === 'ZodError' ? 400 : 500;
    res.status(status).json({ error: error.message || 'Could not save company billing' });
  }
}

module.exports = {
  router,
  getCompanyBilling,
  patchCompanyBilling,
};
```

- [ ] **Step 4: Mount the billing router behind the existing superadmin guard**

Modify `backend/routes/superadmin.js` after `router.use(requireSuperadmin);`:

```js
const superadminBilling = require('./superadmin-billing');
```

Then add:

```js
router.use('/billing', superadminBilling.router);
router.get('/companies/:id/billing', superadminBilling.getCompanyBilling);
router.patch('/companies/:id/billing', superadminBilling.patchCompanyBilling);
```

- [ ] **Step 5: Run backend billing tests**

Run:

```bash
node --test backend/tests/superadmin-billing.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/superadmin-billing.js backend/routes/superadmin.js backend/tests/superadmin-billing.test.js
git commit -m "feat: expose superadmin billing APIs"
```

### Task 4: Plan Limits And Billing Config Integration

**Files:**
- Modify: `backend/services/plan-limits.js`
- Modify: `backend/routes/billing.js`
- Modify: `backend/tests/noderoute-billing.test.js`
- Test: `backend/tests/superadmin-billing.test.js`

**Interfaces:**
- Consumes: `company_billing_profiles`, `platform_plan_limits`, and `platform_plan_tiers`.
- Produces: plan limits that use workbook tier names and billing config responses that show the assigned tier.

- [ ] **Step 1: Add failing assertions**

Append to `backend/tests/superadmin-billing.test.js`:

```js
test('workbook plan limits expose drivers and monthly stops by tier', async () => {
  const { planLimitsFor } = require('../services/plan-limits');
  assert.deepEqual(planLimitsFor({ plan: 'track' }), {
    plan: 'track',
    maxDrivers: 2,
    maxDeliveriesPerMonth: 500,
  });
  assert.deepEqual(planLimitsFor({ plan: 'operations' }), {
    plan: 'operations',
    maxDrivers: 10,
    maxDeliveriesPerMonth: 5000,
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test backend/tests/superadmin-billing.test.js
```

Expected: FAIL because `planLimitsFor` is not exported and old plans are hardcoded.

- [ ] **Step 3: Replace static limits**

Modify `backend/services/plan-limits.js`:

```js
const PLAN_LIMITS = {
  trial: { maxDrivers: 2, maxDeliveriesPerMonth: 500 },
  track: { maxDrivers: 2, maxDeliveriesPerMonth: 500 },
  dispatch: { maxDrivers: 5, maxDeliveriesPerMonth: 2500 },
  operations: { maxDrivers: 10, maxDeliveriesPerMonth: 5000 },
  erp: { maxDrivers: 15, maxDeliveriesPerMonth: 10000 },
  enterprise: { maxDrivers: 25, maxDeliveriesPerMonth: 20000 },
};

const LEGACY_PLAN_ALIASES = {
  free: 'track',
  starter: 'track',
  growth: 'operations',
  pro: 'erp',
};
```

Update `planLimitsFor`:

```js
function planLimitsFor(company) {
  const rawPlan = String(company?.plan || company?.subscription_plan || 'track').toLowerCase();
  const plan = LEGACY_PLAN_ALIASES[rawPlan] || rawPlan;
  return { plan, ...(PLAN_LIMITS[plan] || PLAN_LIMITS.track) };
}
```

Export it:

```js
  planLimitsFor,
```

- [ ] **Step 4: Include catalog plan in billing config**

Modify `backend/routes/billing.js` in `loadBillingCompany` so the selected fields include `plan` and the returned object preserves the new code:

```js
    .select('id,name,plan,status')
```

The current file already does this; keep it and add no Stripe price mutation in this task.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
node --test backend/tests/superadmin-billing.test.js backend/tests/noderoute-billing.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/plan-limits.js backend/routes/billing.js backend/tests/superadmin-billing.test.js backend/tests/noderoute-billing.test.js
git commit -m "feat: align plan limits with pricing tiers"
```

### Task 5: Frontend Billing Hooks And Types

**Files:**
- Create: `frontend-v2/src/pages/superadmin/billing-types.ts`
- Create: `frontend-v2/src/hooks/useSuperadminBilling.ts`
- Test: `frontend-v2/src/pages/SuperadminPage.test.tsx`

**Interfaces:**
- Consumes: backend API payloads from Task 3.
- Produces: `useBillingCatalog`, `useBillingAnalytics`, `useCompanyBilling`, `useSaveCompanyBilling`.

- [ ] **Step 1: Write failing hook import test**

Create `frontend-v2/src/pages/SuperadminPage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import type { BillingCatalogResponse } from './superadmin/billing-types';

describe('Superadmin billing types', () => {
  it('supports workbook tier and add-on codes', () => {
    const catalog: BillingCatalogResponse = {
      tiers: [{ code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 }],
      features: [],
      featureMatrix: [],
      limits: [],
      addons: [{ code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, default_setup_cents: null, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track'], quote_only: false, display_order: 10 }],
    };
    expect(catalog.tiers[0].code).toBe('track');
    expect(catalog.addons[0].code).toBe('ai_phone_orders');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx
```

Expected: FAIL because `billing-types` does not exist.

- [ ] **Step 3: Add frontend billing types**

Create `frontend-v2/src/pages/superadmin/billing-types.ts`:

```ts
export type PlanTierCode = 'track' | 'dispatch' | 'operations' | 'erp' | 'enterprise';
export type BillingStatus = 'trial' | 'active' | 'paused' | 'cancelled';
export type BillingInterval = 'monthly' | 'annual';
export type FeatureInclusion =
  | 'no' | 'yes' | 'basic' | 'full' | 'limited' | 'add_on'
  | 'included_fair_use' | 'discounted_add_on' | 'custom' | 'assisted_migration';

export type PlanTier = {
  code: PlanTierCode;
  name: string;
  display_order: number;
  monthly_price_cents: number;
  setup_price_cents: number;
  best_for?: string;
  included_scope?: string;
  excluded_gated?: string;
  upgrade_trigger?: string;
  sales_note?: string;
};

export type PlanFeature = {
  code: string;
  name: string;
  category: string;
  description: string;
  display_order: number;
};

export type PlanFeatureMatrixRow = {
  tier_code: PlanTierCode;
  feature_code: string;
  inclusion: FeatureInclusion;
  detail?: string;
  pricing_scope_note?: string;
};

export type PlanLimit = {
  tier_code: PlanTierCode;
  metric_code: string;
  metric_label: string;
  metric_value: string;
  numeric_value: number | null;
  unit: string;
  notes: string;
  display_order: number;
};

export type PlanAddon = {
  code: string;
  name: string;
  base_monthly_cents: number | null;
  default_setup_cents: number | null;
  usage_terms: string;
  eligible_tier_codes: PlanTierCode[];
  when_to_sell?: string;
  pricing_rationale?: string;
  quote_only: boolean;
  display_order: number;
};

export type BillingCatalogResponse = {
  tiers: PlanTier[];
  features: PlanFeature[];
  featureMatrix: PlanFeatureMatrixRow[];
  limits: PlanLimit[];
  addons: PlanAddon[];
};

export type CompanyBillingProfile = {
  company_id: string;
  plan_tier_code: PlanTierCode;
  billing_status: BillingStatus;
  billing_interval: BillingInterval;
  custom_pricing_enabled: boolean;
  custom_monthly_price_cents: number | null;
  custom_setup_price_cents: number | null;
  annual_discount_bps: number;
  contract_start_date: string | null;
  contract_end_date: string | null;
  pricing_notes: string;
};

export type CompanyFeatureEntitlement = {
  company_id: string;
  feature_code: string;
  enabled: boolean;
  inclusion: FeatureInclusion;
  source: 'tier' | 'addon' | 'custom';
  notes: string;
  feature?: PlanFeature;
};

export type CompanyAddonEntitlement = {
  company_id: string;
  addon_code: string;
  enabled: boolean;
  quantity: number;
  monthly_price_cents: number | null;
  setup_price_cents: number | null;
  usage_terms: string;
  notes: string;
  addon?: PlanAddon;
};

export type CompanyBillingResponse = {
  company: { id: string; name: string; slug: string | null; status: string; plan: string | null };
  profile: CompanyBillingProfile;
  selectedTier: PlanTier;
  effectiveMonthlyCents: number;
  effectiveSetupCents: number;
  effectiveAnnualContractValueCents: number;
  features: CompanyFeatureEntitlement[];
  addons: CompanyAddonEntitlement[];
  auditEvents: Array<{ id: string; event_type: string; created_at: string; notes: string }>;
};

export type BillingAnalyticsResponse = {
  total_companies: number;
  active_companies: number;
  mrr_cents: number;
  arr_cents: number;
  custom_pricing_companies: number;
  enabled_addons: number;
  tier_breakdown: Array<{ tier: PlanTierCode; count: number; mrr_cents: number }>;
};

export type SaveCompanyBillingPayload = {
  plan_tier_code: PlanTierCode;
  billing_status: BillingStatus;
  billing_interval: BillingInterval;
  custom_pricing_enabled: boolean;
  custom_monthly_price_cents: number | null;
  custom_setup_price_cents: number | null;
  annual_discount_bps: number;
  contract_start_date: string | null;
  contract_end_date: string | null;
  pricing_notes: string;
  feature_overrides: Array<{
    feature_code: string;
    enabled: boolean;
    inclusion: FeatureInclusion;
    notes: string;
  }>;
  addons: Array<{
    addon_code: string;
    enabled: boolean;
    quantity: number;
    monthly_price_cents: number | null;
    setup_price_cents: number | null;
    usage_terms: string;
    notes: string;
  }>;
};
```

- [ ] **Step 4: Add hooks**

Create `frontend-v2/src/hooks/useSuperadminBilling.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth, sendWithAuth } from '../lib/api';
import type {
  BillingAnalyticsResponse,
  BillingCatalogResponse,
  CompanyBillingResponse,
  SaveCompanyBillingPayload,
} from '../pages/superadmin/billing-types';

export const billingCatalogKey = ['superadmin-billing-catalog'] as const;
export const billingAnalyticsKey = ['superadmin-billing-analytics'] as const;
export const companyBillingKey = (companyId: string | null) => ['superadmin-company-billing', companyId] as const;

export function useBillingCatalog() {
  return useQuery({
    queryKey: billingCatalogKey,
    queryFn: () => fetchWithAuth<BillingCatalogResponse>('/api/superadmin/billing/catalog'),
  });
}

export function useBillingAnalytics() {
  return useQuery({
    queryKey: billingAnalyticsKey,
    queryFn: () => fetchWithAuth<BillingAnalyticsResponse>('/api/superadmin/billing/analytics'),
  });
}

export function useCompanyBilling(companyId: string | null) {
  return useQuery({
    queryKey: companyBillingKey(companyId),
    enabled: !!companyId,
    queryFn: () => fetchWithAuth<CompanyBillingResponse>(`/api/superadmin/companies/${companyId}/billing`),
  });
}

export function useSaveCompanyBilling(companyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveCompanyBillingPayload) =>
      sendWithAuth<CompanyBillingResponse>(`/api/superadmin/companies/${companyId}/billing`, 'PATCH', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingAnalyticsKey });
      queryClient.invalidateQueries({ queryKey: companyBillingKey(companyId) });
      queryClient.invalidateQueries({ queryKey: ['superadmin-companies'] });
    },
  });
}
```

- [ ] **Step 5: Run frontend test**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend-v2/src/pages/superadmin/billing-types.ts frontend-v2/src/hooks/useSuperadminBilling.ts frontend-v2/src/pages/SuperadminPage.test.tsx
git commit -m "feat: add superadmin billing frontend hooks"
```

### Task 6: Add-on Checklist And Feature Matrix Components

**Files:**
- Create: `frontend-v2/src/pages/superadmin/AddonChecklist.tsx`
- Create: `frontend-v2/src/pages/superadmin/FeatureMatrixTable.tsx`
- Modify: `frontend-v2/src/pages/SuperadminPage.test.tsx`

**Interfaces:**
- Consumes: `CompanyAddonEntitlement[]`, `BillingCatalogResponse`, and editable feature overrides.
- Produces: reusable list-style checkbox controls required by the spec.

- [ ] **Step 1: Add failing UI tests**

Append to `frontend-v2/src/pages/SuperadminPage.test.tsx`:

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { renderWithQueryClient } from '../test/renderWithQueryClient';
import { AddonChecklist } from './superadmin/AddonChecklist';

describe('AddonChecklist', () => {
  it('renders add-ons as list-style checkboxes and emits checked changes', () => {
    const changes: unknown[] = [];
    renderWithQueryClient(
      <AddonChecklist
        addons={[
          {
            company_id: 'company-1',
            addon_code: 'ai_phone_orders',
            enabled: false,
            quantity: 1,
            monthly_price_cents: 49900,
            setup_price_cents: null,
            usage_terms: '$0.20 per connected minute',
            notes: '',
            addon: {
              code: 'ai_phone_orders',
              name: 'AI Phone Orders',
              base_monthly_cents: 49900,
              default_setup_cents: null,
              usage_terms: '$0.20 per connected minute',
              eligible_tier_codes: ['track'],
              quote_only: false,
              display_order: 10,
            },
          },
        ]}
        onChange={(next) => changes.push(next)}
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: /AI Phone Orders/i });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(changes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx
```

Expected: FAIL because `AddonChecklist` does not exist.

- [ ] **Step 3: Create add-on checklist**

Create `frontend-v2/src/pages/superadmin/AddonChecklist.tsx`:

```tsx
import type { CompanyAddonEntitlement } from './billing-types';
import { Input } from '../../components/ui/input';

function dollars(cents: number | null | undefined) {
  if (cents == null) return 'Quote';
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}/mo`;
}

export function AddonChecklist({
  addons,
  disabled = false,
  onChange,
}: {
  addons: CompanyAddonEntitlement[];
  disabled?: boolean;
  onChange: (addons: CompanyAddonEntitlement[]) => void;
}) {
  function patch(addonCode: string, update: Partial<CompanyAddonEntitlement>) {
    onChange(addons.map((addon) => addon.addon_code === addonCode ? { ...addon, ...update } : addon));
  }

  return (
    <div className="divide-y rounded-md border border-border">
      {addons.map((addon) => {
        const label = addon.addon?.name || addon.addon_code;
        return (
          <label key={addon.addon_code} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center">
            <span className="flex min-w-0 items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-input"
                checked={addon.enabled}
                disabled={disabled}
                aria-label={label}
                onChange={(event) => patch(addon.addon_code, { enabled: event.target.checked })}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">{addon.usage_terms || addon.addon?.usage_terms || dollars(addon.monthly_price_cents)}</span>
              </span>
            </span>
            <Input
              type="number"
              min="0"
              step="1"
              value={addon.quantity}
              disabled={disabled || !addon.enabled}
              aria-label={`${label} quantity`}
              onChange={(event) => patch(addon.addon_code, { quantity: Number(event.target.value || 0) })}
            />
            <Input
              type="number"
              min="0"
              step="1"
              value={addon.monthly_price_cents == null ? '' : Math.round(addon.monthly_price_cents / 100)}
              disabled={disabled || !addon.enabled}
              aria-label={`${label} monthly price`}
              placeholder="Quote"
              onChange={(event) => patch(addon.addon_code, {
                monthly_price_cents: event.target.value === '' ? null : Math.round(Number(event.target.value) * 100),
              })}
            />
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create feature matrix**

Create `frontend-v2/src/pages/superadmin/FeatureMatrixTable.tsx`:

```tsx
import type { BillingCatalogResponse, CompanyFeatureEntitlement, FeatureInclusion } from './billing-types';
import { SelectInput } from '../../components/ui/select-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const LABELS: Record<FeatureInclusion, string> = {
  no: 'No',
  yes: 'Yes',
  basic: 'Basic',
  full: 'Full',
  limited: 'Limited',
  add_on: 'Add-on',
  included_fair_use: 'Included fair use',
  discounted_add_on: 'Discounted add-on',
  custom: 'Custom',
  assisted_migration: 'Assisted migration',
};

const EDITABLE_VALUES: FeatureInclusion[] = ['no', 'yes', 'basic', 'full', 'limited', 'add_on', 'included_fair_use', 'discounted_add_on', 'custom', 'assisted_migration'];

export function FeatureMatrixTable({
  catalog,
  editableFeatures,
  onChange,
}: {
  catalog: BillingCatalogResponse;
  editableFeatures?: CompanyFeatureEntitlement[];
  onChange?: (features: CompanyFeatureEntitlement[]) => void;
}) {
  const editable = Array.isArray(editableFeatures) && onChange;

  function patch(featureCode: string, inclusion: FeatureInclusion) {
    if (!editableFeatures || !onChange) return;
    onChange(editableFeatures.map((feature) => feature.feature_code === featureCode
      ? { ...feature, inclusion, enabled: inclusion !== 'no' }
      : feature));
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Feature</TableHead>
            {editable ? <TableHead>Client Setting</TableHead> : catalog.tiers.map((tier) => <TableHead key={tier.code}>{tier.name}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {catalog.features.map((feature) => {
            const current = editableFeatures?.find((row) => row.feature_code === feature.code);
            return (
              <TableRow key={feature.code}>
                <TableCell>
                  <div className="font-medium">{feature.name}</div>
                  <div className="text-xs text-muted-foreground">{feature.category}</div>
                </TableCell>
                {editable ? (
                  <TableCell>
                    <SelectInput
                      value={current?.inclusion || 'no'}
                      aria-label={`${feature.name} entitlement`}
                      onChange={(event) => patch(feature.code, event.target.value as FeatureInclusion)}
                    >
                      {EDITABLE_VALUES.map((value) => <option key={value} value={value}>{LABELS[value]}</option>)}
                    </SelectInput>
                  </TableCell>
                ) : catalog.tiers.map((tier) => {
                  const matrix = catalog.featureMatrix.find((row) => row.tier_code === tier.code && row.feature_code === feature.code);
                  return <TableCell key={tier.code}>{LABELS[(matrix?.inclusion || 'no') as FeatureInclusion]}</TableCell>;
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 5: Run frontend test**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend-v2/src/pages/superadmin/AddonChecklist.tsx frontend-v2/src/pages/superadmin/FeatureMatrixTable.tsx frontend-v2/src/pages/SuperadminPage.test.tsx
git commit -m "feat: add billing feature and addon controls"
```

### Task 7: Client Billing Drawer

**Files:**
- Create: `frontend-v2/src/pages/superadmin/ClientBillingDrawer.tsx`
- Modify: `frontend-v2/src/pages/SuperadminPage.test.tsx`

**Interfaces:**
- Consumes: `useCompanyBilling`, `useSaveCompanyBilling`, `AddonChecklist`, `FeatureMatrixTable`.
- Produces: `ClientBillingDrawer` for both `/superadmin` and `/companies`.

- [ ] **Step 1: Add drawer behavior test**

Append to `frontend-v2/src/pages/SuperadminPage.test.tsx`:

```tsx
import { ClientBillingDrawer } from './superadmin/ClientBillingDrawer';

const { useCompanyBillingMock, useSaveCompanyBillingMock } = vi.hoisted(() => ({
  useCompanyBillingMock: vi.fn(),
  useSaveCompanyBillingMock: vi.fn(),
}));

vi.mock('../hooks/useSuperadminBilling', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../hooks/useSuperadminBilling');
  return {
    ...actual,
    useCompanyBilling: useCompanyBillingMock,
    useSaveCompanyBilling: useSaveCompanyBillingMock,
  };
});

describe('ClientBillingDrawer', () => {
  it('lets superadmin set tier, custom pricing, and add-on checkboxes', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useSaveCompanyBillingMock.mockReturnValue({ mutateAsync, isPending: false });
    useCompanyBillingMock.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        company: { id: 'company-1', name: 'Blue Harbor', slug: 'blue-harbor', status: 'trial', plan: 'track' },
        profile: {
          company_id: 'company-1',
          plan_tier_code: 'track',
          billing_status: 'trial',
          billing_interval: 'monthly',
          custom_pricing_enabled: false,
          custom_monthly_price_cents: null,
          custom_setup_price_cents: null,
          annual_discount_bps: 0,
          contract_start_date: null,
          contract_end_date: null,
          pricing_notes: '',
        },
        selectedTier: { code: 'track', name: 'Track', display_order: 10, monthly_price_cents: 29900, setup_price_cents: 75000 },
        effectiveMonthlyCents: 29900,
        effectiveSetupCents: 75000,
        effectiveAnnualContractValueCents: 433800,
        features: [],
        addons: [{
          company_id: 'company-1',
          addon_code: 'ai_phone_orders',
          enabled: false,
          quantity: 1,
          monthly_price_cents: 49900,
          setup_price_cents: null,
          usage_terms: '$0.20 per connected minute',
          notes: '',
          addon: { code: 'ai_phone_orders', name: 'AI Phone Orders', base_monthly_cents: 49900, default_setup_cents: null, usage_terms: '$0.20 per connected minute', eligible_tier_codes: ['track'], quote_only: false, display_order: 10 },
        }],
        auditEvents: [],
      },
    });

    renderWithQueryClient(<ClientBillingDrawer companyId="company-1" open onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Plan tier'), { target: { value: 'operations' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Custom pricing' }));
    fireEvent.change(screen.getByLabelText('Custom monthly price'), { target: { value: '1800' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /AI Phone Orders/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Billing' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx
```

Expected: FAIL because `ClientBillingDrawer` does not exist.

- [ ] **Step 3: Create the drawer**

Create `frontend-v2/src/pages/superadmin/ClientBillingDrawer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SelectInput } from '../../components/ui/select-input';
import { SlideOver } from '../../components/ui/overlay-panel';
import { useToast } from '../../components/ui/toast';
import { useCompanyBilling, useSaveCompanyBilling } from '../../hooks/useSuperadminBilling';
import { AddonChecklist } from './AddonChecklist';
import { FeatureMatrixTable } from './FeatureMatrixTable';
import type { CompanyAddonEntitlement, CompanyFeatureEntitlement, PlanTierCode } from './billing-types';

function centsToDollars(cents: number | null | undefined) {
  if (cents == null) return '';
  return String(Math.round(cents / 100));
}

function dollarsToCents(value: string) {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function ClientBillingDrawer({
  companyId,
  open,
  onClose,
  onSaved,
}: {
  companyId: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { data, isLoading, error } = useCompanyBilling(open ? companyId : null);
  const save = useSaveCompanyBilling(companyId);
  const [tier, setTier] = useState<PlanTierCode>('track');
  const [status, setStatus] = useState<'trial' | 'active' | 'paused' | 'cancelled'>('trial');
  const [customPricing, setCustomPricing] = useState(false);
  const [monthly, setMonthly] = useState('');
  const [setup, setSetup] = useState('');
  const [notes, setNotes] = useState('');
  const [features, setFeatures] = useState<CompanyFeatureEntitlement[]>([]);
  const [addons, setAddons] = useState<CompanyAddonEntitlement[]>([]);

  useEffect(() => {
    if (!data) return;
    setTier(data.profile.plan_tier_code);
    setStatus(data.profile.billing_status);
    setCustomPricing(data.profile.custom_pricing_enabled);
    setMonthly(centsToDollars(data.profile.custom_monthly_price_cents));
    setSetup(centsToDollars(data.profile.custom_setup_price_cents));
    setNotes(data.profile.pricing_notes || '');
    setFeatures(data.features);
    setAddons(data.addons);
  }, [data]);

  async function handleSave() {
    if (!data) return;
    try {
      await save.mutateAsync({
        plan_tier_code: tier,
        billing_status: status,
        billing_interval: data.profile.billing_interval,
        custom_pricing_enabled: customPricing,
        custom_monthly_price_cents: customPricing ? dollarsToCents(monthly) : null,
        custom_setup_price_cents: customPricing ? dollarsToCents(setup) : null,
        annual_discount_bps: data.profile.annual_discount_bps || 0,
        contract_start_date: data.profile.contract_start_date,
        contract_end_date: data.profile.contract_end_date,
        pricing_notes: notes,
        feature_overrides: features.map((feature) => ({
          feature_code: feature.feature_code,
          enabled: feature.enabled,
          inclusion: feature.inclusion,
          notes: feature.notes || '',
        })),
        addons: addons.map((addon) => ({
          addon_code: addon.addon_code,
          enabled: addon.enabled,
          quantity: addon.quantity,
          monthly_price_cents: addon.monthly_price_cents,
          setup_price_cents: addon.setup_price_cents,
          usage_terms: addon.usage_terms || '',
          notes: addon.notes || '',
        })),
      });
      toast.success('Billing settings saved.');
      onSaved();
    } catch (err) {
      toast.error(String((err as Error).message || 'Could not save billing settings.'));
    }
  }

  return (
    <SlideOver
      open={open}
      title={data?.company.name || 'Client Billing'}
      description="Superadmin-only plan, pricing, feature, and add-on controls"
      onClose={onClose}
      widthClassName="max-w-5xl"
      actions={<Button disabled={!data || save.isPending} onClick={handleSave}>{save.isPending ? 'Saving...' : 'Save Billing'}</Button>}
    >
      {isLoading ? <div className="text-sm text-muted-foreground">Loading billing profile...</div> : null}
      {error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{String((error as Error).message)}</div> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Plan tier</span>
              <SelectInput aria-label="Plan tier" value={tier} onChange={(event) => setTier(event.target.value as PlanTierCode)}>
                {data.catalog.tiers.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}
              </SelectInput>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Billing status</span>
              <SelectInput value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="trial">Trial</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="cancelled">Cancelled</option>
              </SelectInput>
            </label>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Monthly total</div>
              <div className="text-lg font-semibold">{money(data.effectiveMonthlyCents)}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Setup total</div>
              <div className="text-lg font-semibold">{money(data.effectiveSetupCents)}</div>
            </div>
          </div>

          <div className="rounded-md border border-border p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 rounded border-input" checked={customPricing} aria-label="Custom pricing" onChange={(event) => setCustomPricing(event.target.checked)} />
              Custom pricing
            </label>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Input aria-label="Custom monthly price" type="number" min="0" placeholder="Monthly dollars" value={monthly} disabled={!customPricing} onChange={(event) => setMonthly(event.target.value)} />
              <Input aria-label="Custom setup price" type="number" min="0" placeholder="Setup dollars" value={setup} disabled={!customPricing} onChange={(event) => setSetup(event.target.value)} />
              <Input aria-label="Pricing notes" placeholder="Pricing notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Add-ons</h3>
            <AddonChecklist addons={addons} onChange={setAddons} disabled={save.isPending} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Feature entitlements</h3>
            <FeatureMatrixTable catalog={data.catalog} editableFeatures={features} onChange={setFeatures} />
          </section>
        </div>
      ) : null}
    </SlideOver>
  );
}
```

- [ ] **Step 4: Run frontend test**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/pages/superadmin/ClientBillingDrawer.tsx frontend-v2/src/pages/SuperadminPage.test.tsx
git commit -m "feat: add client billing drawer"
```

### Task 8: Superadmin Dashboard Billing Panel

**Files:**
- Create: `frontend-v2/src/pages/superadmin/BillingDashboardPanel.tsx`
- Modify: `frontend-v2/src/pages/SuperadminPage.tsx`
- Modify: `frontend-v2/src/pages/SuperadminPage.test.tsx`

**Interfaces:**
- Consumes: `useBillingCatalog`, `useBillingAnalytics`, `FeatureMatrixTable`.
- Produces: catalog-backed overview replacing old hardcoded tier assumptions.

- [ ] **Step 1: Add failing dashboard test**

Append this test to `frontend-v2/src/pages/SuperadminPage.test.tsx`:

```tsx
import { BillingDashboardPanel } from './superadmin/BillingDashboardPanel';

const { useBillingCatalogMock, useBillingAnalyticsMock } = vi.hoisted(() => ({
  useBillingCatalogMock: vi.fn(),
  useBillingAnalyticsMock: vi.fn(),
}));

vi.mock('../hooks/useSuperadminBilling', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../hooks/useSuperadminBilling');
  return {
    ...actual,
    useBillingCatalog: useBillingCatalogMock,
    useBillingAnalytics: useBillingAnalyticsMock,
    useCompanyBilling: useCompanyBillingMock,
    useSaveCompanyBilling: useSaveCompanyBillingMock,
  };
});

describe('BillingDashboardPanel', () => {
  it('renders workbook-backed tier names and MRR', () => {
    useBillingCatalogMock.mockReturnValue({
      isLoading: false,
      data: {
        tiers: [{ code: 'operations', name: 'Operations', display_order: 30, monthly_price_cents: 149900, setup_price_cents: 350000 }],
        features: [],
        featureMatrix: [],
        limits: [],
        addons: [],
      },
    });
    useBillingAnalyticsMock.mockReturnValue({
      isLoading: false,
      data: { total_companies: 1, active_companies: 1, mrr_cents: 149900, arr_cents: 1798800, custom_pricing_companies: 0, enabled_addons: 0, tier_breakdown: [{ tier: 'operations', count: 1, mrr_cents: 149900 }] },
    });

    renderWithQueryClient(<BillingDashboardPanel />);
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('$1,499')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx
```

Expected: FAIL because `BillingDashboardPanel` does not exist.

- [ ] **Step 3: Create the billing dashboard panel**

Create `frontend-v2/src/pages/superadmin/BillingDashboardPanel.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { StatCard } from '../../components/ui/stat-card';
import { useBillingAnalytics, useBillingCatalog } from '../../hooks/useSuperadminBilling';
import { FeatureMatrixTable } from './FeatureMatrixTable';

function money(cents: number | null | undefined) {
  const value = Number(cents || 0) / 100;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function BillingDashboardPanel() {
  const catalog = useBillingCatalog();
  const analytics = useBillingAnalytics();
  const loading = catalog.isLoading || analytics.isLoading;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Billing MRR" value={loading ? '-' : money(analytics.data?.mrr_cents)} valueClassName="text-emerald-600" />
        <StatCard label="Billing ARR" value={loading ? '-' : money(analytics.data?.arr_cents)} valueClassName="text-sky-600" />
        <StatCard label="Custom Pricing" value={loading ? '-' : String(analytics.data?.custom_pricing_companies || 0)} valueClassName="" />
        <StatCard label="Enabled Add-ons" value={loading ? '-' : String(analytics.data?.enabled_addons || 0)} valueClassName="" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Tier Revenue</CardTitle>
            <CardDescription>Active MRR by workbook-backed tier.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(catalog.data?.tiers || []).map((tier) => {
              const row = analytics.data?.tier_breakdown.find((item) => item.tier === tier.code);
              return (
                <div key={tier.code} className="grid grid-cols-[7rem_1fr_5rem] items-center gap-3 text-sm">
                  <span className="font-medium">{tier.name}</span>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (row?.count || 0) * 12)}%` }} />
                  </div>
                  <span className="text-right text-muted-foreground">{money(row?.mrr_cents)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Feature Matrix</CardTitle>
            <CardDescription>Default package structure from the pricing workbook.</CardDescription>
          </CardHeader>
          <CardContent>
            {catalog.data ? <FeatureMatrixTable catalog={catalog.data} /> : <div className="text-sm text-muted-foreground">Loading feature matrix...</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Embed the panel in the Superadmin page**

Modify `frontend-v2/src/pages/SuperadminPage.tsx`:

```tsx
import { BillingDashboardPanel } from './superadmin/BillingDashboardPanel';
```

Add the panel below the KPI bar and above the current tier breakdown card:

```tsx
      <BillingDashboardPanel />
```

Replace the old `TIER_PRICE` and `tierColors` hardcoded tier list only after the new panel is stable. The old fallback can remain during this task, but the new panel must be the source of truth visible on `/superadmin`.

- [ ] **Step 5: Run frontend test**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend-v2/src/pages/superadmin/BillingDashboardPanel.tsx frontend-v2/src/pages/SuperadminPage.tsx frontend-v2/src/pages/SuperadminPage.test.tsx
git commit -m "feat: add superadmin billing dashboard panel"
```

### Task 9: Companies Page Billing Action

**Files:**
- Modify: `frontend-v2/src/pages/CompaniesPage.tsx`
- Create: `frontend-v2/src/pages/CompaniesPage.billing.test.tsx`

**Interfaces:**
- Consumes: `ClientBillingDrawer`.
- Produces: a per-tenant "Billing" action on the existing superadmin company list.

- [ ] **Step 1: Write failing page test**

Create `frontend-v2/src/pages/CompaniesPage.billing.test.tsx`:

```tsx
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompaniesPage } from './CompaniesPage';
import { renderWithQueryClient } from '../test/renderWithQueryClient';

const { fetchWithAuthMock, sendWithAuthMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  sendWithAuthMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
  sendWithAuth: sendWithAuthMock,
}));

vi.mock('./superadmin/ClientBillingDrawer', () => ({
  ClientBillingDrawer: ({ open, companyId }: { open: boolean; companyId: string | null }) =>
    open ? <div role="dialog">Billing drawer {companyId}</div> : null,
}));

describe('CompaniesPage billing action', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    sendWithAuthMock.mockReset();
    fetchWithAuthMock.mockImplementation(async (url: string) => {
      if (url === '/api/superadmin/companies') {
        return [{ id: 'company-1', name: 'Blue Harbor', plan: 'track', status: 'trial', admin_email: 'admin@test.com', user_count: 2 }];
      }
      if (url === '/api/superadmin/analytics/verticals') return null;
      return null;
    });
  });

  it('opens billing drawer for a tenant company', async () => {
    renderWithQueryClient(<CompaniesPage />);
    expect(await screen.findByText('Blue Harbor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('company-1');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm --prefix frontend-v2 run test -- CompaniesPage.billing.test.tsx
```

Expected: FAIL because there is no Billing button.

- [ ] **Step 3: Add drawer state and action**

Modify `frontend-v2/src/pages/CompaniesPage.tsx` imports:

```tsx
import { ClientBillingDrawer } from './superadmin/ClientBillingDrawer';
```

Add state near `configDrawer`:

```tsx
  const [billingCompanyId, setBillingCompanyId] = useState<string | null>(null);
```

Add this button in the company row actions:

```tsx
                        <Button size="sm" variant="ghost" onClick={() => setBillingCompanyId(company.id)}>
                          Billing
                        </Button>
```

Add the drawer near the existing config drawer:

```tsx
      <ClientBillingDrawer
        companyId={billingCompanyId}
        open={!!billingCompanyId}
        onClose={() => setBillingCompanyId(null)}
        onSaved={() => { setBillingCompanyId(null); load(); }}
      />
```

- [ ] **Step 4: Run page test**

Run:

```bash
npm --prefix frontend-v2 run test -- CompaniesPage.billing.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend-v2/src/pages/CompaniesPage.tsx frontend-v2/src/pages/CompaniesPage.billing.test.tsx
git commit -m "feat: add tenant billing action to companies page"
```

### Task 10: Billing Audit And Analytics Coverage

**Files:**
- Modify: `backend/tests/superadmin-billing.test.js`
- Modify: `frontend-v2/src/pages/superadmin/ClientBillingDrawer.tsx`
- Modify: `frontend-v2/src/pages/superadmin/BillingDashboardPanel.tsx`

**Interfaces:**
- Consumes: `platform_pricing_audit_events`.
- Produces: visible recent pricing-change history in the billing drawer and analytics panel counts.

- [ ] **Step 1: Add audit assertion**

Append to the API test in `backend/tests/superadmin-billing.test.js` after the save response assertion:

```js
    const audit = await supabase.from('platform_pricing_audit_events').select('*').eq('company_id', '00000000-0000-0000-0000-00000000b111');
    assert.equal(audit.error, null);
    assert.equal(audit.data.length, 1);
    assert.equal(audit.data[0].performed_by, 'sa-001');
```

- [ ] **Step 2: Run backend test**

Run:

```bash
node --test backend/tests/superadmin-billing.test.js
```

Expected: PASS.

- [ ] **Step 3: Render recent audit events in the drawer**

Add this section to `ClientBillingDrawer.tsx` below the feature matrix section:

```tsx
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Pricing history</h3>
            <div className="divide-y rounded-md border border-border">
              {data.auditEvents.length ? data.auditEvents.map((event) => (
                <div key={event.id} className="grid gap-1 p-3 text-sm md:grid-cols-[11rem_1fr]">
                  <span className="font-medium">{event.event_type.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground">{new Date(event.created_at).toLocaleString()} {event.notes ? `- ${event.notes}` : ''}</span>
                </div>
              )) : <div className="p-3 text-sm text-muted-foreground">No pricing changes recorded yet.</div>}
            </div>
          </section>
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx CompaniesPage.billing.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/superadmin-billing.test.js frontend-v2/src/pages/superadmin/ClientBillingDrawer.tsx frontend-v2/src/pages/superadmin/BillingDashboardPanel.tsx
git commit -m "feat: show billing audit history"
```

### Task 11: Stripe And Manual Billing Handoff

**Files:**
- Modify: `backend/routes/billing.js`
- Modify: `backend/tests/noderoute-billing.test.js`
- Modify: `frontend-v2/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `company_billing_profiles` assigned by superadmin.
- Produces: billing config that clearly shows the superadmin-assigned plan and custom monthly/setup values without creating dynamic Stripe prices in this branch.

- [ ] **Step 1: Add test marker**

Modify `backend/tests/noderoute-billing.test.js` to include these markers in the frontend/backend billing assertions:

```js
    'custom_pricing_enabled',
    'effective_monthly_cents',
    'effective_setup_cents',
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test backend/tests/noderoute-billing.test.js
```

Expected: FAIL because billing config does not include effective custom pricing.

- [ ] **Step 3: Add effective pricing to billing config**

Modify `backend/routes/billing.js`:

```js
const { loadCompanyBilling } = require('../services/superadmin-billing');
```

Update `billingConfigPayload` to accept an optional `billingProfile`:

```js
function billingConfigPayload(req, company, billingProfile = null) {
```

Add fields inside the returned object:

```js
    billing_profile: billingProfile?.profile || null,
    effective_monthly_cents: billingProfile?.effectiveMonthlyCents ?? null,
    effective_setup_cents: billingProfile?.effectiveSetupCents ?? null,
    custom_pricing_enabled: billingProfile?.profile?.custom_pricing_enabled === true,
```

Update the `/config` handler:

```js
    const billingProfile = company?.id ? await loadCompanyBilling(supabase, company.id).catch(() => null) : null;
    return res.json(billingConfigPayload(req, company, billingProfile));
```

- [ ] **Step 4: Update Settings billing copy to display assigned plan**

In `frontend-v2/src/hooks/useSettings.ts`, extend `BillingConfig`:

```ts
  effective_monthly_cents?: number | null;
  effective_setup_cents?: number | null;
  custom_pricing_enabled?: boolean;
```

In `frontend-v2/src/pages/SettingsPage.tsx`, display those fields inside `BillingPanel` near the readonly plan:

```tsx
          {billing.effective_monthly_cents != null ? (
            <ReadonlyField label="Assigned Monthly" value={`$${Math.round(billing.effective_monthly_cents / 100).toLocaleString()}`} />
          ) : null}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test backend/tests/noderoute-billing.test.js
npm --prefix frontend-v2 run test -- SettingsPage
```

Expected: backend test passes. If there is no `SettingsPage` test target, run `npm --prefix frontend-v2 run lint` in the final verification task.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/billing.js backend/tests/noderoute-billing.test.js frontend-v2/src/hooks/useSettings.ts frontend-v2/src/pages/SettingsPage.tsx
git commit -m "feat: expose assigned billing profile in settings"
```

### Task 12: Final Verification And Rollout Notes

**Files:**
- Modify: `docs/erp-feature-matrix.md`
- No production code changes unless verification exposes a defect.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified implementation and handoff notes.

- [ ] **Step 1: Run backend targeted tests**

Run:

```bash
node --test backend/tests/superadmin-billing.test.js backend/tests/noderoute-billing.test.js backend/tests/company-config-context.test.js
```

Expected: PASS.

- [ ] **Step 2: Run frontend targeted tests**

Run:

```bash
npm --prefix frontend-v2 run test -- SuperadminPage.test.tsx CompaniesPage.billing.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm --prefix frontend-v2 run lint
```

Expected: PASS with zero new warnings.

- [ ] **Step 4: Run broader backend tests if time allows**

Run:

```bash
npm run test --workspace=backend
```

Expected: PASS.

- [ ] **Step 5: Append rollout notes**

Append to `docs/erp-feature-matrix.md`:

```markdown
## Superadmin Billing Rollout

- Migration: `20260704000000_superadmin_billing_catalog.sql`
- Superadmin routes: `/api/superadmin/billing/catalog`, `/api/superadmin/billing/analytics`, `/api/superadmin/companies/:id/billing`
- Primary UI: `/superadmin` billing dashboard and `/companies` Billing action
- Manual billing handoff: use assigned monthly/setup totals from the company billing drawer until dynamic Stripe price creation is explicitly implemented
- Safety: custom pricing writes are behind `requireSuperadmin`; all writes create `platform_pricing_audit_events`
```

- [ ] **Step 6: Check git status**

Run:

```bash
git status -sb
```

Expected: only intended task files are modified; generated reports and `.DS_Store` are not staged.

- [ ] **Step 7: Commit**

```bash
git add docs/erp-feature-matrix.md
git commit -m "docs: add superadmin billing rollout notes"
```

## Supabase Notes Used For This Plan

- Supabase RLS guidance requires RLS on tables in exposed schemas such as `public`, and notes that raw SQL-created tables need explicit RLS and grants.
- Supabase API security guidance separates `GRANT` access from RLS row filtering; the plan keeps new billing tables backend-only through Express and service-role access by default.
- Supabase changelog entry from April 28, 2026 says new public tables may no longer be exposed to the Data/GraphQL API automatically, so this plan does not rely on direct browser Supabase table access.

## Self-Review

**Spec coverage:** The plan covers tier breakdowns, feature matrix defaults, per-client tenant billing profile changes, custom pricing restricted to superadmin routes, and add-on checkboxes in a list-style component.

**Placeholder scan:** The plan contains no `TBD`, `TODO`, "fill in details", or "similar to" instructions. Optional execution-time gates are stated as optional because the local `supabase` binary was not available during planning.

**Type consistency:** Backend payload fields use snake_case, frontend API types match those names, and component props use the same `CompanyBillingResponse`, `CompanyAddonEntitlement`, and `CompanyFeatureEntitlement` shapes across tasks.
