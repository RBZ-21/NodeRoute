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

function localVersions() {
  return [...new Set(fs.readdirSync(migrationsDir).map((f) => f.split('_')[0]))].sort();
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
