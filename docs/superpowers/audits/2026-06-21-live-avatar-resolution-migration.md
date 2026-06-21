# Live Avatar Resolution — DB migration record

**Applied:** 2026-06-21 to prod `qygirixqsuraclbdfnjp` via `apply_migration`
(name `live_avatar_resolution`). Implements
`docs/superpowers/specs/2026-06-21-live-avatar-resolution-design.md`.

## What was applied

1. `ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS avatar_url text;`
2. One-time backfill of `subscribers.avatar_url` from each member's latest message
   avatar (only where NULL).
3. `set_my_avatar(p_avatar text)` — `SECURITY DEFINER`, updates all of the caller's
   `subscribers` rows (`WHERE uid = auth.uid()::text`). `REVOKE ALL FROM public`,
   `GRANT EXECUTE TO authenticated`.
4. `room_members` rewritten to return `COALESCE(s.avatar_url, <latest-message
   avatar subquery>)` — current avatar first, message-derived as a safety fallback.

## Verification (read-only + self-rolling-back)

- Backfill: Vasiliki's row (`room_key 8888_3333`) populated from her latest message
  avatar; **4 of 11** subscriber rows remained NULL (members who never sent a
  message with an avatar) — they `COALESCE` to the same fallback as before (initials),
  so no regression.
- COALESCE precedence: rows with non-null `avatar_url` resolve to it; NULL rows fall
  to the message subquery.
- `set_my_avatar` write shape, in a `BEGIN; … ROLLBACK;` txn: the UPDATE touched only
  the matching uid (`leaked_other_rows = 0`); post-rollback `test_leftovers = 0`.

## Safety

Did NOT touch `rooms.expires_at`; no auto-lock; `join_or_create_room` signature
unchanged (avatar propagation rides on `set_my_avatar`). Backfill only reads
`messages` → writes `subscribers`.
