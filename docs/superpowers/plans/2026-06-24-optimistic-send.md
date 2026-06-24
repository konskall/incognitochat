# Optimistic Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A typed text message appears in the conversation instantly with a "sending" state and reconciles when the realtime echo / insert-response arrives, instead of waiting for the DB round-trip; on failure it stays inline as "failed" with tap-to-retry.

**Architecture:** The reconciliation logic (the temp→real swap that must be correct under either ordering of the realtime echo vs the insert response) is extracted into pure, unit-testable functions in `utils/optimisticSend.ts`. `hooks/useChatMessages.ts` wires them: an optimistic `sendMessage` (typed text only) that never throws and returns a `SendOutcome`, a `retryMessage`, a `pendingSendsRef` map keyed by exact ciphertext, and a Path-A interception in the realtime INSERT handler. `ChatScreen` consumes the outcome (notify/quota/upgrade) and renders the status + retry affordance via `MessageList`.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest 2.1.9 (`npm run test`), Supabase JS (Postgres + Realtime), crypto-js (AES, random IV per encrypt), lucide-react icons.

## Global Constraints

- **Encryption preserved.** AES IV is random per encrypt (`utils/crypto.ts:51`) → same plaintext yields different ciphertext each call. Reconciliation MUST match on the **exact ciphertext sent** (recorded at send time), never by re-encrypting. Plaintext is never written to the DB.
- **UI copy in English** (icons + minimal text).
- **No duplicate bubbles** under any send/echo ordering.
- **No regression** for attachments, location, polls, system messages, edit/delete/react. Optimistic behavior is gated to `type === 'text' && !attachment && !location`.
- **No new "sent" checkmark** on bubbles — sending shows a clock; sent reverts to the normal bubble (no ✓).
- Optimistic temp insert must **not** trigger the new-message beep/vibration (`handleNewMessageReceived` already filters own uid; simply do not call `onNewMessage` for the temp). Autoscroll is already handled by the existing last-message effect (`ChatScreen.tsx:875`, follows `isMine`).

---

### Task 1: Pure reconciliation helpers + `Message.status`

**Files:**
- Modify: `types.ts` (add `status` to `Message`)
- Create: `utils/optimisticSend.ts`
- Test: `utils/optimisticSend.test.ts`

**Interfaces:**
- Consumes: `Message` from `types.ts`.
- Produces:
  - `makeTempId(): string`
  - `buildTempMessage(p: TempMessageParams): Message`
  - `reconcileTemp(messages: Message[], tempId: string, realMsg: Message): Message[]`
  - `markMessageStatus(messages: Message[], id: string, status: 'sending' | 'failed' | undefined): Message[]`
  - `TempMessageParams` interface (fields below).

- [ ] **Step 1: Add the `status` field to `Message`**

In `types.ts`, inside `export interface Message { … }` (currently ends around line 58 with `poll?: Poll | null;`), add:

```ts
  // Optimistic-send lifecycle for a typed text message the local user sent.
  // undefined = persisted/normal; 'sending' = awaiting server; 'failed' = retryable.
  status?: 'sending' | 'failed';
```

- [ ] **Step 2: Write the failing test**

