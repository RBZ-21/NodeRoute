-- Phase 0 ERP foundation.
-- Shared extensions only; ERP feature tables are added in per-phase migrations.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists ltree;
