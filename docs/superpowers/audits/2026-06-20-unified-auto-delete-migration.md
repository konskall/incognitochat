# Migration record — unified absolute auto-delete (2026-06-20)

**Migration:** `unified_absolute_auto_delete` (Supabase-managed, applied to prod `qygirixqsuraclbdfnjp`; not git-tracked).

## What it did
- Created `public.set_room_auto_delete(p_room_key text, p_seconds int) returns jsonb` — `SECURITY DEFINER`, `search_path = public, pg_temp`, granted to `anon, authenticated`. Sets `rooms.expires_at = now() + make_interval(secs => p_seconds)` (null → permanent) and stores `auto_delete_seconds = p_seconds`. Guards: `AUTH_REQUIRED`; `NOT_A_MEMBER` (is_member); `TIER_REQUIRED:basic` (SQLSTATE `QT004`) when `effective_tier = free`; `BAD_INTERVAL` (< 60s); `FREE_ROOM_FIXED` when the room is a free 24h room (`expires_at` set AND `auto_delete_seconds` null).
- `revoke update (auto_delete_seconds) on public.rooms from anon, authenticated` — the RPC is now the only writer (prevents `auto_delete_seconds`/`expires_at` desync). `message_ttl_seconds` UPDATE grant left intact (disappearing messages).
- `cron.unschedule('expire_rooms')` + `drop function public.expire_rooms()` — removed the inactivity-based deletion path. The tier-agnostic `purge-expired-free-rooms` cron (jobid 5, `delete … where expires_at < now()`) now purges all auto-deleted rooms.

## Verification (post-apply)
| Check | Result |
|---|---|
| `set_room_auto_delete` exists + `prosecdef` | ✅ 1 |
| RPC granted to anon + authenticated | ✅ 2 |
| `auto_delete_seconds` UPDATE grant (anon/auth) | ✅ 0 (revoked) |
| `message_ttl_seconds` UPDATE grant (anon/auth) | ✅ 2 (kept) |
| No table-level UPDATE grant on `rooms` (anon/auth) | ✅ 0 (column revoke effective) |
| `expire_rooms` cron | ✅ gone |
| `expire_rooms()` function | ✅ gone |
| `purge-expired-free-rooms` cron | ✅ present |
| `now() + make_interval(secs => 86400)` > now()+23h | ✅ true |

## Safety
0 live rooms used `auto_delete_seconds` or `expires_at` at apply time → dropping the inactivity path affected nothing. Free rooms' 24h `expires_at` remains immutable (the `FREE_ROOM_FIXED` guard + the unchanged `join_or_create_room` creation logic).

See spec `docs/superpowers/specs/2026-06-20-absolute-auto-delete-unified-design.md` and plan `docs/superpowers/plans/2026-06-20-absolute-auto-delete-unified.md`.