Create `utils/optimisticSend.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeTempId, buildTempMessage, reconcileTemp, markMessageStatus, TempMessageParams } from './optimisticSend';
import { Message } from '../types';

const params = (over: Partial<TempMessageParams> = {}): TempMessageParams => ({
  tempId: 'temp_x', text: 'hello', uid: 'u1', username: 'Alice', avatarURL: '',
  createdAt: '2026-06-24T10:00:00.000Z', replyTo: null, ...over,
});
const real = (id: string, over: Partial<Message> = {}): Message => ({
  id, text: 'hello', uid: 'u1', username: 'Alice', avatarURL: '',
  createdAt: '2026-06-24T10:00:00.050Z', reactions: {}, type: 'text', ...over,
});

describe('makeTempId', () => {
  it('is unique and temp-prefixed', () => {
    const a = makeTempId(), b = makeTempId();
    expect(a.startsWith('temp_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('buildTempMessage', () => {
  it('builds a sending text message with the temp id and empty reactions', () => {
    const m = buildTempMessage(params());
    expect(m.id).toBe('temp_x');
    expect(m.status).toBe('sending');
    expect(m.type).toBe('text');
    expect(m.text).toBe('hello');
    expect(m.reactions).toEqual({});
  });
  it('carries a reply quote when given', () => {
    const m = buildTempMessage(params({ replyTo: { id: 'r1', username: 'Bob', text: 'hi', isAttachment: false } }));
    expect(m.replyTo).toEqual({ id: 'r1', username: 'Bob', text: 'hi', isAttachment: false });
  });
});

describe('reconcileTemp', () => {
  it('replaces the temp in place when only the temp is present (insert-resolve, echo not yet seen)', () => {
    const msgs = [real('m0'), buildTempMessage(params())];
    const out = reconcileTemp(msgs, 'temp_x', real('server-1'));
    expect(out.map((m) => m.id)).toEqual(['m0', 'server-1']);
    expect(out[1].status).toBeUndefined();
  });
  it('drops the temp (no duplicate) when the real row already arrived via echo first', () => {
    const msgs = [real('m0'), real('server-1'), buildTempMessage(params())];
    const out = reconcileTemp(msgs, 'temp_x', real('server-1'));
    expect(out.map((m) => m.id)).toEqual(['m0', 'server-1']);
  });
  it('is a no-op when the real row is present and the temp is already gone (second path runs)', () => {
    const msgs = [real('m0'), real('server-1')];
    const out = reconcileTemp(msgs, 'temp_x', real('server-1'));
    expect(out).toBe(msgs);
  });
  it('does not resurrect a message when neither temp nor real is present', () => {
    const msgs = [real('m0')];
    const out = reconcileTemp(msgs, 'temp_x', real('server-1'));
    expect(out).toBe(msgs);
  });
});

describe('markMessageStatus', () => {
  it('sets a status', () => {
    const msgs = [buildTempMessage(params())];
    expect(markMessageStatus(msgs, 'temp_x', 'failed')[0].status).toBe('failed');
  });
  it('clears the status with undefined', () => {
    const msgs = [buildTempMessage(params())];
    expect(markMessageStatus(msgs, 'temp_x', undefined)[0].status).toBeUndefined();
  });
  it('returns the same ref when the id is not found (no re-render)', () => {
    const msgs = [buildTempMessage(params())];
    expect(markMessageStatus(msgs, 'nope', 'failed')).toBe(msgs);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- optimisticSend`
Expected: FAIL — `Cannot find module './optimisticSend'` (file not created yet).

- [ ] **Step 4: Write the implementation**

Create `utils/optimisticSend.ts`:

```ts
import { Message } from '../types';

// Random temp id for a not-yet-persisted message. Kept separate from
// buildTempMessage so that builder stays pure (testable without randomness).
export function makeTempId(): string {
  return `temp_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export interface TempMessageParams {
  tempId: string;
  text: string;
  uid: string;
  username: string;
  avatarURL: string;
  createdAt: string;
  replyTo: { id: string; username: string; text: string; isAttachment: boolean } | null;
}

// The optimistic bubble shown the instant the user hits send.
export function buildTempMessage(p: TempMessageParams): Message {
  return {
    id: p.tempId,
    text: p.text,
    uid: p.uid,
    username: p.username,
    avatarURL: p.avatarURL,
    createdAt: p.createdAt,
    reactions: {},
    replyTo: p.replyTo,
    type: 'text',
    status: 'sending',
  };
}

// Idempotent temp -> real swap. Safe from EITHER the realtime echo path or the
// insert-response path; whichever runs first replaces, the second is a no-op.
// Never produces a duplicate, never resurrects a removed message.
export function reconcileTemp(messages: Message[], tempId: string, realMsg: Message): Message[] {
  const hasReal = messages.some((m) => m.id === realMsg.id);
  if (hasReal) {
    // The real row is already present (the other path won the race) — drop the temp.
    return messages.some((m) => m.id === tempId) ? messages.filter((m) => m.id !== tempId) : messages;
  }
  if (messages.some((m) => m.id === tempId)) {
    // Replace the temp in place (preserves position).
    return messages.map((m) => (m.id === tempId ? realMsg : m));
  }
  // Neither present (temp was removed, e.g. clear-messages) — do not resurrect.
  return messages;
}

// Set/clear the optimistic status of one message. Returns the same array ref
// when nothing changed so React.memo holds.
export function markMessageStatus(
  messages: Message[],
  id: string,
  status: 'sending' | 'failed' | undefined,
): Message[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.id !== id) return m;
    changed = true;
    const { status: _drop, ...rest } = m;
    return status ? { ...rest, status } : (rest as Message);
  });
  return changed ? next : messages;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- optimisticSend`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add types.ts utils/optimisticSend.ts utils/optimisticSend.test.ts
git commit -m "feat(chat): pure optimistic-send reconciliation helpers + Message.status"
```

