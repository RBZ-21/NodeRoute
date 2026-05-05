-- seafood_inventory: item_number is the natural product key used throughout the codebase
ALTER TABLE seafood_inventory
  ADD COLUMN IF NOT EXISTS item_number          TEXT,
  ADD COLUMN IF NOT EXISTS is_ftl_product       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_catch_weight      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_price_per_lb NUMERIC(10,4);

-- orders: fulfillment_type distinguishes delivery from pickup (drives stop creation)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'delivery';

-- invoices: payment tracking columns used by the PATCH handler, Stripe webhook, and AR hub
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS paid_date         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_date          DATE,
  ADD COLUMN IF NOT EXISTS collections_note  TEXT,
  ADD COLUMN IF NOT EXISTS collections_status TEXT,
  ADD COLUMN IF NOT EXISTS stripe_session_id  TEXT;

-- Customers: SMS opt-out flag used by daily fish blast service
ALTER TABLE "Customers"
  ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN NOT NULL DEFAULT false;

-- stops: departed_at tracks when a driver leaves a stop; shipped_lots records FSMA lot traceability
ALTER TABLE stops
  ADD COLUMN IF NOT EXISTS departed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipped_lots JSONB;

-- purchase_orders: company_id for multi-company scoping (table uses org_id but code expects company_id)
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS company_id UUID;
