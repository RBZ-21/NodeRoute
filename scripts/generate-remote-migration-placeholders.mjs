#!/usr/bin/env node
/**
 * Generate no-op placeholder migrations for remote-applied versions missing locally.
 * Safe to re-run: skips files that already exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', 'supabase', 'migrations');

/** Remote-only versions from live schema_migrations (project lmdnwtbtmhpbxhvzmkkg). */
const REMOTE_ONLY = [
  ['20260418211909', 'create_customers_table'],
  ['20260430103648', 'add_phone_to_users'],
  ['20260430222625', 'add_vehicle_id_to_users'],
  ['20260501022421', 'add_catch_weight_to_order_items'],
  ['20260505111636', 'add_missing_columns'],
  ['20260505203104', 'add_is_active_to_seafood_inventory'],
  ['20260506091528', 'add_rls_policies_companies_locations_lot_codes_integrations_restaurants'],
  ['20260506093010', 'fix3_warehouse_locations'],
  ['20260506093236', 'fix4_auth_rls_initplan'],
  ['20260506093410', 'fix5_unindexed_foreign_keys'],
  ['20260506093438', 'fix6_multiple_permissive_policies'],
  ['20260506093453', 'fix7_no_policy_tables'],
  ['20260506115043', 'fix_schema_alignment_safe'],
  ['20260506115313', 'add_lot_numbers_to_invoices'],
  ['20260506122624', 'fix_rls_performance_and_duplicate_indexes'],
  ['20260506122838', 'merge_permissive_policies_or_logic'],
  ['20260506180442', 'add_status_dispatched_at_to_routes'],
  ['20260506192402', 'fix_rls_perf_portal_payment_tables'],
  ['20260506193054', 'fix_rls_auth_initplan_payment_tables'],
  ['20260511152506', 'add_lot_codes_source_po_number'],
  ['20260511152651', 'purchasing_receiving_schema_sync'],
  ['20260511152805', 'purchasing_schema_advisor_followups'],
  ['20260512164918', 'create_sms_blast_log'],
  ['20260512165445', 'enable_rls_tenant_tables'],
  ['20260513001134', 'add_company_id_to_dwell_and_portal_tables'],
  ['20260513105647', 'add_created_at_to_driver_locations'],
  ['20260518151956', 'sync_route_stops_atomic'],
  ['20260519010420', 'consolidate_inventory_tables'],
  ['20260519010621', 'po_inventory_synced_at'],
  ['20260519010634', 'inventory_location_assignments'],
  ['20260529230450', 'add_missing_columns_to_companies'],
  ['20260530002036', 'add_phone_order_columns'],
  ['20260615184717', 'reorder_barcode_vendor_bills'],
  ['20260615184732', 'po_receipts_carrier_name'],
  ['20260615184822', 'catch_weight_management'],
  ['20260615184857', 'credit_hold_system'],
  ['20260615184917', 'product_cost_fields'],
  ['20260615184932', 'stops_proximity_notified_at'],
  ['20260615184946', 'stripe_payment_intent_reconciliation'],
  ['20260615185022', 'enable_rls_all_public_tables'],
  ['20260615185046', 'security_auth_refresh_sessions'],
  ['20260615185124', 'query_performance_indexes'],
  ['20260615185151', 'customer_default_route'],
  ['20260615185213', 'ai_insights'],
  ['20260615185225', 'portal_ordering_addon'],
  ['20260615185246', 'recurring_orders'],
  ['20260615185311', 'sms_notifications_outbound_messages'],
  ['20260615185546', 'post_migration_advisor_hardening'],
  ['20260615185623', 'sync_route_stop_search_path'],
  ['20260616190616', 'password_reset_tokens'],
  ['20260621000312', 'products_inventory_report_fields'],
];

function placeholderSql(version, name) {
  return `-- Placeholder migration: already applied on remote as version ${version}.
-- Remote migration name: ${name}
-- This file aligns local Supabase CLI history with supabase_migrations.schema_migrations.
-- Intentionally no-op: schema changes were applied on the remote database outside this filename.
SELECT 1;
`;
}

fs.mkdirSync(migrationsDir, { recursive: true });

let created = 0;
let skipped = 0;

for (const [version, name] of REMOTE_ONLY) {
  const filename = `${version}_${name}.sql`;
  const filepath = path.join(migrationsDir, filename);
  if (fs.existsSync(filepath)) {
    skipped += 1;
    continue;
  }
  fs.writeFileSync(filepath, placeholderSql(version, name), 'utf8');
  created += 1;
}

console.log(`Placeholder migrations: created=${created}, skipped=${skipped}`);