---

### Task 2: Hook data layer — optimistic `sendMessage`, echo interception, `retryMessage`

**Files:**
- Modify: `hooks/useChatMessages.ts`

**Interfaces:**
- Consumes: `makeTempId`, `buildTempMessage`, `reconcileTemp`, `markMessageStatus` from `utils/optimisticSend` (Task 1); existing `encryptMessage`, `mapRow`, `cipherCacheRef`, `messagesRef`, `setMessages`.
- Produces:
  - `export type SendOutcome = { ok: true } | { ok: false; error: unknown };`
  - `sendMessage(...): Promise<SendOutcome>` — optimistic for typed text; unchanged (throws on error) otherwise.
  - `retryMessage(tempId: string): Promise<SendOutcome>`
  - Both added to the hook's returned object.

- [ ] **Step 1: Add the import and the `SendOutcome` type + `pendingSendsRef`**

At the top of `hooks/useChatMessages.ts`, add to the imports:

```ts
import { makeTempId, buildTempMessage, reconcileTemp, markMessageStatus } from '../utils/optimisticSend';
```

Add the exported type near the top of the file (after the imports, before `interface RawPoll`):

```ts
// Result of a send/retry. The optimistic typed-text path NEVER throws and
// resolves with this; ChatScreen parses `error` with parseTierError (which
// needs `tier`, a ChatScreen concern — the hook stays tier-agnostic).
export type SendOutcome = { ok: true } | { ok: false; error: unknown };
```

Inside the hook body, alongside the other refs (after `cipherCacheRef`, around line 68), add:

```ts
  // ciphertext (exact bytes sent) -> tempId, so the realtime echo of OUR OWN
  // message can be matched back to its temp bubble (random IV means we cannot
  // re-derive the ciphertext, so we record it at send time).
  const pendingSendsRef = useRef<Map<string, string>>(new Map());
```

Also clear it on room switch in the existing cleanup (where `cipherCacheRef.current.clear()` runs, ~line 393), add:

```ts
      pendingSendsRef.current.clear();
```

- [ ] **Step 2: Intercept our own echo in the realtime INSERT handler (Path A)**

In the `postgres_changes` handler, the `if (payload.eventType === 'INSERT') {` branch (currently ~line 312), insert this BEFORE `const newMsg = mapRow(payload.new as MessageRow);`:

```ts
            const raw = payload.new as MessageRow;
            // Path A: our own optimistic send echoing back. Replace its temp
            // bubble in place instead of appending a duplicate. Matched on the
            // exact ciphertext we recorded at send time (random IV ⇒ can't re-derive).
            if (raw.uid === userUid && pendingSendsRef.current.has(raw.text || '')) {
              const tempId = pendingSendsRef.current.get(raw.text || '')!;
              pendingSendsRef.current.delete(raw.text || '');
              const realMsg = mapRow(raw);
              setMessages((prev) => reconcileTemp(prev, tempId, realMsg));
              return;
            }
```

Leave the rest of the INSERT branch unchanged (it still does `const newMsg = mapRow(payload.new as MessageRow);` then dedup + chronological insert + `onNewMessageRef.current(newMsg)`).

- [ ] **Step 3: Add `userUid` to the subscription effect's deps**

The handler now reads `userUid` from closure. In the effect's dependency array (currently `[roomKey, pin, enabled, mapRow, mapPoll, fetchInitial, fetchNewer, resync]`, ~line 395), add `userUid`:

```ts
  }, [roomKey, pin, enabled, userUid, mapRow, mapPoll, fetchInitial, fetchNewer, resync]);
```

- [ ] **Step 4: Rewrite `sendMessage` to be optimistic for typed text and return `SendOutcome`**

Replace the entire `sendMessage` useCallback (currently ~line 397-446) with:

