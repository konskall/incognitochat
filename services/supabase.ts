import { createClient } from '@supabase/supabase-js';

// Χρησιμοποιούμε (import.meta as any).env για να αποφύγουμε TypeScript errors αν λείπουν τα types του Vite
const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase URL or Anon Key. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true, // Κρατάει τον χρήστη συνδεδεμένο (Anonymous session)
    autoRefreshToken: true,
  }
});
