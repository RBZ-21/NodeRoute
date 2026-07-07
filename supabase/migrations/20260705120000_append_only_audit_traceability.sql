-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260705120000_append_only_audit_traceability
-- Finding  : DB-004 (Root Depth Scan, commit 904d7119) — FSMA 204
-- Purpose  : Audit and traceability tables had no append-only protection; the
--            service role (and anyone with table grants) could UPDATE/DELETE
--            audit history and lot receiving records.
--
--            audit_log and route_mutation_audit_logs are pure logs: they get
--            the existing credit_hold_log append-only pattern verbatim
--            (BEFORE UPDATE OR DELETE trigger that raises + revoked grants).
--
--            lot_codes and inventory_lots are traceability records with
--            legitimate operational mutations (qty_on_hand, status, PO link,
--            notes — used by lot depletion, kits, receiving workflows), so
--            they get partial protection: DELETE is blocked, and UPDATE is
--            blocked only for the identity/receiving columns that FSMA 204
--            requires to stay immutable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. audit_log: full append-only (mirrors credit_hold_log 20260518000200) ──

CREATE OR REPLACE FUNCTION audit_log_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only — % is not permitted', TG_OP;
END$$;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

REVOKE UPDATE, DELETE ON audit_log FROM anon, authenticated;

-- ── 2. route_mutation_audit_logs: full append-only ───────────────────────────

CREATE OR REPLACE FUNCTION route_mutation_audit_logs_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'route_mutation_audit_logs is append-only — % is not permitted', TG_OP;
END$$;

DROP TRIGGER IF EXISTS trg_route_mutation_audit_logs_no_update ON route_mutation_audit_logs;
CREATE TRIGGER trg_route_mutation_audit_logs_no_update
  BEFORE UPDATE OR DELETE ON route_mutation_audit_logs
  FOR EACH ROW EXECUTE FUNCTION route_mutation_audit_logs_block_mutation();

REVOKE UPDATE, DELETE ON route_mutation_audit_logs FROM anon, authenticated;

-- ── 3. lot_codes: no DELETE; identity/receiving columns immutable ────────────
-- Mutable on purpose: purchase_order_id / source_po_number (PO linking in
-- purchase-order-workflows.js), notes, expiration_date, location_id.

CREATE OR REPLACE FUNCTION lot_codes_protect_traceability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lot_codes rows cannot be deleted (FSMA 204 traceability record)';
  END IF;
  IF NEW.lot_number        IS DISTINCT FROM OLD.lot_number
     OR NEW.product_id        IS DISTINCT FROM OLD.product_id
     OR NEW.quantity_received IS DISTINCT FROM OLD.quantity_received
     OR NEW.received_date     IS DISTINCT FROM OLD.received_date
     OR NEW.received_by       IS DISTINCT FROM OLD.received_by
     OR NEW.company_id        IS DISTINCT FROM OLD.company_id
     OR NEW.created_at        IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'lot_codes identity/receiving fields are immutable (FSMA 204 traceability record)';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_lot_codes_protect ON lot_codes;
CREATE TRIGGER trg_lot_codes_protect
  BEFORE UPDATE OR DELETE ON lot_codes
  FOR EACH ROW EXECUTE FUNCTION lot_codes_protect_traceability();

REVOKE DELETE ON lot_codes FROM anon, authenticated;

-- ── 4. inventory_lots: no DELETE; identity/receiving columns immutable ───────
-- Mutable on purpose: qty_on_hand, status, cost_per_unit, supplier_name,
-- notes, expiry_date, best_before_date, storage_temp, certifications,
-- updated_at (lot depletion, kits, PATCH /lots/:lotId all rely on these).

CREATE OR REPLACE FUNCTION inventory_lots_protect_traceability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory_lots rows cannot be deleted (FSMA 204 traceability record)';
  END IF;
  IF NEW.lot_number     IS DISTINCT FROM OLD.lot_number
     OR NEW.item_number   IS DISTINCT FROM OLD.item_number
     OR NEW.qty_received  IS DISTINCT FROM OLD.qty_received
     OR NEW.received_date IS DISTINCT FROM OLD.received_date
     OR NEW.company_id    IS DISTINCT FROM OLD.company_id
     OR NEW.created_by    IS DISTINCT FROM OLD.created_by
     OR NEW.created_at    IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'inventory_lots identity/receiving fields are immutable (FSMA 204 traceability record)';
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_inventory_lots_protect ON inventory_lots;
CREATE TRIGGER trg_inventory_lots_protect
  BEFORE UPDATE OR DELETE ON inventory_lots
  FOR EACH ROW EXECUTE FUNCTION inventory_lots_protect_traceability();

REVOKE DELETE ON inventory_lots FROM anon, authenticated;
