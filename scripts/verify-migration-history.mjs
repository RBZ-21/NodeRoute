#!/usr/bin/env node
/**
 * Compare local migration filenames with remote schema_migrations versions.
 * Exits 0 when every local version exists remotely and no remote-only versions remain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '..', 'supabase', 'migrations');

function localFiles() {
  return fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
}

function localVersions() {
  return [...new Set(localFiles().map((f) => f.split('_')[0]))].sort();
}

/** Versions that more than one local migration file maps to (CLI-ambiguous). */
function duplicateLocalPrefixes() {
  const counts = new Map();
  for (const f of localFiles()) {
    const v = f.split('_')[0];
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].filter(([, c]) => c > 1).map(([v, c]) => `${v} (x${c})`);
}

/**
 * A bare 8-digit date-only version is ambiguous to the Supabase CLI whenever a
 * 14-digit timestamp version shares that date — the CLI then refuses to pair
 * the date-only version with its remote row. Flag those collisions.
 */
function dateOnlyTimestampCollisions() {
  const eight = new Set();
  const dates14 = new Set();
  for (const f of localFiles()) {
    const v = f.split('_')[0];
    if (/^\d{8}$/.test(v)) eight.add(v);
    else if (/^\d{14}$/.test(v)) dates14.add(v.slice(0, 8));
  }
  return [...eight].filter((d) => dates14.has(d)).sort();
}

function remoteVersions() {
  const dbUrl = spawnSync(
    'node',
    ['--input-type=module', '-e', "import { dbUrl } from './scripts/supabase-db-url.mjs'; process.stdout.write(dbUrl);"],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' },
  );
  if (dbUrl.status !== 0 || !dbUrl.stdout.trim()) {
    throw new Error('Failed to build DB URL from .env');
  }

  const list = spawnSync(
    'npx',
    ['--yes', 'supabase@latest', 'migration', 'list', '--db-url', dbUrl.stdout.trim()],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' },
  );
  if (list.status !== 0) {
    throw new Error(list.stderr || list.stdout || 'supabase migration list failed');
  }

  const versions = new Set();
  for (const line of list.stdout.split('\n')) {
    const match = line.match(/^\s*(\d{8,14})\s/);
    if (match) versions.add(match[1]);
  }
  return [...versions].sort();
}

const fileCount = localFiles().length;
const duplicates = duplicateLocalPrefixes();
const collisions = dateOnlyTimestampCollisions();

// Local-structure checks run before touching the network so duplicate prefixes
// are caught even if the remote is unreachable.
let localStructureFailed = false;
console.log(`local_files=${fileCount} local_versions=${localVersions().length}`);
if (duplicates.length) {
  console.error('Duplicate local migration prefixes:', duplicates.join(', '));
  localStructureFailed = true;
}
if (collisions.length) {
  console.error('Date-only versions colliding with a same-date timestamp:', collisions.join(', '));
  localStructureFailed = true;
}
if (localStructureFailed) {
  console.error('Every local migration file must have a unique, CLI-unambiguous version prefix.');
  process.exit(1);
}

const local = localVersions();
const remote = remoteVersions();
const localSet = new Set(local);
const remoteSet = new Set(remote);
const localOnly = local.filter((v) => !remoteSet.has(v));
const remoteOnly = remote.filter((v) => !localSet.has(v));

console.log(`local_versions=${local.length} remote_versions=${remote.length}`);
if (localOnly.length) {
  console.error('Local-only versions:', localOnly.join(', '));
}
if (remoteOnly.length) {
  console.error('Remote-only versions:', remoteOnly.join(', '));
}

if (localOnly.length || remoteOnly.length) {
  process.exit(1);
}

console.log('Migration history is synchronized.');
