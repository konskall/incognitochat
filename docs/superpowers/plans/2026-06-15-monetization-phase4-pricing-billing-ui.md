# Monetization Phase 4 — Pricing UI + Dashboard Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see the plans and pay. Add a 3-tier pricing section to the landing page (live prices from Stripe), a "Your Plan" card to the dashboard, and the pick→login→pay funnel + checkout-return handling.

**Architecture:** A new public `get-prices` edge function returns the two paid prices from Stripe; a `usePrices()` hook fetches them. A self-contained `PricingSection` renders Free/Basic/Ultra comparison cards below the landing page's "How it works" section. CTAs route through a new `onChoosePlan(tier)` in `App.tsx` that either calls the existing `startCheckout(tier)` (logged-in Google user) or stores a `pendingCheckoutTier` intent and sends the visitor to login, resuming checkout automatically after Google sign-in. The dashboard gets a "Your Plan" card (current tier + limits + Upgrade/Manage actions via `startCheckout`/`openBillingPortal`). `App.tsx` handles the `?checkout=…`/`?portal=…` return params with a toast and URL cleanup. All English copy.

**Tech Stack:** React 18 + TS, Vite, Tailwind, lucide-react, `@supabase/supabase-js` v2, Supabase Deno edge functions, Stripe SDK (`esm.sh/stripe@17`). No new deps.

---

