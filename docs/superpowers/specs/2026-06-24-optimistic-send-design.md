# Optimistic Send — Design Spec

**Date:** 2026-06-24
**Status:** Approved (design) — pending implementation plan
**Goal:** A typed text message appears in the conversation *instantly* on send (with a "sending" state), instead of only appearing after the DB insert + realtime echo round-trip. On failure it stays inline as "failed" with tap-to-retry. This removes the perceived "my message lags" delay, especially on mobile/poor networks.

---

## Scope (YAGNI)

Optimistic behavior applies **only to user-typed text messages** — the `handleSend` text branch where `type === 'text' && !attachment && !location`.

**Explicitly unchanged (no temp bubble, current behavior preserved):**
- Attachment / file sends — they already show an upload-progress UI; the latency there *is* the upload, which the user already sees.
- Location messages (`handleSendLocation`) — own spinner flow.
- Polls (`createPoll`), system messages (`type: 'system'`), AI-toggle notices.
- `editMessage`, `deleteMessage`, `reactToMessage`, `votePoll` — already optimistic.

## Global Constraints

- **Encryption preserved.** AES IV is random per encrypt (`crypto.ts:51`), so the same plaintext yields different ciphertext each call. Reconciliation MUST match on the **exact ciphertext sent**, never by re-encrypting. Plaintext is never written to the DB.
- **UI copy in English** (icons + minimal text). Conversation/this doc in Greek is fine; product copy is English.
- **No duplicate bubbles** under any send/echo ordering.
- **No regression** for attachments, location, polls, system messages, edit/delete/react.
- **No new "sent" checkmark** on bubbles — the app deliberately has none (it shows "Seen" via presence). Sending shows a clock; sent reverts to the normal bubble.
- Optimistic temp insert must **not** trigger the new-message beep/vibration (that path is for incoming peer messages). Autoscroll is already handled by the existing last-message effect (`ChatScreen.tsx:875`, follows `isMine`).

---

## Architecture

All optimistic state lives in `hooks/useChatMessages.ts`, which already owns the `messages` state, the realtime INSERT/UPDATE/DELETE handler, and the per-message ciphertext cache. `ChatScreen.handleSend` stays the orchestrator for side-effects (subscriber notification, quota counter, upgrade prompts). `MessageList` renders the new per-message status and exposes a retry affordance.

### Data model

`types.ts` — `Message` gains one optional field:

```ts
status?: 'sending' | 'failed';   // undefined = sent (normal bubble)
```

A temp (not-yet-persisted) message uses id `temp_<random>` (e.g. `` `temp_${Math.random().toString(36).slice(2)}` ``). `createdAt` is the client `new Date().toISOString()` at send time; it is replaced by the server value on reconciliation.

### Hook state

```ts
// ciphertext (exact bytes sent) -> tempId, so the realtime echo of OUR OWN
// message can be matched back to its temp bubble and replace it (random IV
// means we cannot re-derive the ciphertext, so we record it).
const pendingSendsRef = useRef<Map<string, string>>(new Map());
```

### Hook interface changes

```ts
// On failure the hook returns the RAW error; ChatScreen parses it with
// parseTierError (which needs `tier`, a ChatScreen concern). The hook never
// imports parseTierError or knows about tiers.
type SendOutcome = { ok: true } | { ok: false; error: unknown };

// Optimistic path (typed text): manages the temp bubble + reconciliation
// internally and NEVER throws — resolves with the outcome. Non-optimistic
// paths (attachment/location/system) keep current behavior: return {ok:true}
// on success, THROW on error (existing callers' try/catch unchanged).
sendMessage(text, config, attachment?, replyTo?, location?, type?): Promise<SendOutcome>;

// Retry a failed typed-text message in place (reuses its tempId). Re-encrypts
// (new IV -> new ciphertext, pending map updated), flips status back to
// 'sending', re-inserts, reconciles. Never throws; resolves with the outcome.
retryMessage(tempId: string): Promise<SendOutcome>;
```

---

## Data flow

### Send (optimistic, typed text)

