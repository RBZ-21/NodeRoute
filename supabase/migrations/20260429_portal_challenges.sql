-- Portal verification challenges: replaces the in-memory portalChallenges Map.
-- Survives server restarts and works across multiple app instances.
create table if not exists public.portal_challenges (
  id            text        primary key,
  email         text        not null,
  name          text        not null default '',
  code_hash     text        not null,
  expires_at    timestamptz not null,
  attempts_left integer     not null default 5,
  last_sent_at  timestamptz not null,
  company_id    text,
  location_id   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_portal_challenges_email on public.portal_challenges(email);

-- Portal rate-limit attempts: replaces the in-memory authAttempts Map.
create table if not exists public.portal_auth_attempts (
  id            text        primary key,
  email         text        not null,
  attempted_at  timestamptz not null default now()
);
create index if not exists idx_portal_auth_attempts_email on public.portal_auth_attempts(email, attempted_at);
