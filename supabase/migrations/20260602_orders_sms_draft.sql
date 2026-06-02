alter table orders
  add column if not exists source text,
  add column if not exists draft boolean not null default false;

create index if not exists orders_draft_idx on orders (draft) where draft = true;
