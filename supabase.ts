/// <reference types="vite/client" />

import { createClient } from '@supabase/supabase-js';

// Προσπέλαση των environment variables από το Vite
// Πρέπει να φτιάξεις ένα αρχείο .env στο root του project
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Προσοχή: Τα VITE_SUPABASE_URL και VITE_SUPABASE_ANON_KEY λείπουν από το .env αρχείο!');
}

// Δημιουργία του Supabase client
// Αυτό το αντικείμενο 'supabase' θα αντικαταστήσει τα 'db', 'auth' κτλ του Firebase
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  auth: {
    persistSession: true, // Κρατάει τον χρήστη συνδεδεμένο
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  // Βελτιστοποίηση για realtime
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
