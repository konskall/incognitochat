import { useEffect, useState } from 'react';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../services/supabaseConfig';

export interface PlanPrice { amount: number | null; currency: string; interval: string; }
export interface Prices { basic: PlanPrice | null; ultra: PlanPrice | null; }

// Format a Stripe price (minor units) as a localized currency string. '—' on miss.
export function formatPrice(p: PlanPrice | null): string {
  if (!p || p.amount == null) return '—';
  const major = p.amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: (p.currency || 'eur').toUpperCase(), maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${(p.currency || 'eur').toUpperCase()}`;
  }
}

// Fetch live Basic/Ultra prices from the PUBLIC get-prices edge function.
// Uses a bare fetch (not supabase.functions.invoke) so the marketing landing —
// the only place this hook runs — does NOT pull @supabase/supabase-js (~210KB)
// into its first-paint bundle. get-prices is verify_jwt=false; the anon key is
// sent only to satisfy the API gateway. On failure, prices stays null and the
// UI shows '—' (graceful).
export function usePrices(): { prices: Prices | null; loading: boolean } {
  const [prices, setPrices] = useState<Prices | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-prices`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: '{}',
        });
        if (!res.ok) throw new Error(`get-prices ${res.status}`);
        const data = (await res.json()) as Prices;
        if (alive) setPrices(data);
      } catch (e) {
        console.error('usePrices failed', e);
        if (alive) setPrices(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);
  return { prices, loading };
}
