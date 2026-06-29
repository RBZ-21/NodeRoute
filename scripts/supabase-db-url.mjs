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

// Transaction pooler (IPv4) — direct db.* host requires IPv6 in this environment.
const poolerHost = parsed.SUPABASE_POOLER_HOST || `aws-0-us-west-2.pooler.supabase.com`;
const dbUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@${poolerHost}:6543/postgres?sslmode=require`;

if (process.argv.includes('--check')) {
  console.log(`project_ref=${projectRef}`);
  console.log('db_url=postgresql://postgres:***@db.' + projectRef + '.supabase.co:5432/postgres?sslmode=require');
  process.exit(0);
}

if (process.argv.includes('--print')) {
  process.stdout.write(dbUrl);
}

export { dbUrl, projectRef };
