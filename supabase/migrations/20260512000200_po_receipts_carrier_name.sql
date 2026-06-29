-- Add carrier/shipping company tracking to PO receipts.
-- Vendor = who supplied the product; carrier = who physically delivered it.
ALTER TABLE public.po_receipts
  ADD COLUMN IF NOT EXISTS carrier_name text;
