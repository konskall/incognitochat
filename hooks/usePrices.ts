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

// Module-level cache so repeated mounts (landing PricingSection + the persistently
// mounted UpgradeModal in every chat/dashboard screen) share ONE fetch instead of
// re-hitting get-prices (and thus Stripe) on every mount. TTL matches the function's
// Cache-Control max-age (5 min). A single in-flight promise dedupes concurrent callers.
const TTL_MS = 5 * 60 * 1000;
let priceCache: { data: Prices; exp: number } | null = null;
let priceInFlight: Promise<Prices> | null = null;

function cached(): Prices | null {
  return priceCache && priceCache.exp > Date.now() ? priceCache.data : null;
}

async function fetchPrices(): Promise<Prices> {
  const hit = cached();
  if (hit) return hit;
  if (priceInFlight) return priceInFlight;
  priceInFlight = (async () => {
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
    priceCache = { data, exp: Date.now() + TTL_MS };
    return data;
  })();
  try {
    return await priceInFlight;
  } finally {
    priceInFlight = null;
  }
}

// Fetch live Basic/Ultra prices from the PUBLIC get-prices edge function via the
// shared module cache. On failure, prices stays null and the UI shows '—'.
export function usePrices(): { prices: Prices | null; loading: boolean } {
  const [prices, setPrices] = useState<Prices | null>(() => cached());
  const [loading, setLoading] = useState<boolean>(() => !cached());
  useEffect(() => {
    let alive = true;
    fetchPrices()
      .then((data) => { if (alive) setPrices(data); })
      .catch((e) => { console.error('usePrices failed', e); if (alive) setPrices(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { prices, loading };
}
