# Monetization Phase 3 — Client Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client tier-aware — fetch the signed-in user's effective tier, gray out premium controls before the user hits a wall, and translate the Phase-1 server errors (QT001–QT004) into English prompts with an Upgrade CTA that opens Stripe Checkout.

**Architecture:** A `useEntitlements(uid)` hook resolves the user's tier from the `subscriptions` table (RLS read-own) via the existing `resolveTier()` mirror. `ChatScreen` (the room hub) and `DashboardScreen` consume it and pass `ent` (the `TierEntitlements` object) + an `onUpgrade(featureLabel, requiredTier)` callback down to the premium surfaces (`ChatInput`, `RoomInfoModal`, `CallManager`). A single shared `UpgradeModal` renders the upsell and calls a new `startCheckout()` helper. A pure `parseTierError()` util maps thrown Supabase errors to `{ code, requiredTier, message }`. **Defense-in-depth:** UI pre-gates (gray-out) avoid round-trips; the server remains authoritative and any QT00x that slips through is caught and surfaced. **Calls (audio/video/screenshare) have NO server backstop** — the client gate is the only enforcement (per-viewer, by design from the spec).

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind, `@supabase/supabase-js` v2, lucide-react, vitest. No new dependencies.

---

## Server contract (verified live 2026-06-15 from the Phase-1 functions)

Supabase-js surfaces the SQLSTATE on `error.code` and the `RAISE` text on `error.message`:

| Code | `error.message` | Raised by | Required tier |
|------|-----------------|-----------|---------------|
| `QT001` | `ROOM_LOCKED` | `enforce_message_quota` (message INSERT into a locked room) | next tier up |
| `QT002` | `QUOTA_EXCEEDED:<currentTier>` (e.g. `QUOTA_EXCEEDED:free`) | `enforce_message_quota` (message INSERT) | next tier up |
| `QT003` | `ROOM_LIMIT:<currentTier>` (e.g. `ROOM_LIMIT:free`) | `join_or_create_room` (CREATE only) | next tier up |
| `QT004` | `TIER_REQUIRED:ai` | `enforce_room_tier` (rooms UPDATE of `ai_enabled=true`/`ai_avatar_url`) | **ultra** |
| `QT004` | `TIER_REQUIRED:basic` | `enforce_room_tier` (rooms UPDATE of ttl/auto_delete/avatar/background/display_name when tier=`free`) | **basic** |

Notes that shape this plan:
- QT004's suffix is `ai` or `basic` — it encodes the **required tier**, NOT a feature name. The calling component supplies the human `featureLabel`; the error only confirms which tier is needed.
- The `enforce_room_tier` "basic group" only fires when the actor's tier is `free` (a `basic` user editing appearance/ttl is allowed). The "ai group" fires for any non-`ultra` tier.
- **Audio/video/screen-share are NOT server-enforced** (no gated DB write — WebRTC signaling only). Gray-out in `CallManager` IS the enforcement.

---

## File Structure

**Create:**
- `utils/tierGatingErrors.ts` — pure `parseTierError(err, currentTier)` → `TierError | null`.
- `utils/tierGatingErrors.test.ts` — vitest unit tests.
- `hooks/useEntitlements.ts` — `useEntitlements(uid)` → `{ tier, ent, loading, refresh }`.
- `components/UpgradeModal.tsx` — shared upsell modal + Stripe Checkout CTA.

**Modify:**
- `services/supabase.ts` — add `startCheckout()` / `openBillingPortal()` helpers; extend `JoinRoomErrorCode` with `'ROOM_LIMIT'`.
- `components/ChatScreen.tsx` — consume `useEntitlements`, hold central upgrade-modal state, surface QT001/QT002 on send, pass `ent`/`onUpgrade` to children, handle QT004 in `handleToggleAI`, QT003 in `initRoom`.
- `components/ChatInput.tsx` — tier-aware max file size (replace hardcoded 40MB).
- `components/RoomInfoModal.tsx` — gray out appearance/disappearing/auto-delete/AI rows by `ent`.
- `components/RoomAppearanceModal.tsx`, `EphemeralModal.tsx`, `RoomExpiryModal.tsx`, `AiAvatarModal.tsx` — parse QT004 in their catch blocks → `onUpgrade`.
- `components/CallManager.tsx` — gate audio (Basic+) / video + screenshare (Ultra) buttons.
- `components/DashboardScreen.tsx` — consume `useEntitlements`, pre-check `maxRooms` before create, surface QT003.