## Reused / existing pieces (do NOT recreate)
- `services/supabase.ts`: `startCheckout(tier): Promise<{ok,error?}>` and `openBillingPortal(): Promise<{ok,error?}>` (Phase 3) — both check `error` and only redirect on a real URL.
- `utils/entitlements.ts`: `Tier`, `TIER_CONFIG`, `entitlements`.
- `components/MessageActionMenu.tsx`: `flashToast(text)`.
- `hooks/useEntitlements.ts`: `useEntitlements(uid) → { tier, ent, loading, refresh }` (already used in DashboardScreen line 342, ChatScreen).
- Stripe secrets already set in Supabase (Phase 2): `STRIPE_SECRET_KEY`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_ULTRA`. **No new user action needed.**

## Landing/dashboard anchors (verified 2026-06-15)
- `components/LandingPage.tsx`: only prop is `onStart: () => void` (line 7). "How it works" `<section>` spans lines 254–272; insert the pricing section after line 272, before the FAQ comment at 274. Card pattern: `bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all`. Heading: `text-3xl font-bold text-center mb-10 lg:mb-14`. Section container: `max-w-6xl mx-auto px-6 py-12 lg:py-20`. Ultra accent = `purple-600`; Basic/brand = `blue-600`.
- `App.tsx`: `currentView` state (line 22) `'landing'|'login'|'dashboard'|'chat'`; `<LandingPage onStart={handleStartApp} />` (line 204); `onAuthStateChange` sets `currentUser` on SIGNED_IN non-anon (lines ~91–108); `handleStartApp` (lines 126–137).
- `components/DashboardScreen.tsx`: `user` prop `{uid,isAnonymous,email}`; `const { tier } = useEntitlements(user?.uid)` (line 342); left sidebar column `lg:col-span-4 ...` opens at 1220, profile card 1221–1282, **insert "Your Plan" card at line 1283** (second child of the `space-y-6` column). Simple card pattern: `bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-5`.

**Verification commands:** unit tests `npx vitest run`; build `npm run build`. Edge-function deploy via the Supabase `deploy_edge_function` MCP tool (verify_jwt=false for get-prices).

---

### Task 1: `get-prices` public edge function

**Files:**
- Create: `supabase/functions/get-prices/index.ts`

- [ ] **Step 1: Write the function**

```ts
// Supabase Edge Function: get-prices (PUBLIC, verify_jwt=false)
// Returns the live Basic/Ultra prices from Stripe so the landing page never
// hardcodes amounts. Reads STRIPE_SECRET_KEY + STRIPE_PRICE_BASIC/ULTRA (already
// set in Phase 2). No auth required — prices are public marketing data.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@17?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const PRICE_BASIC = Deno.env.get("STRIPE_PRICE_BASIC");
    const PRICE_ULTRA = Deno.env.get("STRIPE_PRICE_ULTRA");
    if (!KEY || !PRICE_BASIC || !PRICE_ULTRA) return json({ error: "STRIPE_NOT_CONFIGURED" }, 503);

    const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient() });
    const [b, u] = await Promise.all([
      stripe.prices.retrieve(PRICE_BASIC),
      stripe.prices.retrieve(PRICE_ULTRA),
    ]);
    const shape = (p: Stripe.Price) => ({
      amount: p.unit_amount,                       // minor units (cents)
      currency: p.currency,                        // e.g. "eur"
      interval: p.recurring?.interval ?? "month",  // "month"
    });
    return json({ basic: shape(b), ultra: shape(u) }, 200);
  } catch (e) {
    console.error("get-prices error", e);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
```

- [ ] **Step 2: Deploy via MCP** with `verify_jwt: false` (public). Use the Supabase `deploy_edge_function` tool, name `get-prices`.

- [ ] **Step 3: Structural verify** — invoke the function (or curl `https://qygirixqsuraclbdfnjp.supabase.co/functions/v1/get-prices` with the anon apikey). Expect `200 { basic:{amount,currency,interval}, ultra:{…} }`. Record the returned amounts in the commit message / a note.

- [ ] **Step 4: Commit** (file is committed even though deploy is MCP-managed):

```bash
git add supabase/functions/get-prices/index.ts
git commit -m "feat(monetization): get-prices public edge function (live Stripe prices)"
```

---

### Task 2: `usePrices` hook + `formatPrice`

**Files:**
- Create: `hooks/usePrices.ts`

- [ ] **Step 1: Implement**

```ts
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
```

- [ ] **Step 2: Build** — `npm run build` (zero errors).

- [ ] **Step 3: Commit**

```bash
git add hooks/usePrices.ts
git commit -m "feat(monetization): usePrices hook + formatPrice"
```

---

### Task 3: `PricingSection` component (landing)

**Files:**
- Create: `components/PricingSection.tsx`

Self-contained `<section>` (heading + 3 comparison cards) matching the landing design system. No dependency on LandingPage internals.

- [ ] **Step 1: Implement**

```tsx
import React from 'react';
import { Check, Sparkles, Zap, Shield } from 'lucide-react';
import { usePrices, formatPrice } from '../hooks/usePrices';

interface PricingSectionProps {
  onStartFree: () => void;                                  // Free CTA -> enter app
  onChoosePlan: (tier: 'basic' | 'ultra') => void;          // Paid CTA -> login/checkout funnel
}

interface PlanCard {
  key: 'free' | 'basic' | 'ultra';
  name: string;
  icon: React.ReactNode;
  blurb: string;
  features: string[];
  accent: 'slate' | 'blue' | 'purple';
  highlight?: boolean;
}

const PLANS: PlanCard[] = [
  {
    key: 'free', name: 'Free', icon: <Shield size={22} />, accent: 'slate',
    blurb: 'For quick, private conversations.',
    features: ['1 active room', '10 messages/day per room', 'Rooms expire after 24h', 'Up to 10MB files', 'End-to-end private chat'],
  },
  {
    key: 'basic', name: 'Basic', icon: <Zap size={22} />, accent: 'blue', highlight: true,
    blurb: 'More room, more messages, audio calls.',
    features: ['10 rooms', '100 messages/day per room', 'Rooms never expire', 'Audio calls', 'Room appearance & disappearing messages', 'Up to 10MB files'],
  },
  {
    key: 'ultra', name: 'Ultra', icon: <Sparkles size={22} />, accent: 'purple',
    blurb: 'Everything, unlimited.',
    features: ['Unlimited rooms & messages', 'Video calls & screen sharing', 'Inco AI assistant', 'Up to 40MB files', 'Everything in Basic'],
  },
];

const ACCENT = {
  slate: { ring: 'border-slate-200 dark:border-slate-800', chip: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300', btn: 'bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white', check: 'text-slate-400' },
  blue: { ring: 'border-blue-300 dark:border-blue-800 ring-2 ring-blue-500/40', chip: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', btn: 'bg-blue-600 hover:bg-blue-700 text-white', check: 'text-blue-500' },
  purple: { ring: 'border-purple-300 dark:border-purple-800', chip: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400', btn: 'bg-purple-600 hover:bg-purple-700 text-white', check: 'text-purple-500' },
} as const;

const PricingSection: React.FC<PricingSectionProps> = ({ onStartFree, onChoosePlan }) => {
  const { prices, loading } = usePrices();

  const priceLabel = (key: PlanCard['key']) => {
    if (key === 'free') return { big: '€0', small: 'forever' };
    const p = key === 'basic' ? prices?.basic ?? null : prices?.ultra ?? null;
    return { big: loading ? '…' : formatPrice(p), small: `/ ${p?.interval ?? 'month'}` };
  };

  return (
    <section aria-labelledby="pricing-title" className="max-w-6xl mx-auto px-6 py-12 lg:py-20">
      <h2 id="pricing-title" className="text-3xl font-bold text-center mb-3">Simple, honest pricing</h2>
      <p className="text-center text-slate-500 dark:text-slate-400 mb-10 lg:mb-14">Start free. Upgrade when you need more. Cancel anytime.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {PLANS.map((plan) => {
          const a = ACCENT[plan.accent];
          const price = priceLabel(plan.key);
          return (
            <div key={plan.key} className={`relative h-full flex flex-col bg-white dark:bg-slate-900 p-8 rounded-3xl border shadow-sm hover:shadow-xl transition-all duration-300 ${a.ring}`}>
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs font-bold rounded-full bg-blue-600 text-white shadow">Most popular</span>
              )}
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${a.chip}`}>{plan.icon}</div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">{plan.name}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 mb-4">{plan.blurb}</p>
              <div className="flex items-end gap-1 mb-6">
                <span className="text-4xl font-extrabold text-slate-900 dark:text-white">{price.big}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400 mb-1">{price.small}</span>
              </div>
              <ul className="space-y-2.5 mb-8 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                    <Check size={18} className={`shrink-0 mt-0.5 ${a.check}`} /> <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => (plan.key === 'free' ? onStartFree() : onChoosePlan(plan.key))}
                className={`w-full py-3 rounded-xl font-bold transition active:scale-[0.98] ${a.btn}`}
              >
                {plan.key === 'free' ? 'Get started' : `Choose ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">Paid plans require a Google sign-in. Prices in your local currency, billed monthly.</p>
    </section>
  );
};

export default PricingSection;
```

- [ ] **Step 2: Build** — `npm run build` (zero errors).

- [ ] **Step 3: Commit**

```bash
git add components/PricingSection.tsx
git commit -m "feat(monetization): landing PricingSection (3-tier comparison, live prices)"
```

---

### Task 4: Wire PricingSection into LandingPage + App.tsx funnel

**Files:**
- Modify: `components/LandingPage.tsx`
- Modify: `App.tsx`

- [ ] **Step 1: LandingPage — add prop + render the section**

In `LandingPageProps` (line 6–8) add:
```ts
  onChoosePlan: (tier: 'basic' | 'ultra') => void;
```
Destructure `onChoosePlan` alongside `onStart`. Add the import at the top:
```ts
import PricingSection from './PricingSection';
```
Immediately AFTER the "How it works" `</section>` (line 272), before the FAQ comment (line 274), insert:
```tsx
        <PricingSection onStartFree={onStart} onChoosePlan={onChoosePlan} />
```

- [ ] **Step 2: App.tsx — implement `handleChoosePlan` + pass it down**

Add the import:
```ts
import { startCheckout } from './services/supabase';
```
(Adjust the relative path to match `App.tsx`'s location — it imports `./services/...` per existing code.)

Add the handler (near `handleStartApp`, lines 126–137):
```ts
const handleChoosePlan = useCallback(async (tier: 'basic' | 'ultra') => {
  // Logged-in Google user -> straight to Stripe Checkout.
  if (currentUser && !currentUser.isAnonymous) {
    const res = await startCheckout(tier);
    if (!res.ok) flashToast(res.error === 'LOGIN_REQUIRED' ? 'Please sign in with Google to upgrade.' : 'Could not start checkout. Please try again.');
    return;
  }
  // Visitor / anonymous -> remember intent, send to login; resume after sign-in.
  sessionStorage.setItem('pendingCheckoutTier', tier);
  handleStartApp();
}, [currentUser]);
```
(`useCallback` and `flashToast` import: confirm `useCallback` is imported from 'react'; add `import { flashToast } from './components/MessageActionMenu';` if not already present.)

Update the render (line 204):
```tsx
<LandingPage onStart={handleStartApp} onChoosePlan={handleChoosePlan} />
```

- [ ] **Step 3: App.tsx — resume checkout after Google sign-in**

In the `onAuthStateChange` handler, inside the branch that runs when a non-anonymous user signs in (the existing `if (session?.user && !session.user.is_anonymous)` block, ~lines 91–108), after `setCurrentUser(...)`, add:
```ts
const pending = sessionStorage.getItem('pendingCheckoutTier');
if (pending === 'basic' || pending === 'ultra') {
  sessionStorage.removeItem('pendingCheckoutTier');
  // Defer so the auth session is fully settled before invoking the function.
  setTimeout(() => { void startCheckout(pending); }, 0);
}
```

- [ ] **Step 4: Build + manual smoke** — `npm run build`. Landing shows the pricing section after "How it works"; Free CTA enters the app; Basic/Ultra CTA (logged out) routes to login.

- [ ] **Step 5: Commit**

```bash
git add components/LandingPage.tsx App.tsx
git commit -m "feat(monetization): pricing CTAs -> pick/login/pay funnel"
```

---

### Task 5: Dashboard "Your Plan" card

**Files:**
- Modify: `components/DashboardScreen.tsx`

- [ ] **Step 1: Imports + entitlements**

Add imports (near existing imports):
```ts
import { startCheckout, openBillingPortal } from '../services/supabase';
import { flashToast } from './MessageActionMenu';
import { Sparkles } from 'lucide-react';
```
(Confirm `flashToast`/icons aren't already imported; don't duplicate. Use icons already imported where possible.)

Change line 342 to also pull `ent`:
```ts
const { tier, ent } = useEntitlements(user?.uid);
```

- [ ] **Step 2: Add a small handler set inside the component**

```ts
const [billingBusy, setBillingBusy] = useState(false);

const handleManageBilling = async () => {
  if (billingBusy) return;
  setBillingBusy(true);
  const res = await openBillingPortal();
  if (!res.ok) { setBillingBusy(false); flashToast('Could not open billing. Please try again.'); }
};
const handleUpgrade = async (t: 'basic' | 'ultra') => {
  if (billingBusy) return;
  setBillingBusy(true);
  const res = await startCheckout(t);
  if (!res.ok) { setBillingBusy(false); flashToast(res.error === 'LOGIN_REQUIRED' ? 'Sign in with Google to upgrade.' : 'Could not start checkout. Please try again.'); }
};
```

- [ ] **Step 3: Render the "Your Plan" card at line 1283** (between the profile card `</div>` and the sidebar column `</div>`):

```tsx
<div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-5">
  <div className="flex items-center justify-between mb-3">
    <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Your plan</h3>
    <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${
      tier === 'ultra' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
      : tier === 'basic' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
      {tier === 'ultra' ? 'Ultra' : tier === 'basic' ? 'Basic' : 'Free'}
    </span>
  </div>
  <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1 mb-4">
    <li>{ent.maxRooms === null ? 'Unlimited rooms' : `${ent.maxRooms} room${ent.maxRooms === 1 ? '' : 's'}`}</li>
    <li>{ent.msgPerRoomPerDay === null ? 'Unlimited messages' : `${ent.msgPerRoomPerDay} messages/day per room`}</li>
    <li>{`Up to ${Math.round(ent.maxFileBytes / (1024 * 1024))}MB files`}</li>
  </ul>
  {tier === 'free' ? (
    <div className="flex gap-2">
      <button onClick={() => handleUpgrade('basic')} disabled={billingBusy} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-60">Upgrade to Basic</button>
      <button onClick={() => handleUpgrade('ultra')} disabled={billingBusy} className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white transition disabled:opacity-60">Ultra</button>
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      {tier === 'basic' && (
        <button onClick={() => handleUpgrade('ultra')} disabled={billingBusy} className="w-full py-2.5 rounded-xl text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white transition disabled:opacity-60 flex items-center justify-center gap-2"><Sparkles size={16} /> Upgrade to Ultra</button>
      )}
      <button onClick={handleManageBilling} disabled={billingBusy} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition disabled:opacity-60">Manage subscription</button>
    </div>
  )}
</div>
```

- [ ] **Step 4: Build + manual test** — `npm run build`. Free shows two upgrade buttons; Basic shows "Upgrade to Ultra" + "Manage subscription"; Ultra shows only "Manage subscription".

- [ ] **Step 5: Commit**

```bash
git add components/DashboardScreen.tsx
git commit -m "feat(monetization): dashboard Your Plan card (tier + upgrade/manage)"
```

---

### Task 6: Checkout / portal return handling

**Files:**
- Modify: `App.tsx`

The edge functions redirect back to `APP_URL?checkout=success|cancel` and `APP_URL?portal=return`. Handle those once on load.

- [ ] **Step 1: Add a mount effect in App.tsx** (after `initSession` wiring):

```ts
// Handle returns from Stripe Checkout / Customer Portal: toast + clean the URL.
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  const portal = params.get('portal');
  if (!checkout && !portal) return;
  if (checkout === 'success') flashToast("You're all set — your plan is active.");
  else if (checkout === 'cancel') flashToast('Checkout canceled.');
  else if (portal === 'return') flashToast('Billing updated.');
  // Strip the params so a refresh doesn't re-toast.
  params.delete('checkout'); params.delete('portal');
  const qs = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
}, []);
```

(`useEntitlements` already refetches on window focus/visibility, so the tier updates on return without extra wiring. `flashToast` import confirmed in Task 4.)

- [ ] **Step 2: Build** — `npm run build`.

- [ ] **Step 3: Commit**

```bash
git add App.tsx
git commit -m "feat(monetization): handle Stripe checkout/portal return params"
```

---

## Final verification (after all tasks)
- [ ] `npm run build` passes; `npx vitest run` passes.
- [ ] Dispatch a final code-review subagent over the whole Phase-4 diff.
- [ ] `get-prices` returns live amounts (record them).
- [ ] Push to `main` (authorized) → Actions deploy.
- [ ] Device-test (deferred per user): landing pricing renders with live prices below "How it works"; Free→enter; Basic/Ultra logged-out → login → auto-resume checkout (card 4242); dashboard Your Plan card per tier; checkout-return toast + URL cleanup; Manage subscription opens portal for subscribers, free users never see a broken portal.

## Self-review notes
- **Spec coverage:** landing pricing below How-it-works ✓ (T3/T4), live prices ✓ (T1/T2), dashboard plan card with upgrade/manage ✓ (T5), pick→login→pay funnel ✓ (T4), checkout-return ✓ (T6). English copy ✓.
- **Type consistency:** `tier:'basic'|'ultra'` for paid CTAs everywhere; `PlanPrice`/`Prices` shapes shared via `usePrices`; `ent` is `Readonly<TierEntitlements>`.
- **Redirect safety:** all CTAs go through `startCheckout`/`openBillingPortal` which only navigate on a real URL and surface errors as toasts.
- **No DB change.** `get-prices` reuses Phase-2 secrets. Anonymous users who tap a paid CTA get LOGIN_REQUIRED → friendly toast, never a broken redirect.
- **Out of scope (Phase 5):** prices inside UpgradeModal, annual plans, lock-flash polish, scroll-reveal animation on the pricing cards.
