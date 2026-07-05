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

drop policy if exists "platform_plan_tiers: deny direct client access" on public.platform_plan_tiers;
create policy "platform_plan_tiers: deny direct client access" on public.platform_plan_tiers
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "platform_plan_features: deny direct client access" on public.platform_plan_features;
create policy "platform_plan_features: deny direct client access" on public.platform_plan_features
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "platform_plan_feature_matrix: deny direct client access" on public.platform_plan_feature_matrix;
create policy "platform_plan_feature_matrix: deny direct client access" on public.platform_plan_feature_matrix
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "platform_plan_limits: deny direct client access" on public.platform_plan_limits;
create policy "platform_plan_limits: deny direct client access" on public.platform_plan_limits
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "platform_addons: deny direct client access" on public.platform_addons;
create policy "platform_addons: deny direct client access" on public.platform_addons
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "company_billing_profiles: deny direct client access" on public.company_billing_profiles;
create policy "company_billing_profiles: deny direct client access" on public.company_billing_profiles
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "company_feature_entitlements: deny direct client access" on public.company_feature_entitlements;
create policy "company_feature_entitlements: deny direct client access" on public.company_feature_entitlements
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "company_addon_entitlements: deny direct client access" on public.company_addon_entitlements;
create policy "company_addon_entitlements: deny direct client access" on public.company_addon_entitlements
  for all to anon, authenticated using (false) with check (false);

drop policy if exists "platform_pricing_audit_events: deny direct client access" on public.platform_pricing_audit_events;
create policy "platform_pricing_audit_events: deny direct client access" on public.platform_pricing_audit_events
  for all to anon, authenticated using (false) with check (false);

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

insert into public.company_billing_profiles (company_id, plan_tier_code, billing_status, pricing_notes)
select
  company_id,
  mapped_plan_tier_code,
  mapped_billing_status,
  case
    when normalized_plan in ('track', 'dispatch', 'operations', 'erp', 'enterprise') then ''
    else 'Legacy plan migration backfill from "'
      || coalesce(nullif(plan, ''), '(blank)')
      || '" to "'
      || mapped_plan_tier_code
      || '". Flagged for superadmin review.'
  end
from (
  select
    id as company_id,
    plan,
    lower(btrim(coalesce(plan, ''))) as normalized_plan,
    case
      when lower(btrim(coalesce(plan, ''))) in ('track', 'dispatch', 'operations', 'erp', 'enterprise') then lower(btrim(coalesce(plan, '')))
      when lower(btrim(coalesce(plan, ''))) in ('free', 'trial', 'starter') then 'track'
      when lower(btrim(coalesce(plan, ''))) in ('growth', 'pro') then 'enterprise'
      else 'track'
    end as mapped_plan_tier_code,
    case
      when lower(coalesce(status, '')) = 'active' then 'active'
      when lower(coalesce(status, '')) = 'trial' then 'trial'
      when lower(coalesce(status, '')) = 'suspended' then 'paused'
      else 'trial'
    end as mapped_billing_status
  from public.companies
) company_backfill
on conflict (company_id) do nothing;
