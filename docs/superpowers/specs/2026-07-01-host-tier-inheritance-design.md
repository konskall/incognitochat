# Host Tier Inheritance — Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan

## Goal

When a room's creator ("host") is a paid tier (Basic or Ultra), members of that
room — including anonymous users and logged-in free users — inherit the host's
tier **for two capabilities only**: the daily **message quota** and **calls**
(audio / video / screenshare). Everything else stays bound to each member's own
account tier.

## Core concept

Define an in-room effective tier:

```
roomTier = MAX(effective_tier(member), effective_tier(room.created_by))
```

where `MAX` is by tier rank (`free` < `basic` < `ultra`). `roomTier` is applied
in exactly **two** places (message quota + calls). Every other gate keeps using
the member's OWN `effective_tier`, which automatically preserves the exclusions.

## Scope

**Inherits the host tier (uses `roomTier`):**
- Message quota — `msgPerRoomPerDay` (free 10 / basic 100 / ultra ∞), enforced
  server-side + reflected in the client counter/nudge.
- Calls — `canAudioCall`, `canVideoCall`, `canScreenShare` (client-gated).

**Does NOT inherit (stays on the member's own tier):**
- Uploads — `maxFileBytes` (10MB), `canMultiUpload`.
- Room settings editing — `canRoomAppearance`, `canDisappearing` / auto-delete,
  `canAI` (enable), `canClearMessages`, `canEmailAlerts`.
- `maxRooms` (room-creation limit) — inherently per-account/global, not an
  in-room action; never inherited.

## Architecture

### Server (authoritative; the only security-critical part)

1. **New helper `public.tier_rank(text) → int`** (immutable):
   `ultra → 2, basic → 1, else → 0`. Used to compute the tier MAX.

2. **`enforce_message_quota()` (trigger on `messages` insert)** — change the tier
   resolution:
   - Extend the existing `select locked ... from rooms` to also read
     `created_by`.
   - Replace `v_tier := effective_tier(NEW.uid)` with:
     ```
     v_sender_tier  := effective_tier(NEW.uid::uuid);
     v_creator_tier := effective_tier(v_created_by);   -- null uid → 'free' (coalesce in effective_tier)
     v_tier := case when tier_rank(v_creator_tier) > tier_rank(v_sender_tier)
                    then v_creator_tier else v_sender_tier end;
     ```
   - `v_limit` mapping unchanged (`ultra → null`, `basic → 100`, `else → 10`).
   - Bot uid (`00000000-…`) and `system` messages keep their existing early
     returns (never quota'd), unaffected.

3. **`join_or_create_room()`** — add one key to the returned JSONB:
   `'creator_tier', public.effective_tier(v_room.created_by)`.

No change to `enforce_room_tier` (settings stay on the editor's own tier — an
explicit exclusion), `reconcile_entitlements`, room-creation limits, or expiry.

### Client (surgical)

1. **`JoinRoomResult`** (services/supabase.ts): add `creator_tier: Tier` (RPC
   returns it as text `'free' | 'basic' | 'ultra'`).

2. **Thread `creator_tier`** from the join result into `ChatScreen` alongside the
   existing `roomCreatorId` path (into `ChatConfig` or an equivalent prop).

3. **`maxTier(a: Tier, b: Tier): Tier`** helper in utils/entitlements.ts
   (rank-based max), unit-tested.

4. **`ChatScreen`**:
   - `const roomTier = maxTier(tier, config.creatorTier ?? 'free')`.
   - Message quota: `useMessageQuota(config.roomKey, roomTier, quotaBump)`
     (currently passes `tier`).
   - Nudge gate: change `tier !== 'free'` → `roomTier !== 'free'` (a free member
     in a paid room gets no counter/nudge).
   - Calls: `<CallManager ent={entitlements(roomTier)} … />` (currently `ent={ent}`).
     CallManager is calls-only, so this affects nothing else.
   - Everything else keeps the own-tier `ent` (uploads at the ChatInput props,
     RoomInfoModal settings gating).

## Data flow

Join → server computes `creator_tier = effective_tier(created_by)` and returns
it → client derives `roomTier` → unlocks call buttons + shows correct quota UI.
Message sends are enforced live server-side against `MAX(sender, creator)` on
every insert (never trusts the client). If the host downgrades, the message
quota adjusts immediately server-side; the call buttons re-resolve on the next
room join/refresh (join-time snapshot — a minor, self-healing staleness).

## Edge cases

- **Anonymous member** in a paid room → elevated quota + calls (intended).
- **Ultra member** in a free host's room → keeps ultra (MAX).
- **Bot / system messages** → already exempt from the quota trigger.
- **`created_by` NULL** → `effective_tier(null)` returns `'free'` (coalesce), so
  `roomTier` degrades to the member's own tier. Safe.
- **Notes room** → creator is self, no other members. Unaffected.

## Testing

- **Server (live, via SQL against a throwaway room):** a free user inserting
  >10 non-system messages in a room whose `created_by` is Ultra → allowed; the
  same free user in a free-created room → blocked at 10 (`QUOTA_EXCEEDED:free`).
- **Unit:** `maxTier` — `maxTier('free','ultra')==='ultra'`,
  `maxTier('basic','free')==='basic'`, `maxTier('free','free')==='free'`.
- **Client (Playwright, prod-preview):** free member in an Ultra host's room →
  call buttons enabled + no quota nudge; but upload cap stays 10MB and room
  settings stay locked (verify the exclusions hold).

## Global constraints

- **LIVE production** project (`qygirixqsuraclbdfnjp`). SQL changes go straight
  to prod via migration; verify on a throwaway room, then clean it up.
- Tier limits MUST stay identical to the existing hardcoded numbers
  (`free 10 / basic 100 / ultra ∞`); this feature only changes WHICH tier is
  chosen, never the limits themselves.
- Server functions stay `SECURITY DEFINER` with `search_path = public, pg_temp`;
  `created_by` is server-set → no client can forge the inherited tier.
- Do not alter the existing bot/system early-returns in the quota trigger, the
  room-creation limits, room expiry, or `enforce_room_tier`.
- Client `entitlements.ts` numbers remain the single client mirror of the SQL;
  `maxTier` is a pure, deterministic function.
