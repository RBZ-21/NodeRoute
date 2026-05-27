-- orders.stop_id: links a delivery order to the stop that was auto-created for it
-- by syncOrderStop in backend/routes/orders.js.  The column is already listed in
-- OPTIONAL_SCOPE_FIELDS (operating-context.js) so the resilience layer expects it
-- to exist; its absence is what causes the "column order.stop_id does not exist"
-- error on the dashboard.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stop_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_stop_id ON public.orders(stop_id);
