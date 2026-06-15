import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

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

// Fetch live Basic/Ultra prices from the public get-prices edge function.
// On failure, prices stays null and the UI shows '—' (graceful).
export function usePrices(): { prices: Prices | null; loading: boolean } {
  const [prices, setPrices] = useState<Prices | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-prices', { body: {} });
        if (error) throw error;
        if (alive) setPrices(data as Prices);
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