```ts
  const sendMessage = useCallback(
    async (
      text: string,
      config: { username: string; avatarURL: string },
      attachment: Attachment | null = null,
      replyTo: Message | null = null,
      location: { lat: number; lng: number } | null = null,
      type: 'text' | 'system' = 'text'
    ): Promise<SendOutcome> => {
      if (!userUid || !roomKey) return { ok: false, error: new Error('Not ready') };

      // Optimistic only for a plain typed text message. Attachments (own upload
      // progress UI), location and system messages keep the original behavior.
      const optimistic = type === 'text' && !attachment && !location;

      if (!optimistic) {
        if (attachment) setIsUploading(true);
        try {
          const encryptedText = encryptMessage(text, pin, roomKey);
          const { error } = await supabase.from('messages').insert({
            room_key: roomKey,
            uid: userUid,
            username: config.username,
            avatar_url: config.avatarURL,
            text: encryptedText,
            type: type,
            attachment: attachment,
            reactions: {},
            location: location,
            reply_to: replyTo
              ? {
                  id: replyTo.id,
                  username: replyTo.username,
                  text: encryptMessage(replyTo.text || 'Attachment', pin, roomKey),
                  isAttachment: !!replyTo.attachment,
                }
              : null,
          });
          if (error) throw error;
          return { ok: true };
        } catch (e) {
          console.error('Send message failed', e);
          throw e; // unchanged contract for attachment/location/system callers
        } finally {
          if (attachment) setIsUploading(false);
        }
      }

      // --- optimistic typed-text path (never throws) ---
      const encryptedText = encryptMessage(text, pin, roomKey);
      const tempId = makeTempId();
      const replyInfo = replyTo
        ? { id: replyTo.id, username: replyTo.username, text: replyTo.text || 'Attachment', isAttachment: !!replyTo.attachment }
        : null;
      const temp = buildTempMessage({
        tempId,
        text,
        uid: userUid,
        username: config.username,
        avatarURL: config.avatarURL,
        createdAt: new Date().toISOString(),
        replyTo: replyInfo,
      });
      pendingSendsRef.current.set(encryptedText, tempId);
      setMessages((prev) => [...prev, temp]);

      const { data, error } = await supabase
        .from('messages')
        .insert({
          room_key: roomKey,
          uid: userUid,
          username: config.username,
          avatar_url: config.avatarURL,
          text: encryptedText,
          type: 'text',
          attachment: null,
          reactions: {},
          location: null,
          reply_to: replyTo
            ? {
                id: replyTo.id,
                username: replyTo.username,
                text: encryptMessage(replyTo.text || 'Attachment', pin, roomKey),
                isAttachment: !!replyTo.attachment,
              }
            : null,
        })
        .select('id, created_at')
        .single();

      if (error || !data) {
        pendingSendsRef.current.delete(encryptedText);
        setMessages((prev) => markMessageStatus(prev, tempId, 'failed'));
        return { ok: false, error: error ?? new Error('Insert returned no row') };
      }

      // Path B: reconcile temp -> real (idempotent vs the echo path above).
      cipherCacheRef.current.set(data.id, encryptedText);
      const realMsg: Message = { ...temp, id: data.id, createdAt: data.created_at, status: undefined };
      pendingSendsRef.current.delete(encryptedText);
      setMessages((prev) => reconcileTemp(prev, tempId, realMsg));
      return { ok: true };
    },
    [roomKey, pin, userUid]
  );
```

- [ ] **Step 5: Add `retryMessage`**

Immediately after `sendMessage`, add:

```ts
  // Retry a failed typed-text message in place (reuses its tempId). Re-encrypts
  // (new IV ⇒ new ciphertext; refresh the pending map), flips status back to
  // 'sending', re-inserts, reconciles. Never throws; resolves with the outcome.
  const retryMessage = useCallback(
    async (tempId: string): Promise<SendOutcome> => {
      if (!userUid || !roomKey) return { ok: false, error: new Error('Not ready') };
      const msg = messagesRef.current.find((m) => m.id === tempId);
      if (!msg) return { ok: false, error: new Error('Message not found') };

      const encryptedText = encryptMessage(msg.text, pin, roomKey);
      // Drop any stale pending entry pointing at this temp, then record the new one.
      for (const [c, t] of pendingSendsRef.current) if (t === tempId) pendingSendsRef.current.delete(c);
      pendingSendsRef.current.set(encryptedText, tempId);
      setMessages((prev) => markMessageStatus(prev, tempId, 'sending'));

      const { data, error } = await supabase
        .from('messages')
        .insert({
          room_key: roomKey,
          uid: userUid,
          username: msg.username,
          avatar_url: msg.avatarURL,
          text: encryptedText,
          type: 'text',
          attachment: null,
          reactions: {},
          location: null,
          reply_to: msg.replyTo
            ? {
                id: msg.replyTo.id,
                username: msg.replyTo.username,
                text: encryptMessage(msg.replyTo.text || 'Attachment', pin, roomKey),
                isAttachment: !!msg.replyTo.isAttachment,
              }
            : null,
        })
        .select('id, created_at')
        .single();

      if (error || !data) {
        pendingSendsRef.current.delete(encryptedText);
        setMessages((prev) => markMessageStatus(prev, tempId, 'failed'));
        return { ok: false, error: error ?? new Error('Insert returned no row') };
      }

      cipherCacheRef.current.set(data.id, encryptedText);
      const realMsg: Message = { ...msg, id: data.id, createdAt: data.created_at, status: undefined };
      pendingSendsRef.current.delete(encryptedText);
      setMessages((prev) => reconcileTemp(prev, tempId, realMsg));
      return { ok: true };
    },
    [roomKey, pin, userUid]
  );
```

