# Monetization Phase 5 — Polish Implementation Plan (final)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Final polish on the monetization UX: stop the entitlement "lock-flash" for paying users, make screen-share a visible-but-locked upsell (instead of silently hidden), show live prices inside the UpgradeModal, and add a per-room daily message-quota counter.

**Architecture:** `useEntitlements` already returns `loading`; thread it through as `entLoading` so gated UI shows neither a lock nor an enabled-then-disabled flicker until the tier resolves. A small read-only SECURITY DEFINER RPC `messages_sent_today(room_key)` (reusing the quota trigger's exact Europe/Athens day expression) feeds a `useMessageQuota` hook that drives a subtle "N messages left today" counter in the composer. UpgradeModal reuses `usePrices` for the live price line.

**Tech Stack:** React 18 + TS, Vite, Tailwind, lucide-react, `@supabase/supabase-js` v2, Postgres (one read-only RPC). No new deps.

---

## Key facts (verified 2026-06-15)
- `useEntitlements(uid)` returns `{ tier, ent, loading, refresh }`. **`ent` is ALWAYS defined** (`entitlements(tier)`, tier defaults `'free'`) — so the existing `!ent` / `ent && …` guards never see undefined. During the load window `tier='free'`, so paying users briefly see free-tier locks. The correct guard is the `loading` flag, not `ent`.
- ChatScreen: `useEntitlements` destructure at **line 93** (`const { tier, ent } = …`); `<CallManager>` props at **1250–1251** (`ent={ent} onUpgrade={promptUpgrade}`); `<ChatInput>` at **1381** (`maxFileBytes={ent.maxFileBytes}`); `<RoomInfoModal>` at **1479–1480**; `<UpgradeModal>` at **1491–1497**; `handleSend` success point after `await sendMessage(...)` at **~line 866** (before `notifySubscribers`).
- CallManager: `canShareScreen` at **line 215** (`getDisplayMediaSupported() && (!ent || ent.canScreenShare)`); screen-share button `{canShareScreen && (...)}` at **429–438**; `gateCall`/`beginCall` at **241–253** (gateCall returns true when `!ent` — dead branch, replace with `entLoading`); props destructure at **198**; `getDisplayMediaSupported` imported at line 5 from `../utils/helpers`.
- RoomInfoModal: five locked rows at **160–249** using `ent && !ent.canX ? <locked> : <normal>`; props interface `ent?`/`onUpgrade?` at **34–35**; `lockedTrailing` helper already defined.
- ChatInput: typing-label block at **199–208** (good counter location); `ChatInputProps` at **9–44**.
- UpgradeModal: body paragraph at **62–64**.
- DashboardScreen: `const { tier, ent } = useEntitlements(user?.uid)` at **line 343**; "Your Plan" card rendered in the left sidebar (added Phase 4).
- Quota trigger day expression (reuse verbatim): `(date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens')`. `messages.uid` is `text`; `auth.uid()` is uuid → cast `::text`.

**Verification:** unit `npx vitest run`; build `npm run build`; RPC via Supabase `apply_migration` MCP tool + a read-only `execute_sql` check.

---

### Task 1: Lock-flash suppression (entLoading)

**Files:**
- Modify: `components/ChatScreen.tsx`
- Modify: `components/RoomInfoModal.tsx`
- Modify: `components/CallManager.tsx` (prop declaration + pass-through only; consumption in Task 2)
- Modify: `components/DashboardScreen.tsx`

- [ ] **Step 1: ChatScreen — pull `loading` and pass it down**

Change line 93:
```ts
const { tier, ent, loading: entLoading } = useEntitlements(user?.uid);
```
Add `entLoading={entLoading}` to the `<RoomInfoModal .../>` (line ~1479) and `<CallManager .../>` (line ~1250) renders.

- [ ] **Step 2: RoomInfoModal — declare prop + guard the five locks**

In `RoomInfoModalProps` (line ~34) add:
```ts
  entLoading?: boolean;
```
Destructure `entLoading`. Change each of the five lock conditionals from `ent && !ent.canX` to `!entLoading && ent && !ent.canX` (rows: Inco AI assistant, Customize AI look, Room appearance, Disappearing messages, Auto-delete room). So while entitlements are still loading, the NORMAL row renders (no lock flash); the server still enforces if the user acts.

- [ ] **Step 3: CallManager — declare + accept the prop (no consumption yet)**

In `CallManagerProps` add `entLoading?: boolean;` and add `entLoading` to the destructure at line 198. (Consumed in Task 2; declaring here keeps the build green and lets ChatScreen pass it.)

- [ ] **Step 4: DashboardScreen — guard the "Your Plan" card during load**

Change line 343 to `const { tier, ent, loading: entLoading } = useEntitlements(user?.uid);`. In the "Your Plan" card, while `entLoading` show a muted placeholder for the badge (e.g. `…`) and hide the action buttons, so a paying user never sees a momentary "Free" badge + upgrade buttons. Minimal change: wrap the badge text with `entLoading ? '…' : (tier === 'ultra' ? 'Ultra' : tier === 'basic' ? 'Basic' : 'Free')` and render the actions block only `when !entLoading`.

- [ ] **Step 5: Build + commit**

Run: `npm run build` (zero errors).
```bash
git add components/ChatScreen.tsx components/RoomInfoModal.tsx components/CallManager.tsx components/DashboardScreen.tsx
git commit -m "polish(monetization): suppress entitlement lock-flash while tier loads"
```

---

### Task 2: CallManager — entLoading gate + visible-but-locked screen share

**Files:**
- Modify: `components/CallManager.tsx`

`entLoading` is now a prop (Task 1). Make calls load-aware and turn screen share into a visible upsell.

- [ ] **Step 1: gateCall — allow during load**

Replace `gateCall` (lines 241–247) so the dead `!ent` branch becomes a real load check:
```ts
const gateCall = (type: CallType): boolean => {
  if (entLoading) return true; // tier not resolved yet -> don't block
  if (type === 'audio' && !ent?.canAudioCall) { onUpgrade?.('Audio calls', 'basic'); return false; }
  if (type === 'video' && !ent?.canVideoCall) { onUpgrade?.('Video calls', 'ultra'); return false; }
  return true;
};
```

- [ ] **Step 2: Call-button locks — only when resolved**

For the four call buttons (group audio/video + 1-on-1 audio/video), change the lock-affordance condition from `ent && !ent.canX` to `!entLoading && !ent?.canX` (so no lock icon flashes during load). Keep routing the click through `beginCall` (which calls `gateCall`).

- [ ] **Step 3: Screen share — visible-but-locked upsell**

Replace the hide-based gate. At line 215 change `canShareScreen` to depend only on device support:
```ts
const canShareScreen = getDisplayMediaSupported();
const screenShareLocked = !entLoading && !ent?.canScreenShare; // Ultra-only
```
Update the button block (429–438) so the button still renders when `canShareScreen` but, when `screenShareLocked`, shows a locked affordance and routes the click to the upsell instead of starting a share:
```tsx
{canShareScreen && (
  <button
    onClick={() => {
      if (screenShareLocked) { onUpgrade?.('Screen sharing', 'ultra'); return; }
      isScreenSharing ? stopScreenShare() : startScreenShare();
    }}
    title={screenShareLocked ? 'Screen sharing is an Ultra feature' : (isScreenSharing ? 'Stop sharing' : 'Share screen')}
    aria-label={screenShareLocked ? 'Screen sharing (Ultra)' : (isScreenSharing ? 'Stop sharing screen' : 'Share screen')}
    className={`relative p-3 sm:p-3.5 rounded-full transition-all shadow-lg ${isScreenSharing ? 'bg-blue-500 text-white' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'} ${screenShareLocked ? 'opacity-60' : ''}`}
  >
    {isScreenSharing ? <MonitorX size={24} /> : <MonitorUp size={24} />}
    {screenShareLocked && <Lock size={12} className="absolute -top-0.5 -right-0.5 bg-slate-900 rounded-full p-0.5" />}
  </button>
)}
```
Ensure `Lock` is imported from lucide-react (it was added in Phase 3 — verify; add if missing). Because the click is gated, `startScreenShare()` (and its `getDisplayMedia` OS prompt) can never fire for a non-Ultra user.

- [ ] **Step 4: Build + commit**

Run: `npm run build`.
```bash
git add components/CallManager.tsx
git commit -m "polish(monetization): calls load-aware; screen share visible-but-locked upsell"
```

---

### Task 3: Live price inside UpgradeModal

**Files:**
- Modify: `components/UpgradeModal.tsx`

- [ ] **Step 1: Use usePrices and append the price**

Add `import { usePrices, formatPrice } from '../hooks/usePrices';`. Inside the component (after the existing hooks, before the early return is fine since hooks must be unconditional — call `usePrices()` at the top with the other hooks):
```ts
const { prices } = usePrices();
const plan = requiredTier === 'ultra' ? prices?.ultra ?? null : prices?.basic ?? null;
const priceSuffix = plan ? ` — ${formatPrice(plan)}/${plan.interval}` : '';
```
Change the body paragraph (lines 62–64) to:
```tsx
<p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 mb-6">
  {featureLabel} is available on {tierName}{priceSuffix}.{reason ? ` ${reason}` : ''}
