import { createClient } from '@supabase/supabase-js';

// Hardcoded keys for development environment where .env is not available.
const supabaseUrl = 'https://qygirixqsuraclbdfnjp.supabase.co';
const supabaseAnonKey = 'sb_publishable_Lby5hzrKRwckHzC2itzEAA_VZp1A-Tn';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});