- [ ] **Step 6: Export `retryMessage` from the hook**

In the hook's returned object (currently ~line 684-699), add `retryMessage,` next to `sendMessage,`.

- [ ] **Step 7: Typecheck + run the suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run test`
Expected: all green (Task 1 tests + the existing suite — the pure helpers carry the reconciliation logic; this task is the wiring around them).

- [ ] **Step 8: Commit**

```bash
git add hooks/useChatMessages.ts
git commit -m "feat(chat): optimistic sendMessage + echo reconciliation + retryMessage"
```

---

### Task 3: UI layer — consume `SendOutcome`, render status + retry

**Files:**
- Modify: `components/ChatScreen.tsx` (destructure `retryMessage`; text-send branch; new `handleRetry`; pass `onRetry` to `MessageList`)
- Modify: `components/MessageList.tsx` (new `onRetry` prop; render `sending`/`failed`; guard the action menu on `msg.status`)

**Interfaces:**
- Consumes: `retryMessage` and `SendOutcome` from `useChatMessages` (Task 2); existing `parseTierError(err, tier)`, `promptUpgrade`, `flashToast`, `notifySubscribers`, `setQuotaBump`, `tier` in `ChatScreen`.
- Produces: `onRetry?: (msg: Message) => void` prop on `MessageList` and its per-message item.

- [ ] **Step 1: Destructure `retryMessage` in ChatScreen**

In `components/ChatScreen.tsx`, the `useChatMessages(...)` destructure (~line 347-360) — add `retryMessage,` alongside `sendMessage,`.

- [ ] **Step 2: Make the text-send branch consume the outcome (no composer restore)**

In `handleSend`, replace the plain-text branch (currently ~line 1288-1292):

```ts
          } else if (filesToSend.length === 0) {
              // Plain text message (no attachments) — unchanged single-send path.
              await sendMessage(textToSend, config, null, replyToSend, null, 'text');
              setQuotaBump((n) => n + 1);
              notifySubscribers('message', textToSend || 'Sent a file');
          } else {
```

with:

```ts
          } else if (filesToSend.length === 0) {
              // Plain text — OPTIMISTIC: the bubble already rendered. sendMessage
              // does NOT throw here; it resolves with the outcome. On failure the
              // inline "failed + retry" bubble is the cue (no composer restore).
              const outcome = await sendMessage(textToSend, config, null, replyToSend, null, 'text');
              if (outcome.ok) {
                  setQuotaBump((n) => n + 1);
                  notifySubscribers('message', textToSend);
              } else {
                  const tierErr = parseTierError(outcome.error, tier);
                  if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
                  else if (tierErr) flashToast(tierErr.message);
              }
          } else {
```

(The surrounding `try/catch` stays — it still guards the editing + multi-file branches, which still throw. The text branch no longer throws, so the catch's composer-restore no longer fires for typed text.)

- [ ] **Step 3: Add `handleRetry`**

Near `handleSend` in `ChatScreen.tsx`, add:

```ts
  const handleRetry = useCallback(async (msg: Message) => {
      const outcome = await retryMessage(msg.id);
      if (outcome.ok) {
          setQuotaBump((n) => n + 1);
          notifySubscribers('message', msg.text);
      } else {
          const tierErr = parseTierError(outcome.error, tier);
          if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
          else if (tierErr) flashToast(tierErr.message);
      }
  }, [retryMessage, tier]);
```

(If `handleSend` is a plain `async function` rather than a `useCallback`, define `handleRetry` as a plain `const handleRetry = async (msg: Message) => { … }` to match — do not introduce a `useCallback` that lint-flags missing deps like `notifySubscribers`/`promptUpgrade` if the surrounding handlers don't. Match the file's existing style for these sibling handlers.)

- [ ] **Step 4: Pass `onRetry` to `MessageList`**

Find the `<MessageList … />` render in `ChatScreen.tsx` (~line 1990-2010) and add the prop:

```tsx
        onRetry={handleRetry}
```

- [ ] **Step 5: Add the `onRetry` prop to `MessageList` and thread it to the item**

In `components/MessageList.tsx`:
- Add `onRetry?: (msg: Message) => void;` to the `MessageList` props interface and to the per-message item component's props.
- Pass it down where the item is rendered (alongside the existing `onReact`, `onReply`, `onEdit`, etc.).
- Add `Clock` and `AlertCircle` to the existing `lucide-react` import.

- [ ] **Step 6: Render the status indicator + reduce opacity while sending**

In the item, the bubble `<div>` (currently ~line 601-625) — append to its `className` template literal (before the closing backtick):

```
${isMe && msg.status === 'sending' ? 'opacity-70' : ''}
```

In the meta row (currently ~line 676 — the `flex items-center justify-end gap-1 mt-1` div with `(edited)`, time, Seen), add the status affordances for own messages. Insert just before the `{isMe && showSeen && …}` segment:

```tsx
{isMe && msg.status === 'sending' && <Clock size={12} aria-label="Sending" className="opacity-80" />}
{isMe && msg.status === 'failed' && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onRetry?.(msg); }}
    aria-label="Message failed to send. Tap to retry."
    className="flex items-center gap-0.5 text-red-300 hover:text-red-100 transition-colors"
  >
    <AlertCircle size={12} />
    <span className="text-[10px] font-semibold">Retry</span>
  </button>
)}
```

- [ ] **Step 7: Guard the long-press action menu on `msg.status`**

A `sending`/`failed` message has no server id (or isn't persisted), so edit/react/pin/delete must not target it. In the item, find `openActionMenu` (the function the press handlers and `onContextMenu` call) and add at its top:

```ts
    if (msg.status) return; // no actions on a not-yet-persisted (sending/failed) message