</p>
```
(Renders e.g. "Video calls is available on Ultra — €10.00/month." Graceful: no suffix if prices haven't loaded.)

- [ ] **Step 2: Build + commit**

Run: `npm run build`.
```bash
git add components/UpgradeModal.tsx
git commit -m "polish(monetization): show live price in UpgradeModal"
```

---

### Task 4: Per-room daily message-quota counter

**Files:**
- DB migration (Supabase-managed): `monetization_p5_messages_sent_today`
- Create: `hooks/useMessageQuota.ts`
- Modify: `components/ChatScreen.tsx`
- Modify: `components/ChatInput.tsx`

- [ ] **Step 1: Apply the read-only RPC** (via `apply_migration`, name `monetization_p5_messages_sent_today`):

```sql
create or replace function public.messages_sent_today(p_room_key text)
returns int
language sql
security definer
set search_path to 'public', 'pg_temp'
stable
as $$
  select count(*)::int
  from public.messages m
  where m.uid = (select auth.uid())::text
    and m.room_key = p_room_key
    and coalesce(m.type, 'text') <> 'system'
    and m.created_at >= (date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens');
$$;
grant execute on function public.messages_sent_today(text) to authenticated, anon;
```
Verify (read-only): `select public.messages_sent_today('<some-room-key>');` returns an int (0 for a room with no sends today). The function only ever counts the CALLER's own messages (filtered by `auth.uid()`), so it leaks nothing.

- [ ] **Step 2: `useMessageQuota` hook**

```ts
import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { Tier, messagesRemaining } from '../utils/entitlements';

// Remaining sends today in this room for the current user. null = unlimited
// (Ultra) or not-yet-known. `bump` is any value that changes after each send to
// trigger a refetch. The DB is authoritative; this is display-only.
export function useMessageQuota(roomKey: string | undefined, tier: Tier, bump: number): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (!roomKey) { setRemaining(null); return; }
    const lim = messagesRemaining(tier, 0); // null when the tier is unlimited
    if (lim === null) { setRemaining(null); return; } // Ultra -> no counter
    (async () => {
      try {
        const { data, error } = await supabase.rpc('messages_sent_today', { p_room_key: roomKey });
        if (error) throw error;
        if (alive) setRemaining(messagesRemaining(tier, (data as number) ?? 0));
      } catch (e) {
        console.error('useMessageQuota failed', e);
        if (alive) setRemaining(null);
      }
    })();
    return () => { alive = false; };
  }, [roomKey, tier, bump]);
  return remaining;
}
```

- [ ] **Step 3: ChatScreen — wire the hook + bump on send + pass to ChatInput**

Add `import { useMessageQuota } from '../hooks/useMessageQuota';`. Add state `const [quotaBump, setQuotaBump] = useState(0);`. Call the hook at component top level:
```ts
const quotaLeft = useMessageQuota(config.roomKey, tier, quotaBump);
```
In `handleSend`, immediately AFTER the successful `await sendMessage(...)` (line ~866), bump:
```ts
setQuotaBump((n) => n + 1);
```
(Only on the send path, not the edit path — edits don't count toward the daily quota.) Pass to `<ChatInput .../>`:
```tsx
quotaLeft={quotaLeft}
```

- [ ] **Step 4: ChatInput — display the counter**

In `ChatInputProps` add:
```ts
  quotaLeft?: number | null; // remaining messages today; null = unlimited/hidden
