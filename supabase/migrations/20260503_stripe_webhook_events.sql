-- Idempotency table for Stripe webhook events.
-- Ensures the same event_id is never processed more than once,
-- even if Stripe delivers the same event multiple times.

create table if not exists stripe_webhook_events (
  event_id   text primary key,
  received_at timestamptz not null default now()
);

-- Index for fast existence checks (primary key covers this, but explicit for clarity)
-- Already covered by the PK; no extra index needed.

-- RLS: only the service role can read/write this table.
alter table stripe_webhook_events enable row level security;

create policy "service role only"
  on stripe_webhook_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
