-- Add charges column to orders table
-- Run in Supabase SQL Editor

alter table orders
  add column if not exists charges jsonb not null default '[]'::jsonb;

comment on column orders.charges is
  'Array of additional charges: [{key, label, type (percent|flat), value, amount}]';
