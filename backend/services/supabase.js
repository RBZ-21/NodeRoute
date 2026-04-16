require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function dbQuery(promise, res) {
  const { data, error } = await promise;
  if (error) {
    console.error('Supabase error:', error.message);
    if (res) res.status(500).json({ error: error.message });
    return null;
  }
  return data;
}

module.exports = { supabase, dbQuery };
