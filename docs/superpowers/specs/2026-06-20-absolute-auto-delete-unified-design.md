# Absolute auto-delete for all rooms (unified `expires_at`) — Design

**Date:** 2026-06-20
**Status:** Approved direction (unify on `expires_at`; deadline from choice; "deleted → recreate" card for all rooms).

## Goal

Make **every** room auto-delete at a fixed absolute time, regardless of activity:
- **Free** rooms delete **24h after creation** (already the case).
- **Basic/Ultra** rooms delete after the owner's **chosen interval (1/3/7/30 days)**, measured from when they pick it — **NOT** inactivity-based (the previous behavior).

The live countdown appears everywhere (chat header, dashboard cards, Room info), and the existing free-room "auto-deleted → Re-create / Dismiss" notification (in-room toast + dashboard card + tombstones) now applies to **all** auto-deleted rooms.

## Background (verified)

- `rooms.expires_at timestamptz` — absolute deadline. Free creation sets it to `created_at + 24h` (in `join_or_create_room`). pg_cron **jobid 5 `purge-expired-free-rooms`** (`*/15`) runs `delete from public.rooms where expires_at is not null and expires_at < now();` — **tier-agnostic** (deletes any expired room).
- `rooms.auto_delete_seconds int` — currently an **inactivity** TTL. pg_cron **jobid 3 `expire_rooms`** (`*/15` → `expire_rooms()`) deletes a room N seconds after its last activity. This is the behavior being removed.
- Client sets `auto_delete_seconds` via a **direct** `rooms` UPDATE in `RoomExpiryModal` (column-level grant + `enforce_room_tier` trigger gating it Basic+). `expires_at` is **not** client-writable (no column grant) and must never be (free rooms must not be able to clear their 24h timer).
- **Current data: 11 rooms, 0 with `auto_delete_seconds`, 0 with `expires_at`** → no migration risk; dropping the inactivity path affects nothing live.
- Client countdown today: amber `Hourglass` pill from `expiryShortLabel(expires_at)` (free) **plus** a red pill from `inactivityExpiryLabel(auto_delete_seconds, lastActivity)` (added 2026-06-17, commit 65eee9a). The inactivity pill/helper is **reverted** by this change.
- Dashboard "auto-deleted" card + `utils/roomTombstones.ts` already key on `expires_at` (`isExpired`), so unifying paid auto-delete onto `expires_at` gives the notification feature for free.

## Architecture — unify on `expires_at`