1. Compute `encryptedText = encryptMessage(text, pin, roomKey)`.
2. Build a temp `Message` (`id: temp_…`, `status: 'sending'`, plaintext `text` for display, `uid`, `username`, `avatarURL`, `createdAt: now`, `replyTo` mapped to plaintext quote, `reactions: {}`, `type: 'text'`).
3. Append it to `messages` immediately. Record `pendingSendsRef.set(encryptedText, tempId)`. (No `onNewMessage` call → no beep; the existing last-message effect autoscrolls because it's `isMine`.)
4. `await supabase.from('messages').insert({…}).select('id').single()` — same round-trip, just returns the real `id`.
5. Reconcile (see below). Resolve `{ ok: true }`.
6. On insert error: mark the temp message `status: 'failed'`, remove its `pendingSendsRef` entry, resolve `{ ok: false, error: err }`. **Never throw** for this path.

### Reconciliation — two idempotent paths (whichever fires first wins)

The realtime echo of our own insert and the insert's `.select()` response race. Both converge the temp → real, and the second is a no-op.

**Path A — realtime INSERT echo** (in the existing `postgres_changes` handler, before the chronological-insert logic):
- If `payload.new.uid === userUid` **and** `pendingSendsRef.has(payload.new.text)`:
  - `tempId = pendingSendsRef.get(payload.new.text)`.
  - Replace the message whose id `=== tempId` with `mapRow(payload.new)` (real id, `status` cleared), **in place** (preserve position). If no message with that tempId remains (Path B already ran), ensure the real row is present and drop any stray temp.
  - `pendingSendsRef.delete(payload.new.text)`; **return** (do not also append → no duplicate).
- Otherwise: unchanged (dedup-by-id, then chronological insert).

**Path B — insert `.select()` resolves** (in `sendMessage`):
- Given `tempId` and the returned `realId`:
  - If a message with `id === realId` already exists (echo beat us): drop the message with `id === tempId`.
  - Else: replace the message with `id === tempId` → set `id = realId`, `createdAt = <server value if returned, else keep>`, `status` cleared.
  - `pendingSendsRef.delete(encryptedText)`.

Dedup-by-id (already present in the INSERT handler) guarantees no double even if ordering is unusual.

### Retry

`retryMessage(tempId)`:
1. Find the failed message by `tempId`; if missing or `roomDeleted`, resolve `{ ok: false, tierError: null }`.
2. Re-encrypt its text (new IV). Update `pendingSendsRef`: delete any old entry mapping to this tempId, set `newCiphertext → tempId`.
3. Flip the message `status: 'sending'`.
4. `insert(...).select('id').single()`; reconcile as in Path B (matching on `tempId`); on error flip back to `status: 'failed'`. Never throw; resolve with outcome.

### ChatScreen orchestration

`handleSend` text branch (currently `ChatScreen.tsx:1288-1292`) becomes:

```ts
const outcome = await sendMessage(textToSend, config, null, replyToSend, null, 'text');
if (outcome.ok) {
    setQuotaBump((n) => n + 1);
    notifySubscribers('message', textToSend);
} else {
    const tierErr = parseTierError(outcome.error, tier);
    if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
    else if (tierErr) flashToast(tierErr.message);
    // No toast for a generic network failure — the inline "failed + retry" bubble is the cue.
}
// NO composer restore for the text path — the failed bubble holds the content for retry.
```

The surrounding `try/catch` stays for the edit + file branches (which still throw). Because the text-path `sendMessage` no longer throws, the catch's composer-restore no longer fires for typed text.

`handleRetry(msg)` (new), wired from `MessageList` → bubble:

```ts
const outcome = await retryMessage(msg.id);
if (outcome.ok) { setQuotaBump((n) => n + 1); notifySubscribers('message', msg.text); }
else {
    const tierErr = parseTierError(outcome.error, tier);
    if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
    else if (tierErr) flashToast(tierErr.message);
}
```

---

## UI (MessageList)

In the bubble meta row (`MessageList.tsx:676`, the `(edited) · time · Seen` line), for own messages (`isMe`):
- `status === 'sending'`: bubble at slightly reduced opacity (e.g. `opacity-70`) + a small `Clock` icon (lucide) in the meta row in place of / next to the timestamp. No interaction.
- `status === 'failed'`: a red `AlertCircle` (lucide) + the bubble is tappable to retry. Use a clear, accessible affordance — a small "Tap to retry" / red exclamation button with `aria-label="Message failed to send. Tap to retry."`. Retry calls `onRetry(msg)`.
- `status` undefined: unchanged (normal bubble, no checkmark).

The long-press action menu, reactions, edit/delete remain available on sent messages. A `sending`/`failed` message should not offer edit/react/pin (it has no server id yet / isn't persisted); guard those affordances on `!msg.status`.

`MessageList` (and the per-item component) gains an optional `onRetry?: (msg: Message) => void` prop, threaded from `ChatScreen`.

---

## Error handling & edge cases

- **Echo before resolve / resolve before echo:** both handled idempotently (Paths A/B). No duplicates.
- **Tier/quota failure (QT002):** message goes `failed`; upgrade prompt shown; retry available after upgrade.
- **Room deleted mid-send:** insert fails → `failed` bubble. `handleSend`/`retry` already gate on `roomDeleted`.
- **Encryption throws:** `encryptMessage` throws before any temp is added → surfaced as a normal failure (no orphan temp). (Caught and shown via the failed path; if it throws synchronously before temp insertion, fall back to a toast.)
- **Reply quote on a temp:** rendered from the plaintext `replyTo` we already build client-side — unaffected.
- **Reconcile updates `cipherCacheRef`:** when the temp becomes the real row, prime `cipherCacheRef[realId] = ciphertext` so a later reaction/edit echo isn't needlessly re-decrypted (mirrors existing logic). Drop the `temp_*` entry.

---

## Testing

**Unit (hook, with a mocked Supabase client):**
1. `sendMessage` (text) adds a `status:'sending'` temp immediately and records the pending ciphertext.
2. INSERT echo arrives **before** insert resolves → temp replaced in place by real row, no duplicate, pending cleared.
3. Insert resolves **before** echo → temp gets real id; subsequent echo with that id is deduped (no duplicate).
4. Insert error → message `status:'failed'`, outcome `{ok:false}`; `retryMessage` flips to `sending`, succeeds on the second attempt → `sent`.

**Manual E2E (two browser tabs / two users):**
- Send a text message → it appears instantly with a clock, then settles to normal; the other tab receives exactly one copy.
- Throttle network / go offline → send fails → red retry affordance → re-enable → tap retry → sends.
- Attachments, location, polls, edit, delete, reactions all behave exactly as before.
