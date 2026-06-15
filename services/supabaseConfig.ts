// Supabase project URL + anon key, factored out of services/supabase.ts so that
// lightweight callers (e.g. the public `get-prices` fetch in hooks/usePrices)
// can reach the project WITHOUT importing @supabase/supabase-js (~210KB). The
// anon key is a public, RLS-scoped key — safe to ship in the client bundle.
export const SUPABASE_URL = 'https://qygirixqsuraclbdfnjp.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5Z2lyaXhxc3VyYWNsYmRmbmpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyOTA4NjIsImV4cCI6MjA4MDg2Njg2Mn0.x1KpxEUDQ4EOW58MgsgeKJ5Y9NIqcRIgKmZ-qhkhWZQ';
