import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  console.warn(
    '[NodeRoute] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set. ' +
    'Waitlist submissions will fail until these are configured.'
  );
}

export const supabase = createClient(url ?? '', key ?? '');
