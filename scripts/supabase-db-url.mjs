#!/usr/bin/env node
/**
 * Build a Supabase direct DB URL from .env without shell interpolation.
 * Prints nothing by default; use --check to verify required vars are set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
  console.error('Missing .env at repo root (SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD required).');
  process.exit(1);
}

const parsed = dotenv.parse(fs.readFileSync(envPath));
const projectRef = parsed.SUPABASE_PROJECT_REF || parsed.SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
const password = parsed.SUPABASE_DB_PASSWORD;

if (!projectRef || !password) {
  console.error('SUPABASE_PROJECT_REF (or SUPABASE_URL) and SUPABASE_DB_PASSWORD must be set in .env');
  process.exit(1);
}

// Default to the direct DB host (user `postgres`). The transaction pooler
// (user `postgres.<ref>`) is an explicit opt-in via SUPABASE_POOLER_HOST,
// because it failed here with "tenant/user postgres.<ref> not found".
const poolerHost = parsed.SUPABASE_POOLER_HOST;
const directHost = `db.${projectRef}.supabase.co`;

let dbUrl;
let hostStrategy;
if (poolerHost) {
  hostStrategy = `pooler:postgres.${projectRef}@${poolerHost}:6543`;
  dbUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${poolerHost}:6543/postgres?sslmode=require`;
} else {
  hostStrategy = `direct:postgres@${directHost}:5432`;
  dbUrl = `postgresql://postgres:${encodeURIComponent(password)}@${directHost}:5432/postgres?sslmode=require`;
}

if (process.argv.includes('--check')) {
  console.log(`project_ref=${projectRef}`);
  console.log(`host_strategy=${hostStrategy}`);
  // Mirror the exact URL shape that is exported, with the password masked.
  console.log('db_url=' + dbUrl.replace(encodeURIComponent(password), '***'));
  process.exit(0);
}

if (process.argv.includes('--print')) {
  process.stdout.write(dbUrl);
}

export { dbUrl, projectRef };
