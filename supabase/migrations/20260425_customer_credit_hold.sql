-- Migration: 20260425_customer_credit_hold
-- Purpose  : Add credit hold fields to the Customers table so accounts can be
--            blocked from receiving new orders until the hold is lifted.
alter table if exists "Customers"
  add column if not exists credit_hold            boolean     not null default false,
  add column if not exists credit_hold_reason     text,
  add column if not exists credit_hold_placed_at  timestamptz;