**Verification commands (confirm against `package.json`):**
- Unit tests: `npx vitest run <file>`
- Type-check + build: `npm run build`

---

### Task 1: Tier-gating error parser (pure, TDD)

**Files:**
- Create: `utils/tierGatingErrors.ts`
- Test: `utils/tierGatingErrors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// utils/tierGatingErrors.test.ts
import { describe, it, expect } from 'vitest';
import { parseTierError } from './tierGatingErrors';

describe('parseTierError', () => {
  it('returns null for a non-tier error', () => {
    expect(parseTierError({ code: '23505', message: 'duplicate key' }, 'free')).toBeNull();
    expect(parseTierError(null, 'free')).toBeNull();
  });

  it('maps QT001 ROOM_LOCKED via error.code', () => {
    const r = parseTierError({ code: 'QT001', message: 'ROOM_LOCKED' }, 'free');
    expect(r?.code).toBe('QT001');
    expect(r?.requiredTier).toBe('basic');
    expect(r?.message).toMatch(/read-only/i);
  });

  it('maps QT002 and upsells to the next tier from currentTier', () => {
    expect(parseTierError({ code: 'QT002', message: 'QUOTA_EXCEEDED:free' }, 'free')?.requiredTier).toBe('basic');
    expect(parseTierError({ code: 'QT002', message: 'QUOTA_EXCEEDED:basic' }, 'basic')?.requiredTier).toBe('ultra');
  });

  it('maps QT003 ROOM_LIMIT', () => {
    const r = parseTierError({ code: 'QT003', message: 'ROOM_LIMIT:free' }, 'free');
    expect(r?.code).toBe('QT003');
    expect(r?.requiredTier).toBe('basic');
  });

  it('maps QT004 ai -> ultra and basic -> basic', () => {
    expect(parseTierError({ code: 'QT004', message: 'TIER_REQUIRED:ai' }, 'free')?.requiredTier).toBe('ultra');
    expect(parseTierError({ code: 'QT004', message: 'TIER_REQUIRED:basic' }, 'free')?.requiredTier).toBe('basic');
  });

  it('falls back to message matching when error.code is absent', () => {
    expect(parseTierError({ message: 'QUOTA_EXCEEDED:free' }, 'free')?.code).toBe('QT002');
    expect(parseTierError({ message: 'TIER_REQUIRED:ai' }, 'free')?.code).toBe('QT004');
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run utils/tierGatingErrors.test.ts`
Expected: FAIL — `parseTierError` not found.

- [ ] **Step 3: Implement `utils/tierGatingErrors.ts`**

```ts
// Translates Phase-1 server tier-gating errors (stable Postgres SQLSTATEs) into
// English copy + the tier the user must upgrade to. The DB is the authoritative
// gate; this only formats what the server already enforced.
//
// Server contract (verified): supabase-js puts the SQLSTATE on error.code and the
// RAISE text on error.message:
//   QT001  "ROOM_LOCKED"
//   QT002  "QUOTA_EXCEEDED:<currentTier>"
//   QT003  "ROOM_LIMIT:<currentTier>"
//   QT004  "TIER_REQUIRED:ai"    -> needs ultra
//          "TIER_REQUIRED:basic" -> needs basic
import { Tier } from './entitlements';

export type TierErrorCode = 'QT001' | 'QT002' | 'QT003' | 'QT004';

export interface TierError {
  code: TierErrorCode;
  requiredTier: 'basic' | 'ultra'; // tier the user must reach to proceed
  message: string;                 // English, ready to show
}

const QT_CODES: TierErrorCode[] = ['QT001', 'QT002', 'QT003', 'QT004'];

// Next paid tier up from the user's current tier (quota / room-limit upsell).
function nextTierUp(current: Tier): 'basic' | 'ultra' {
  return current === 'free' ? 'basic' : 'ultra';
}

function extractCode(err: any): TierErrorCode | null {
  const raw = (err?.code ?? '').toString().toUpperCase();
  if ((QT_CODES as string[]).includes(raw)) return raw as TierErrorCode;
  const msg = (err?.message ?? '').toString().toUpperCase();
  for (const c of QT_CODES) if (msg.includes(c)) return c;
  // message-only fallbacks (in case the SQLSTATE is stripped upstream)
  if (msg.includes('ROOM_LOCKED')) return 'QT001';
  if (msg.includes('QUOTA_EXCEEDED')) return 'QT002';
  if (msg.includes('ROOM_LIMIT')) return 'QT003';
  if (msg.includes('TIER_REQUIRED')) return 'QT004';
  return null;
}

// Parse a thrown error. `currentTier` lets quota/room-limit errors point at the
// right upsell tier. Returns null if the error is not a tier-gating error.
export function parseTierError(err: any, currentTier: Tier = 'free'): TierError | null {
  const code = extractCode(err);
  if (!code) return null;
  const msg = (err?.message ?? '').toString();

  if (code === 'QT001') {
    return { code, requiredTier: nextTierUp(currentTier), message: 'This room is read-only. Upgrade to send messages again.' };
  }
  if (code === 'QT002') {
    return { code, requiredTier: nextTierUp(currentTier), message: "You've reached today's message limit in this room. Upgrade to send more." };
  }
  if (code === 'QT003') {
    return { code, requiredTier: nextTierUp(currentTier), message: "You've reached your room limit. Upgrade to create more rooms." };
  }
  // QT004 — suffix encodes the required tier directly ('ai' => ultra, else basic).
  const needsUltra = /TIER_REQUIRED:\s*ai/i.test(msg);
  const req: 'basic' | 'ultra' = needsUltra ? 'ultra' : 'basic';
  return { code, requiredTier: req, message: `This feature is available on ${req === 'ultra' ? 'Ultra' : 'Basic'}.` };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run utils/tierGatingErrors.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add utils/tierGatingErrors.ts utils/tierGatingErrors.test.ts
git commit -m "feat(monetization): tier-gating error parser (QT001-QT004 -> English)"
```