One absolute deadline column governs all deletion. `auto_delete_seconds` is demoted to "the **chosen interval**" (drives the modal's selected option + the settings-row label), and no longer drives deletion.

### Database (migrations, live)

1. **New RPC `set_room_auto_delete(p_room_key text, p_seconds int) returns jsonb`** — `SECURITY DEFINER`, `search_path = public, pg_temp`, granted to `anon, authenticated`. Body:
   - `v_uid := (select auth.uid())::text;` if null → `raise exception 'AUTH_REQUIRED';`
   - membership: `if not public.is_member(p_room_key) then raise exception 'NOT_A_MEMBER'; end if;`
   - tier gate (mirror `enforce_room_tier`): `if public.effective_tier((select auth.uid())) = 'free' then raise exception 'TIER_REQUIRED:basic' using errcode = 'QT004'; end if;`
   - **free-fixed guard:** read current `expires_at`, `auto_delete_seconds`; `if v_expires is not null and v_seconds is null then raise exception 'FREE_ROOM_FIXED'; end if;` (a free 24h room — its timer is immutable).
   - optional sanity: `if p_seconds is not null and p_seconds < 60 then raise exception 'BAD_INTERVAL'; end if;`
   - set both:
     ```sql
     update public.rooms
        set auto_delete_seconds = p_seconds,
            expires_at = case when p_seconds is null then null
                              else now() + make_interval(secs => p_seconds) end
      where room_key = p_room_key;
     ```
   - `return jsonb_build_object('expires_at', <new>, 'auto_delete_seconds', p_seconds);`
2. **Revoke the direct write path** so the RPC is the only way to change it (prevents desync where `auto_delete_seconds` is set without `expires_at`): `revoke update (auto_delete_seconds) on public.rooms from anon, authenticated;` (no table-level UPDATE grant exists to mask this — verified pattern). `message_ttl_seconds` grant is untouched (disappearing messages, separate feature).
3. **Drop the inactivity path:** `select cron.unschedule('expire_rooms');` then `drop function if exists public.expire_rooms();`.
4. **Keep** jobid 5 (`purge-expired-free-rooms`) as-is — its command already deletes any room with a past `expires_at`, so it now purges paid auto-deleted rooms too. (Name left unchanged to avoid churn; it is the general expired-room purge.)

Error-code contract unchanged: the RPC raises `QT004` `TIER_REQUIRED:basic` exactly like `enforce_room_tier`, so the existing `parseTierError` → upgrade-prompt path works.

### Client

- **`utils/roomLifecycle.ts`** — remove `inactivityExpiryLabel` and its tests (revert 65eee9a's helper). Keep `shortMsLabel` (now used only by `expiryShortLabel`), `expiryShortLabel`, `isExpired`.
- **`services/supabase.ts`** — add `setRoomAutoDelete(roomKey, seconds)` calling `rpc('set_room_auto_delete', { p_room_key, p_seconds })`; returns `{ data: { expires_at, auto_delete_seconds } | null, error }`.
- **`components/RoomExpiryModal.tsx`** — `choose()` calls `setRoomAutoDelete` instead of the direct `update`. Copy changes from "…after this period of **inactivity**" → "…**after this period**." `onUpdate` signature becomes `(seconds, expiresAt)` so the parent updates both states. QT004 handling (→ `onUpgrade('Auto-delete','basic')`) unchanged. Options unchanged (Off / 1 / 3 / 7 / 30 days).
- **`components/ChatScreen.tsx`** — RoomExpiry `onUpdate` sets `setRoomExpiry(secs)` + `setRoomExpiresAt(expiresAt)` and posts the system message ("Auto-delete set to {label}" / "turned off"). Stop passing the inactivity `roomExpiryLabel` pill to `ChatHeader`; the single amber countdown pill is `roomFreeExpiryLabel = expiryShortLabel(roomExpiresAt, nowTick)` (covers all auto-delete rooms). Remove the `inactivityExpiryLabel` import/usage.
- **`components/ChatHeader.tsx`** — remove the now-unused red inactivity pill + its `roomExpiryLabel` prop; keep the amber `roomFreeExpiryLabel` countdown pill (tooltip: "This room auto-deletes — {label} left").
- **`components/DashboardScreen.tsx`** — card shows the single amber `expLabel = expiryShortLabel(room.expires_at, now)` countdown; remove the `ttl`/`inactivityExpiryLabel` pill and import. Deleted-card + tombstones already key on `expires_at` → paid rooms covered, no change.
- **`components/RoomInfoModal.tsx`** — auto-delete row + hero hint:
  - **Hero hint** (`formatExpiryHint`) shows the countdown for **any** room with `expires_at` (free + paid), not just free.
  - **Row** (per viewer): free viewer (`!ent.canDisappearing`) → locked → Basic (existing). Paid viewer: if **free-fixed** (`roomExpiresAt` set **and** `roomExpiryLabel`/`auto_delete_seconds` null) → read-only "Free room · 1 day" (existing afdf06a guard); else (paid-owned) → editable by managers, opens `RoomExpiryModal`, trailing shows the chosen interval (`roomExpiryLabel`) or "Off".

## Data flow

User picks interval in `RoomExpiryModal` → `setRoomAutoDelete` RPC → DB sets `expires_at = now()+interval` + `auto_delete_seconds = interval` → returns both → client updates `roomExpiry` + `roomExpiresAt` → countdown pills (header/card/Room-info hero) recompute from `expires_at` via `expiryShortLabel` + the 60s `nowTick`. Deletion: cron jobid 5 removes the room at the deadline → in-room `RoomDeletedToast` (focus/realtime) + dashboard deleted-card/tombstone (both already `expires_at`-driven).

## Error handling

- RPC: `AUTH_REQUIRED` / `NOT_A_MEMBER` / `FREE_ROOM_FIXED` / `BAD_INTERVAL` → generic alert in the modal; `QT004 TIER_REQUIRED:basic` → upgrade prompt (existing).
- Free-fixed guard is a server backstop; the UI already renders that row read-only, so the RPC is normally never called for free rooms.
- `expiryShortLabel`/`isExpired` already fail-safe on absent/malformed/past timestamps.

## Testing

- Unit: `expiryShortLabel`/`isExpired` retained tests still pass after removing `inactivityExpiryLabel`. Remove the `inactivityExpiryLabel` describe block.
- DB behavioral (self-rolling-back): in a transaction, call `set_room_auto_delete` as a paid user → assert `expires_at ≈ now()+interval` and `auto_delete_seconds = interval`; null → both null; free-fixed row → raises; free tier → QT004. ROLLBACK.
- Manual: paid room → pick "1 day" → header + card + Room-info show ~24h countdown that does NOT reset on new messages; let a short-interval room pass its deadline (or set `expires_at` to the past) → cron purge → in-room toast + dashboard "auto-deleted → Re-create" card.

## Out of scope / safety

- No pre-deletion warning notification (user chose the after-deletion card only).
- No migration of existing rooms (0 affected). Never backfill `expires_at` on rooms not going through creation/RPC; the free-fixed guard keeps free rooms' 24h immutable.
- `auto_delete_at` separate-column alternative rejected (would duplicate cron + countdown + notification logic).