```
Destructure `quotaLeft`. Near the typing-label block (line ~199), show a subtle counter only when the number is known and getting low (≤ 5) and there isn't a typing label taking the slot:
```tsx
{!typingLabel && quotaLeft != null && quotaLeft <= 5 && (
  <div className={`absolute -top-6 right-6 text-xs px-2 py-0.5 rounded-t-lg backdrop-blur ${quotaLeft === 0 ? 'text-red-500 bg-white/80 dark:bg-slate-900/80' : 'text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-900/80'}`}>
    {quotaLeft === 0 ? 'Daily limit reached' : `${quotaLeft} message${quotaLeft === 1 ? '' : 's'} left today`}
  </div>
)}
```
(At 0 the server already blocks the send and the QT002 UpgradeModal fires — this is just informational.)

- [ ] **Step 5: Build + commit**

Run: `npm run build`.
```bash
git add hooks/useMessageQuota.ts components/ChatScreen.tsx components/ChatInput.tsx
git commit -m "polish(monetization): per-room daily message-quota counter"
```

---

## Final verification
- [ ] `npm run build` passes; `npx vitest run` passes (61 existing tests).
- [ ] Final code-review subagent over the whole Phase-5 diff.
- [ ] RPC live + returns ints; no RLS leak (counts only caller's own messages).
- [ ] Push to `main` (authorized) → Actions deploy.
- [ ] Device test (deferred per user): paying user opens room/participants/settings with NO lock flash; free user sees locks after a beat; screen-share button shows a lock for non-Ultra and prompts upgrade (no OS dialog); UpgradeModal shows the price; free user sees "N messages left today" near the limit, "Daily limit reached" at 0.

## Self-review notes
- **Lock-flash:** fixed via `loading` (the real signal — `ent` is never undefined). Covered: RoomInfoModal, CallManager (calls + buttons + screen share), DashboardScreen card.
- **Screen share:** now consistent with audio/video (visible + locked + upsell); click is gated before `getDisplayMedia`.
- **Prices in modal:** graceful (no suffix until `usePrices` resolves).
- **Quota counter:** server-authoritative via an RPC that reuses the trigger's exact day expression (no client tz duplication — avoids the ms/tz class of bug). Display-only; the server still enforces. Ultra (unlimited) → hook returns null → no counter.
- **No new tests** added (hooks need RTL which isn't set up); existing vitest suites must stay green.
- **Out of scope:** annual plans (user chose monthly-only); anything not listed.