---

### Task 2: Stripe Checkout / Portal client helpers + ROOM_LIMIT code

**Files:**
- Modify: `services/supabase.ts`

- [ ] **Step 1: Extend `JoinRoomErrorCode` and its parser for ROOM_LIMIT**

In `services/supabase.ts`, change line 35:

```ts
export type JoinRoomErrorCode = 'WRONG_PIN' | 'ROOM_DELETED' | 'AUTH_REQUIRED' | 'ROOM_LIMIT' | 'UNKNOWN';
```

And inside the `joinOrCreateRoom` error block (after the `AUTH_REQUIRED` line, ~line 57) add:

```ts
    else if (msg.includes('ROOM_LIMIT')) code = 'ROOM_LIMIT';
```

- [ ] **Step 2: Append the checkout/portal helpers at the end of `services/supabase.ts`**

```ts
// --- Billing (Phase 2 edge functions) ---
// CRITICAL: only navigate when the function returned a real URL. supabase-js sets
// `error` (FunctionsHttpError) on a non-2xx response, but our functions still
// return a JSON error body (LOGIN_REQUIRED / NO_SUBSCRIPTION / STRIPE_NOT_CONFIGURED).
// We surface that string so the caller can toast it, and never blind-redirect.
export interface BillingResult { ok: boolean; error?: string; }

async function readFnError(error: any): Promise<string> {
  try {
    const payload = await error?.context?.json?.();
    if (payload?.error) return payload.error as string;
  } catch { /* response body was not JSON */ }
  return error?.message || 'REQUEST_FAILED';
}

// Start Stripe Checkout (subscription mode) for a paid tier. Redirects on success.
export async function startCheckout(tier: 'basic' | 'ultra'): Promise<BillingResult> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { tier } });
  if (error) return { ok: false, error: await readFnError(error) };
  const url = (data as any)?.url;
  if (!url) return { ok: false, error: (data as any)?.error || 'NO_CHECKOUT_URL' };
  window.location.href = url;
  return { ok: true };
}

// Open the Stripe Customer Portal. Free users have no subscription -> the function
// returns 404 NO_SUBSCRIPTION; the caller decides what to show.
export async function openBillingPortal(): Promise<BillingResult> {
  const { data, error } = await supabase.functions.invoke('create-portal-session', { body: {} });
  if (error) return { ok: false, error: await readFnError(error) };
  const url = (data as any)?.url;
  if (!url) return { ok: false, error: (data as any)?.error || 'NO_PORTAL_URL' };
  window.location.href = url;
  return { ok: true };
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add services/supabase.ts
git commit -m "feat(monetization): startCheckout/openBillingPortal helpers + ROOM_LIMIT code"
```

---

### Task 3: `useEntitlements` hook

**Files:**
- Create: `hooks/useEntitlements.ts`

- [ ] **Step 1: Implement the hook**

```ts
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

  const refresh = useCallback(async () => {
    const u = uidRef.current;
    if (!u) { setTier('free'); setLoading(false); return; }
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

  return { tier, ent: entitlements(tier), loading, refresh: () => { void refresh(); } };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add hooks/useEntitlements.ts
git commit -m "feat(monetization): useEntitlements hook (resolve tier from subscriptions)"
```

