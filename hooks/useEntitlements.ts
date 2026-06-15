import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { Tier, TierEntitlements, SubscriptionRow, resolveTier, entitlements } from '../utils/entitlements';

export interface Entitlements {
  tier: Tier;
  ent: Readonly<TierEntitlements>;
  loading: boolean;
  refresh: () => void;
}

// Resolves the signed-in user's effective tier from their `subscriptions` row
// (RLS read-own). The DB is authoritative; this mirror lets the UI gray out /
// show counters instantly. Anonymous users have no row -> 'free'. Refetches on
// window focus so an upgrade completed in the Stripe tab reflects on return.
export function useEntitlements(uid: string | undefined): Entitlements {
  const [tier, setTier] = useState<Tier>('free');
  const [loading, setLoading] = useState<boolean>(!!uid);
  const uidRef = useRef(uid);
  uidRef.current = uid;
  // Dedupe concurrent refetches — visibilitychange + focus both fire on a tab
  // return, and the post-checkout poll ticks; one in-flight read is enough.
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    const u = uidRef.current;
    if (!u) { setTier('free'); setLoading(false); return; }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('tier,status,current_period_end')
        .eq('user_id', u)
        .maybeSingle();
      if (error) throw error;
      setTier(resolveTier((data as SubscriptionRow | null) ?? null, Date.now()));
    } catch (e) {
      console.error('useEntitlements: failed to resolve tier, assuming free', e);
      setTier('free');
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    setLoading(!!uid);
    void refresh();
  }, [uid, refresh]);

  // Re-resolve when the user returns to the tab (e.g. back from Stripe Checkout).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  // After returning from Stripe Checkout the entitlement webhook may not have
  // committed yet (effective_tier still 'free'). App.tsx sets 'postCheckoutPoll'
  // on ?checkout=success; poll briefly until the tier upgrades, then clear it.
  // Bounded + self-clearing + fail-safe (only ever resolves a HIGHER tier).
  useEffect(() => {
    if (!uid) return;
    if (sessionStorage.getItem('postCheckoutPoll') !== '1') return;
    if (tier !== 'free') { sessionStorage.removeItem('postCheckoutPoll'); return; }
    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      if (attempts >= 5) { sessionStorage.removeItem('postCheckoutPoll'); window.clearInterval(id); return; }
      void refresh();
    }, 1500);
    return () => window.clearInterval(id);
  }, [uid, tier, refresh]);

  return { tier, ent: entitlements(tier), loading, refresh: () => { void refresh(); } };
}