```

- [ ] **Step 8: Typecheck + build + suite**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm run test`
Expected: all green.
Run: `npm run build`
Expected: build succeeds (this is the deployed artifact gate).

- [ ] **Step 9: Commit**

```bash
git add components/ChatScreen.tsx components/MessageList.tsx
git commit -m "feat(chat): render optimistic sending/failed state + tap-to-retry"
```

---

### Task 4: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck, suite, build**

Run: `npx tsc --noEmit && npm run test && npm run build`
Expected: all pass.

- [ ] **Step 2: Two-tab E2E (dev server + Playwright, or manual)**

Start `npm run dev` (http://localhost:5173/incognitochat/). In two tabs (two users) joined to the same room with the same PIN, verify:
- Sending a typed text message renders the bubble **instantly** with a clock, then settles to a normal bubble; the **other** tab receives **exactly one** copy (no duplicate).
- A reply (swipe/long-press → Reply → send) shows its quote on the instant bubble and reconciles correctly.
- Simulate failure (DevTools → offline, or block the messages insert): the message shows the red **Retry** affordance, the composer is **not** restored; re-enable network → tap Retry → it sends and settles.
- **Regression sweep:** attachments still show upload progress and send; location send works; creating a poll works; editing, deleting, and reacting to a message all behave exactly as before; no new-message beep fires for your own sent message.

- [ ] **Step 3: Confirm clean tree**

Run: `git status`
Expected: clean (all work committed across Tasks 1-3).

---

## Notes for the executor

- This plan touches two large files (`ChatScreen.tsx`, `MessageList.tsx`). Make **surgical** edits at the anchors named; do not reformat surrounding code.
- The hook wiring (Task 2) has no dedicated unit test because the repo has no `renderHook`/`@testing-library` and deliberately tests **pure extracted functions** (Task 1) instead — matching `useRoomPresence.test.ts`. Do not add React-testing dependencies. Task 2's gate is `tsc` + the green suite; correctness of the reconcile logic is proven by Task 1's tests; end-to-end behavior is verified in Task 4.
- Do **not** call `onNewMessage` for the optimistic temp insert (would be redundant; autoscroll is handled by the existing `isMine` effect).
