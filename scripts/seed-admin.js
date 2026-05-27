/**
 * scripts/seed-admin.js
 *
 * One-time admin seeding script. Run manually after a fresh DB setup:
 *   node scripts/seed-admin.js
 *
 * Safe to run multiple times — exits early if any user already exists.
 * Never runs automatically on server startup.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { supabase } = require('../backend/services/supabase');
const logger = require('../backend/services/logger');

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env');
  process.exit(1);
}

async function seedAdmin() {
  const { data: users, error: fetchErr } = await supabase
    .from('users')
    .select('id')
    .limit(1);

  if (fetchErr) {
    console.error('Could not query users table:', fetchErr.message);
    process.exit(1);
  }

  if (users && users.length > 0) {
    console.log('Users already exist — skipping admin seed. No changes made.');
    process.exit(0);
  }

  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  const { error: insertErr } = await supabase.from('users').insert([{
    id:             'admin-001',
    name:           'Admin',
    email:          ADMIN_EMAIL,
    password_hash:  passwordHash,
    role:           'admin',
    status:         'active',
    invite_token:   null,
    invite_expires: null,
    created_at:     new Date().toISOString(),
  }]);

  if (insertErr) {
    console.error('Failed to create admin user:', insertErr.message);
    process.exit(1);
  }

  console.log(`Admin user created successfully: ${ADMIN_EMAIL}`);
  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