---

### Task 4: `UpgradeModal` component

**Files:**
- Create: `components/UpgradeModal.tsx`

Follows the existing modal pattern (`MicErrorModal.tsx`: createPortal + `useModalA11y` + zoom-in card + single primary CTA). z-index `[115]` so it sits above the `z-[100]` settings modals it can be triggered from, below the `z-[200]` toasts.

- [ ] **Step 1: Implement the component**

```tsx
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Lock, Loader2 } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import { Tier } from '../utils/entitlements';
import { startCheckout } from '../services/supabase';
import { flashToast } from './MessageActionMenu';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  requiredTier: 'basic' | 'ultra';
  currentTier: Tier;
  featureLabel: string; // e.g. "Video calls", "Inco AI", "Room appearance"
  reason?: string;      // optional extra sentence
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const UpgradeModal: React.FC<UpgradeModalProps> = ({ open, onClose, requiredTier, featureLabel, reason }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  useModalA11y(open, onClose, dialogRef);
  if (!open) return null;

  const tierName = cap(requiredTier);
  const isUltra = requiredTier === 'ultra';

  const handleUpgrade = async () => {
    if (busy) return;
    setBusy(true);
    const res = await startCheckout(requiredTier);
    if (!res.ok) {
      setBusy(false);
      if (res.error === 'LOGIN_REQUIRED') flashToast('Please sign in with Google to upgrade.');
      else flashToast('Could not start checkout. Please try again.');
    }
    // On success the browser navigates to Stripe; keep busy=true.
  };

  return createPortal(
    <div className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Upgrade to ${tierName}`}
        className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className={`flex items-center justify-center w-11 h-11 rounded-full shrink-0 ${isUltra ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}`}>
              {isUltra ? <Sparkles size={22} /> : <Lock size={22} />}
            </span>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Upgrade to {tierName}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 -mt-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 mb-6">
          {featureLabel} is available on {tierName}.{reason ? ` ${reason}` : ''}
        </p>
        <button
          onClick={handleUpgrade}
          disabled={busy}
          className={`w-full py-2.5 rounded-xl text-sm font-bold text-white transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 ${isUltra ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {busy ? 'Redirecting…' : `Upgrade to ${tierName}`}
        </button>
        <button onClick={onClose} className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
          Maybe later
        </button>
      </div>
    </div>,
    document.body
  );
};

export default UpgradeModal;
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/UpgradeModal.tsx
git commit -m "feat(monetization): shared UpgradeModal with Stripe Checkout CTA"
```

---

### Task 5: Wire entitlements + UpgradeModal into ChatScreen (plumbing)

**Files:**
- Modify: `components/ChatScreen.tsx`

This task only plumbs tier/entitlements + a central upgrade modal through `ChatScreen`. Feature behavior is added in Tasks 6–9. After this task the app builds and behaves exactly as before (no gating active yet) except the modal exists.

- [ ] **Step 1: Add imports** (top of `ChatScreen.tsx`, near the other component/hook imports)

```ts
import { useEntitlements } from '../hooks/useEntitlements';
import UpgradeModal from './UpgradeModal';
import { Tier } from '../utils/entitlements';
```

- [ ] **Step 2: Resolve tier + add upgrade-modal state**

Inside the `ChatScreen` component, after `user` state is available (the `checkUser()` effect sets `user`; `user?.uid` feeds the hook), add:

```ts
const { tier, ent } = useEntitlements(user?.uid);

const [upgradePrompt, setUpgradePrompt] = useState<
  { featureLabel: string; requiredTier: 'basic' | 'ultra'; reason?: string } | null
>(null);

// Stable callback passed to premium surfaces.
const promptUpgrade = useCallback(
  (featureLabel: string, requiredTier: 'basic' | 'ultra', reason?: string) =>
    setUpgradePrompt({ featureLabel, requiredTier, reason }),
  []
);
```

(`useCallback` is already imported in this file; if not, add it to the React import.)

- [ ] **Step 3: Render the modal** near the other modals/portals at the end of the returned JSX (e.g. alongside where `RoomDeletedToast` / settings modals render):

```tsx
<UpgradeModal
  open={!!upgradePrompt}
  onClose={() => setUpgradePrompt(null)}
  requiredTier={upgradePrompt?.requiredTier ?? 'basic'}
  currentTier={tier}
  featureLabel={upgradePrompt?.featureLabel ?? ''}
  reason={upgradePrompt?.reason}
/>
```

- [ ] **Step 4: Pass props to the three premium surfaces (signatures wired now, consumed in later tasks)**

In the `<ChatInput ... />` render, add prop:

```tsx
maxFileBytes={ent.maxFileBytes}
```

In the `<RoomInfoModal ... />` render, add props:

```tsx
ent={ent}
onUpgrade={promptUpgrade}
```

In the `<CallManager ... />` render (around line 1208), add props:

```tsx
ent={ent}
onUpgrade={promptUpgrade}
```

(These props are declared as optional in Tasks 6/8/9 to keep each task independently buildable. To keep THIS task green, add the optional prop declarations now — see Step 5.)

- [ ] **Step 5: Add the optional prop declarations so the build passes now**

- In `components/ChatInput.tsx` `ChatInputProps`, add: `maxFileBytes?: number;` and destructure `maxFileBytes` (default unused this task).
- In `components/RoomInfoModal.tsx` props interface, add:
  ```ts
  ent?: import('../utils/entitlements').TierEntitlements;
  onUpgrade?: (featureLabel: string, requiredTier: 'basic' | 'ultra', reason?: string) => void;
  ```
- In `components/CallManager.tsx` `CallManagerProps`, add the same two optional props.

- [ ] **Step 6: Verify build + manual smoke**

Run: `npm run build`
Expected: PASS. App behaves as before; no gating yet.

- [ ] **Step 7: Commit**

```bash
git add components/ChatScreen.tsx components/ChatInput.tsx components/RoomInfoModal.tsx components/CallManager.tsx
git commit -m "feat(monetization): plumb tier + UpgradeModal through ChatScreen"
```

---

### Task 6: Tier-aware file-size limit in ChatInput

**Files:**
- Modify: `components/ChatInput.tsx` (`MAX_FILE_SIZE` at line 43, `handleFileSelect` at lines 130–134)

- [ ] **Step 1: Use the prop instead of the hardcoded constant**

Replace the hardcoded check at lines 130–134. Inside `handleFileSelect`, compute the limit from the prop (fallback to 40MB if the prop is absent), and word the alert per tier:

```ts
const limitBytes = maxFileBytes ?? 40 * 1024 * 1024;
if (file.size > limitBytes) {
  const limitMb = Math.round(limitBytes / (1024 * 1024));
  alert(
    `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Your plan allows up to ${limitMb}MB.` +
    (limitBytes < 40 * 1024 * 1024 ? ' Upgrade to Ultra for 40MB uploads.' : '')
  );
  if (fileInputRef.current) fileInputRef.current.value = '';
  return;
}
```

Leave the module-level `const MAX_FILE_SIZE` only if still referenced elsewhere; otherwise remove it to avoid a dead constant.

- [ ] **Step 2: Verify build + manual test**

Run: `npm run build`
Expected: PASS.
Manual (device): as a free user, attaching a >10MB file shows the "up to 10MB … Upgrade to Ultra" alert; as Ultra, up to 40MB is accepted.

- [ ] **Step 3: Commit**

```bash
git add components/ChatInput.tsx
git commit -m "feat(monetization): tier-aware upload size limit in ChatInput"
```

---

### Task 7: Surface QT001 / QT002 on message send

**Files:**
- Modify: `components/ChatScreen.tsx` (`handleSend` catch block, ~lines 838–858)

`sendMessage`/`uploadFile` already rethrow the Supabase error; `handleSend` catches it and restores composer state. Add tier-error surfacing there.

- [ ] **Step 1: Add imports** (if not already present from Task 5)

```ts
import { parseTierError } from '../utils/tierGatingErrors';
import { flashToast } from './MessageActionMenu';
```

- [ ] **Step 2: Inspect the error in the catch block**

In the existing `catch (err) { ... }` of `handleSend` (after restoring composer state), add:

```ts
const tierErr = parseTierError(err, tier);
if (tierErr) {
  if (tierErr.code === 'QT004') {
    promptUpgrade('Inco AI', tierErr.requiredTier);
  } else {
    // QT001 (room read-only) and QT002 (daily quota) are transient/informational.
    flashToast(tierErr.message);
  }
}
```

(QT004 won't normally come from a plain text send — it covers AI-message paths; keeping the branch is harmless and future-proof.)

- [ ] **Step 3: Verify build + manual test**

Run: `npm run build`
Expected: PASS.
Manual (device): as a free user, send 11 messages in one room → the 11th shows the "today's message limit … Upgrade" toast and the composer text is preserved.

- [ ] **Step 4: Commit**

```bash
git add components/ChatScreen.tsx
git commit -m "feat(monetization): surface QT001/QT002 on send via tier-error toast"
```

---

### Task 8: Room-settings gating (RoomInfoModal + sub-modals + AI toggle)

**Files:**
- Modify: `components/RoomInfoModal.tsx` (rows at lines 152–203)
- Modify: `components/RoomAppearanceModal.tsx` (catch ~84–86)
- Modify: `components/EphemeralModal.tsx` (catch ~53–55)
- Modify: `components/RoomExpiryModal.tsx` (catch ~46–48)
- Modify: `components/AiAvatarModal.tsx` (catch ~73–75)
- Modify: `components/ChatScreen.tsx` (`handleToggleAI` catch ~1084–1086)

**Gating map (from `TIER_CONFIG`):** Room appearance, Disappearing messages, Auto-delete → `ent.canRoomAppearance` / `ent.canDisappearing` (Basic+). Inco AI assistant + Customize AI look → `ent.canAI` (Ultra).

- [ ] **Step 1: Gray out gated rows in `RoomInfoModal`**

`ent` + `onUpgrade` are already optional props (Task 5). Add a small locked-row helper near the `Row` component, then gate each row. Locked rows show a `Lock` icon trailing and, on click, call `onUpgrade` instead of opening the modal.

Add a `locked` affordance to the existing `Row` usage. Example for the appearance row (line ~172):

```tsx
{canManage && (
  ent && !ent.canRoomAppearance
    ? <Row icon={<Palette size={18} />} label="Room appearance"
        trailing={<Lock size={16} className="text-slate-300 dark:text-slate-600" />}
        onClick={() => { onClose(); onUpgrade?.('Room appearance', 'basic'); }} />
    : <Row icon={<Palette size={18} />} label="Room appearance" onClick={() => go(onOpenRoomAppearance)} />
)}
```

Apply the same pattern to:
- Disappearing messages row (line ~178) → `ent.canDisappearing`, `onUpgrade('Disappearing messages', 'basic')`.
- Auto-delete room row (line ~190) → `ent.canDisappearing`, `onUpgrade('Auto-delete', 'basic')`.
- Inco AI assistant row + Customize AI look (lines ~152–168) → `ent.canAI`, `onUpgrade('Inco AI', 'ultra')`.

`Lock` is already imported in `RoomInfoModal.tsx` (per the import line). When `ent` is undefined (not yet resolved) treat as allowed (don't flash a lock during load) — i.e. only show locked state when `ent && !ent.canX`.

- [ ] **Step 2: Backstop — parse QT004 in each sub-modal's catch**

Each sub-modal currently does `catch (e) { console.error(e); alert('Failed to …'); }`. Add an `onUpgrade?` prop to each (wired from `ChatScreen`, see Step 4) and translate QT004 before the generic alert. Pattern (RoomAppearanceModal example):

```ts
import { parseTierError } from '../utils/tierGatingErrors';
// ...
} catch (e) {
  console.error(e);
  const tierErr = parseTierError(e);
  if (tierErr?.code === 'QT004' && onUpgrade) {
    onClose();
    onUpgrade('Room appearance', tierErr.requiredTier);
  } else {
    alert('Failed to save room appearance');
  }
}
```

Repeat with the right `featureLabel`:
- `EphemeralModal` → `'Disappearing messages'`
- `RoomExpiryModal` → `'Auto-delete'`
- `AiAvatarModal` → `'Inco AI'`

Add `onUpgrade?: (featureLabel: string, requiredTier: 'basic' | 'ultra', reason?: string) => void;` to each modal's props.

- [ ] **Step 3: Handle QT004 in `handleToggleAI` (ChatScreen ~1084)**

Replace the catch body:

```ts
} catch (e) {
  console.error('Failed to toggle AI', e);
  const tierErr = parseTierError(e, tier);
  if (tierErr?.code === 'QT004') promptUpgrade('Inco AI', tierErr.requiredTier);
  else flashToast('Could not change Inco. Please try again.');
}
```

- [ ] **Step 4: Wire `onUpgrade` to the sub-modals in `ChatScreen`**

Where each sub-modal is rendered (`<RoomAppearanceModal/>`, `<EphemeralModal/>`, `<RoomExpiryModal/>`, `<AiAvatarModal/>`), add `onUpgrade={promptUpgrade}`.

- [ ] **Step 5: Verify build + manual test**

Run: `npm run build`
Expected: PASS.
Manual (device): free user → appearance/disappearing/auto-delete/AI rows show a lock and open the UpgradeModal (Basic for the first three, Ultra for AI). Basic user → appearance/disappearing/auto-delete work; AI row shows lock → Ultra. Ultra → everything works.

- [ ] **Step 6: Commit**

```bash
git add components/RoomInfoModal.tsx components/RoomAppearanceModal.tsx components/EphemeralModal.tsx components/RoomExpiryModal.tsx components/AiAvatarModal.tsx components/ChatScreen.tsx
git commit -m "feat(monetization): gate room settings (appearance/TTL/auto-delete/AI) by tier"
```

---

### Task 9: Calls gating (audio = Basic+, video + screenshare = Ultra)

**Files:**
- Modify: `components/CallManager.tsx` (call buttons ~473–479 group, ~504–509 1-on-1; screen-share ~414–422; `beginCall` ~235)

**No server backstop exists for calls — this client gate IS the enforcement.** Gate at `beginCall` and the screen-share button so the OS media prompt never fires for a disallowed call.

- [ ] **Step 1: Use `ent` + `onUpgrade` (already optional props from Task 5)**

Add a guard helper inside `CallManager`:

```ts
// Returns true if allowed; otherwise opens the upgrade prompt and returns false.
const gateCall = (type: CallType): boolean => {
  if (!ent) return true; // entitlements not resolved yet -> don't block
  if (type === 'audio' && !ent.canAudioCall) { onUpgrade?.('Audio calls', 'basic'); return false; }
  if (type === 'video' && !ent.canVideoCall) { onUpgrade?.('Video calls', 'ultra'); return false; }
  return true;
};
```

Update `beginCall` (line ~235):

```ts
const beginCall = (type: CallType, targetUid?: string) => {
  if (!gateCall(type)) return;
  onCloseParticipants();
  startCall(type, targetUid);
};
```

- [ ] **Step 2: Show locked affordance on the call buttons**

For the group + 1-on-1 audio/video buttons, when the tier forbids them add disabled styling and a small lock so the gate is visible (the click still routes through `gateCall` → upgrade). Example for the group video button (~476):

```tsx
<button
  onClick={() => beginCall('video')}
  className={`... ${ent && !ent.canVideoCall ? 'opacity-50' : ''}`}
  title={ent && !ent.canVideoCall ? 'Video calls are an Ultra feature' : 'Video'}
>
  <Video size={14} /> Video {ent && !ent.canVideoCall && <Lock size={12} className="ml-1" />}
</button>
```

Apply the same to: group audio (~473, `canAudioCall`/Basic), 1-on-1 audio (~504), 1-on-1 video (~507). Import `Lock` from lucide-react if not present.

- [ ] **Step 3: Gate screen share before `getDisplayMedia`**

The screen-share button is wrapped in `{canShareScreen && (...)}` (line ~414). Define `canShareScreen` from entitlements (replace/AND the existing source):

```ts
const canShareScreen = !!ent?.canScreenShare; // Ultra only; no server backstop
```

If you want the button visible-but-locked instead of hidden, render it always and route a disallowed click to `onUpgrade?.('Screen sharing', 'ultra')`. Hidden-when-not-allowed is acceptable for parity with current behavior; pick hidden to minimize churn. Confirm where `canShareScreen` is currently defined and converge it to the entitlements value.

- [ ] **Step 4: Verify build + manual test**

Run: `npm run build`
Expected: PASS.
Manual (device): free → audio/video buttons show lock → UpgradeModal (audio=Basic, video=Ultra), and no mic/cam prompt fires. Basic → audio works, video shows lock→Ultra, screen-share hidden/locked. Ultra → audio + video + screen share all work.

- [ ] **Step 5: Commit**

```bash
git add components/CallManager.tsx
git commit -m "feat(monetization): gate audio (Basic) / video + screenshare (Ultra) calls"
```

---

### Task 10: Room-creation gating in DashboardScreen

**Files:**
- Modify: `components/DashboardScreen.tsx` (`initData`/room load ~460–549; `handleCreateOrJoinRoom` ~984–1027; `recreateRoom` ~905–909)

The server enforces QT003 on CREATE in `join_or_create_room`. Add a UI pre-check (avoid the round-trip when a free user is already at the cap) plus QT003 surfacing as a backstop.

- [ ] **Step 1: Add imports + resolve tier**

```ts
import { useEntitlements } from '../hooks/useEntitlements';
import UpgradeModal from './UpgradeModal';
```

In the component: `const { tier, ent } = useEntitlements(user?.uid);` (`user.uid` is available in this screen). Add upgrade-modal state mirroring ChatScreen:

```ts
const [upgradePrompt, setUpgradePrompt] = useState<{ featureLabel: string; requiredTier: 'basic' | 'ultra' } | null>(null);
```

Render `<UpgradeModal open={!!upgradePrompt} onClose={() => setUpgradePrompt(null)} requiredTier={upgradePrompt?.requiredTier ?? 'basic'} currentTier={tier} featureLabel={upgradePrompt?.featureLabel ?? ''} />` once.

- [ ] **Step 2: Determine owned-room count**

The screen already loads owned rooms (`from('rooms').eq('created_by', user.uid)`). Compute the count of currently-active owned rooms (non-expired) into a variable, e.g. `ownedActiveCount`. (Reuse the already-fetched owned rooms list; the server counts non-expired owned rooms, so for the UI pre-check counting owned rooms is sufficient — the server remains authoritative.)

- [ ] **Step 3: Pre-check before create**

In `handleCreateOrJoinRoom`, when the action is a CREATE (new room) and `ent.maxRooms !== null && ownedActiveCount >= ent.maxRooms`, short-circuit:

```ts
if (ent.maxRooms !== null && ownedActiveCount >= ent.maxRooms) {
  setUpgradePrompt({ featureLabel: 'More rooms', requiredTier: tier === 'free' ? 'basic' : 'ultra' });
  return;
}
```

Place this AFTER name/PIN validation but BEFORE calling `joinOrCreateRoom`. Only gate creation — joining an existing room must not be blocked (the cap is CREATE-only server-side).

- [ ] **Step 4: Backstop — surface QT003 from `joinOrCreateRoom`**

Where `joinOrCreateRoom` is called (create path + `recreateRoom` ~905), handle the new `ROOM_LIMIT` code:

```ts
if (error?.code === 'ROOM_LIMIT') {
  setUpgradePrompt({ featureLabel: 'More rooms', requiredTier: tier === 'free' ? 'basic' : 'ultra' });
  return;
}
```

(Place before the generic `alert('Could not …')`.)

- [ ] **Step 5: Verify build + manual test**

Run: `npm run build`
Expected: PASS.
Manual (device): free user with 1 active owned room → creating a 2nd room opens the UpgradeModal (Basic); joining someone else's room still works. Basic at 10 owned rooms → 11th opens UpgradeModal (Ultra).

- [ ] **Step 6: Commit**

```bash
git add components/DashboardScreen.tsx
git commit -m "feat(monetization): gate room creation by tier (pre-check + QT003 backstop)"
```

---

## Final verification (after all tasks)

- [ ] `npm run build` passes.
- [ ] `npx vitest run` passes (entitlements + tierGatingErrors).
- [ ] Dispatch a final code-review subagent over the whole Phase-3 diff.
- [ ] Push to `main` (authorized) → GitHub Actions deploy.
- [ ] Device test matrix (real iPhone + desktop), per tier:
  - **Free:** 10 msgs/room/day cap toast; appearance/disappearing/auto-delete/AI rows locked; audio/video locked; 2nd room creation locked; >10MB upload blocked.
  - **Basic:** 100 msgs/day; appearance/disappearing/auto-delete work; AI locked (Ultra); audio works, video + screenshare locked; 11th room locked; >10MB upload blocked.
  - **Ultra:** everything unlocked; up to 40MB upload.
  - **Upgrade CTA** opens Stripe Checkout (never blind-redirects on error); anonymous user sees "sign in to upgrade".

---

## Self-review notes

- **Spec coverage:** useEntitlements ✓ (T3), UpgradeModal ✓ (T4), ChatInput gate ✓ (T6), RoomInfoModal gate ✓ (T8), CallManager gate ✓ (T9), QT001–QT004 → English ✓ (T1/T7/T8/T10), check `error` before redirect ✓ (T2 `startCheckout`/`openBillingPortal`). Dashboard room-cap ✓ (T10).
- **Type consistency:** `ent` is `Readonly<TierEntitlements>` everywhere; `requiredTier` is `'basic' | 'ultra'` everywhere; `onUpgrade` signature identical across ChatScreen/RoomInfoModal/CallManager/sub-modals.
- **No DB change required** — Phase 3 is client-only. `subscriptions` reads use the existing read-own RLS.
- **Out of scope (Phase 4):** landing pricing page + dashboard "Your Plan"/billing section (uses `openBillingPortal`). Realtime subscription-row updates (focus-refetch is sufficient for now). Per-room message-quota live counter UI.
