-- Migration: add delivery preference and other missing columns to Customers table
-- Safe to run multiple times thanks to IF NOT EXISTS

ALTER TABLE "Customers"
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT,
  ADD COLUMN IF NOT EXISTS preferred_delivery_window TEXT,
  ADD COLUMN IF NOT EXISTS preferred_door TEXT,
  ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS credit_hold_placed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fax_number TEXT,
  ADD COLUMN IF NOT EXISTS billing_name TEXT,
  ADD COLUMN IF NOT EXISTS billing_contact TEXT,
  ADD COLUMN IF NOT EXISTS billing_phone TEXT,
  ADD COLUMN IF NOT EXISTS customer_number TEXT;
