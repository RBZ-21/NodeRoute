alter table public.invoices
  add column if not exists document_snapshot jsonb,
  add column if not exists salesperson_name text;

alter table public.orders
  add column if not exists salesperson_name text;

update public.companies
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'invoice_address', E'2019-C Cherry Hill Lane\nCharleston, SC 29405',
  'invoice_phone', '(843) 577-3531',
  'invoice_fax', '(843) 722-2445',
  'invoice_after_hours_phone', '(843) 723-1278',
  'invoice_remit_to', E'2019-C Cherry Hill Lane\nCharleston, SC 29405',
  'invoice_sales_terms', 'The above named "SOLD TO" a) authorizes its agents to purchase seafood items from Crosby''s Seafood, Inc., b) agrees to comply with all the terms of sale if credit is extended, c) does personally guarantee the business debt to Crosby''s Seafood.',
  'invoice_credit_terms', 'A Financial Charge of 1 1/2% per month, which is an annual percentage of 18% will be added on the unpaid balance after 30 days. Customer agrees to pay all costs necessary for collection of this invoice, including reasonable attorney''s fees. I hereby accept the above product as being satisfactory.',
  'invoice_copy_label', 'CUSTOMER COPY',
  'invoice_safety_notice', 'ALL SEAFOOD SHOULD BE FULLY COOKED'
)
where id = '00000000-0000-0000-0000-000000000001'
  and lower(coalesce(settings ->> 'business_name', name, '')) like 'crosby%';
