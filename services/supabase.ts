import { createClient } from '@supabase/supabase-js';

// Hardcoded keys for development environment where .env is not available.
const supabaseUrl = 'https://qygirixqsuraclbdfnjp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5Z2lyaXhxc3VyYWNsYmRmbmpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyOTA4NjIsImV4cCI6MjA4MDg2Njg2Mn0.x1KpxEUDQ4EOW58MgsgeKJ5Y9NIqcRIgKmZ-qhkhWZQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});
