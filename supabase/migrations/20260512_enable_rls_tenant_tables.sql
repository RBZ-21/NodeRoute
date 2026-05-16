-- ── Enable RLS and add tenant-isolation policies on all company-scoped tables ──
-- users.id is type TEXT, so we cast auth.uid()::text for the lookup.
-- The backend uses the service-role key and bypasses RLS entirely.

-- ── users ──────────────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── locations ─────────────────────────────────────────────────────────────────
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS locations_tenant_isolation ON locations;
CREATE POLICY locations_tenant_isolation ON locations
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── orders ────────────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_tenant_isolation ON orders;
CREATE POLICY orders_tenant_isolation ON orders
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── invoices ──────────────────────────────────────────────────────────────────
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant_isolation ON invoices;
CREATE POLICY invoices_tenant_isolation ON invoices
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── stops ─────────────────────────────────────────────────────────────────────
ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stops_tenant_isolation ON stops;
CREATE POLICY stops_tenant_isolation ON stops
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── routes ────────────────────────────────────────────────────────────────────
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS routes_tenant_isolation ON routes;
CREATE POLICY routes_tenant_isolation ON routes
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── seafood_inventory (legacy product table) ──────────────────────────────────
ALTER TABLE seafood_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS seafood_inventory_tenant_isolation ON seafood_inventory;
CREATE POLICY seafood_inventory_tenant_isolation ON seafood_inventory
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── inventory_lots ────────────────────────────────────────────────────────────
ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_lots_tenant_isolation ON inventory_lots;
CREATE POLICY inventory_lots_tenant_isolation ON inventory_lots
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── inventory_stock_history ───────────────────────────────────────────────────
ALTER TABLE inventory_stock_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_stock_history_tenant_isolation ON inventory_stock_history;
CREATE POLICY inventory_stock_history_tenant_isolation ON inventory_stock_history
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── inventory_yield_log ───────────────────────────────────────────────────────
ALTER TABLE inventory_yield_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_yield_log_tenant_isolation ON inventory_yield_log;
CREATE POLICY inventory_yield_log_tenant_isolation ON inventory_yield_log
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── purchase_orders ───────────────────────────────────────────────────────────
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_orders_tenant_isolation ON purchase_orders;
CREATE POLICY purchase_orders_tenant_isolation ON purchase_orders
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── vendors ───────────────────────────────────────────────────────────────────
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendors_tenant_isolation ON vendors;
CREATE POLICY vendors_tenant_isolation ON vendors
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── po_invoice_scans ──────────────────────────────────────────────────────────
ALTER TABLE po_invoice_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_invoice_scans_tenant_isolation ON po_invoice_scans;
CREATE POLICY po_invoice_scans_tenant_isolation ON po_invoice_scans
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── po_receipts ───────────────────────────────────────────────────────────────
ALTER TABLE po_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_receipts_tenant_isolation ON po_receipts;
CREATE POLICY po_receipts_tenant_isolation ON po_receipts
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── po_receiving_lines ────────────────────────────────────────────────────────
ALTER TABLE po_receiving_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_receiving_lines_tenant_isolation ON po_receiving_lines;
CREATE POLICY po_receiving_lines_tenant_isolation ON po_receiving_lines
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── po_discrepancy_log ────────────────────────────────────────────────────────
ALTER TABLE po_discrepancy_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_discrepancy_log_tenant_isolation ON po_discrepancy_log;
CREATE POLICY po_discrepancy_log_tenant_isolation ON po_discrepancy_log
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── po_receiving_approval_queue ────────────────────────────────────────────────
ALTER TABLE po_receiving_approval_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_receiving_approval_queue_tenant_isolation ON po_receiving_approval_queue;
CREATE POLICY po_receiving_approval_queue_tenant_isolation ON po_receiving_approval_queue
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );

-- ── portal_contacts ───────────────────────────────────────────────────────────
ALTER TABLE portal_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_contacts_tenant_isolation ON portal_contacts;
CREATE POLICY portal_contacts_tenant_isolation ON portal_contacts
  FOR ALL USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid()::text)
    OR (SELECT role FROM users WHERE id = auth.uid()::text) = 'superadmin'
  );
