// Supabase Edge Function: purge-expired-rooms
//
// WHY: rooms auto-delete at their absolute `expires_at` (free = 24h, paid =
// chosen interval). The old `purge-expired-free-rooms` pg_cron was pure SQL
// (`delete from rooms where expires_at < now()`). SQL deletes the row (cascading
// to messages + subscribers) but CANNOT delete Supabase Storage objects — so
// every auto-expired room used to ORPHAN all its files in the `attachments`
// bucket (message images/files, room background, room photo, AI avatar), which
// stay publicly reachable forever with no owning room.
//
// This function replaces that cron and closes the gap in ONE invocation:
//   PASS 1 (expiry): delete the expired room ROWS (same predicate as the old
//     cron; service role bypasses RLS; FK ON DELETE CASCADE removes messages +
//     subscribers).
//   PASS 2 (room GC sweep): list every top-level prefix in the `attachments`
//     bucket and remove (via the Storage API, which deletes both the DB row AND
//     the S3 object) every `${roomKey}/` prefix that has no matching live room.
//     This cleans the rooms PASS 1 just deleted AND any pre-existing orphans AND
//     files left behind by a best-effort client-side cleanup that failed. The
//     `profiles/` prefix (per-user avatars) is skipped here and handled by PASS 3.
//   PASS 3 (profile GC sweep): remove `profiles/${uid}/` avatar folders whose
//     uid no longer exists in auth.users (left behind when the daily
//     cleanup_abandoned_anon_users cron deletes an abandoned anonymous user).
//
// Idempotent and only ever removes data that is already doomed (expired rooms /
// owner-less files), so re-running it is harmless. Invoked by pg_cron via pg_net
// every 15 min. verify_jwt is ON (platform requires a valid project JWT — the
// cron sends the public anon key); the function ignores the caller's identity
// and does all work with the service role. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are injected by the platform — no extra secret.
//
// Body: { "dry_run": true } reports what WOULD be deleted without deleting
// anything (used to verify against live data before arming the cron).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "attachments";
// Per-user profile avatars live here, NOT under a room key — they outlive any
// single room and must never be GC'd by this room-scoped sweep.
const PROFILES_PREFIX = "profiles";
const LIST_PAGE = 100;      // storage.list() default cap per call
const REMOVE_CHUNK = 1000;  // storage.remove() keys per call
// Runaway backstop: never delete more than this many objects in a single run.
// A real room has a handful of files; hitting this means something is wrong, so
// stop and log rather than mass-delete.
const MAX_DELETE_PER_RUN = 5000;
// profiles/<uuid>/ folder names must look like a real auth uid before we probe
// auth.users for them (defensive — a malformed folder name is left untouched).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Every object key directly under `prefix`, paginated. Our uploads are flat
// (`${roomKey}/<file>`, no nested folders under a room), so a single-level list
// is complete. Folder placeholders (id === null) are skipped.
async function listFilesUnder(admin: SupabaseClient, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: LIST_PAGE, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (f.id === null) continue; // sub-folder placeholder, not a file
      keys.push(`${prefix}/${f.name}`);
    }
    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return keys;
}

// Top-level "folders" in the bucket (each room key + the `profiles` folder).
async function listTopPrefixes(admin: SupabaseClient): Promise<string[]> {
  const prefixes: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list("", { limit: LIST_PAGE, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const e of data) {
      if (e.id === null) prefixes.push(e.name); // folder placeholder = a prefix
    }
    if (data.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return prefixes;
}

async function removeKeys(admin: SupabaseClient, keys: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < keys.length; i += REMOVE_CHUNK) {
    const chunk = keys.slice(i, i + REMOVE_CHUNK);
    const { error } = await admin.storage.from(BUCKET).remove(chunk);
    if (error) throw error;
    removed += chunk.length;
  }
  return removed;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    const result = {
      dry_run: dryRun,
      expired_rooms: 0,
      orphan_prefixes: 0,
      orphan_files: 0,
      orphan_profile_dirs: 0,
      orphan_profile_files: 0,
      skipped_recreated: [] as string[],
      capped: false,
      errors: [] as string[],
    };
    let budget = MAX_DELETE_PER_RUN;

    // ---- PASS 1: delete expired room rows (same predicate as the old cron). ----
    // Capture the keys for the report; their storage is cleaned by PASS 2 (their
    // prefixes become orphans the moment the row is gone), which also self-heals
    // if a per-room storage delete had partially failed.
    const nowIso = new Date().toISOString();
    {
      const base = admin.from("rooms").select("room_key").not("expires_at", "is", null).lt("expires_at", nowIso);
      if (dryRun) {
        const { data, error } = await base;
        if (error) throw error;
        result.expired_rooms = (data ?? []).length;
      } else {
        const { data, error } = await admin
          .from("rooms").delete()
          .not("expires_at", "is", null).lt("expires_at", nowIso)
          .select("room_key");
        if (error) throw error;
        result.expired_rooms = (data ?? []).length;
      }
    }

    // ---- PASS 2: GC sweep — remove every storage prefix with no live room. ----
    // Live room keys (post-PASS-1). A prefix not in here (and not `profiles`) has
    // no owning room => its files are orphans.
    const live = new Set<string>();
    {
      const { data, error } = await admin.from("rooms").select("room_key");
      if (error) throw error;
      for (const r of data ?? []) live.add(r.room_key as string);
    }

    const prefixes = await listTopPrefixes(admin);
    const candidates = prefixes.filter((p) => p !== PROFILES_PREFIX && !live.has(p));

    for (const prefix of candidates) {
      if (budget <= 0) { result.capped = true; break; }
      try {
        // Re-check immediately before deleting: a room could have been (re)created
        // between the snapshot above and now (room rows are always written BEFORE
        // any file is uploaded to their prefix, so an existing row here means a
        // live room — never delete its files). Closes the create/recreate race.
        const { data: stillGone, error: chkErr } = await admin
          .from("rooms").select("room_key").eq("room_key", prefix).maybeSingle();
        if (chkErr) throw chkErr;
        if (stillGone) { result.skipped_recreated.push(prefix); continue; }

        const keys = await listFilesUnder(admin, prefix);
        if (keys.length === 0) continue;
        const take = keys.slice(0, budget);
        result.orphan_prefixes += 1;
        if (dryRun) {
          result.orphan_files += take.length;
        } else {
          result.orphan_files += await removeKeys(admin, take);
        }
        budget -= take.length;
        if (take.length < keys.length) result.capped = true;
      } catch (e) {
        result.errors.push(`gc ${prefix}: ${String(e)}`);
      }
    }

    // ---- PASS 3: profile-avatar GC — reclaim profiles/${uid}/ of deleted users. ----
    // `cleanup_abandoned_anon_users` (daily cron) deletes abandoned anonymous
    // users but leaves their uploaded avatar behind. Remove the avatar folders
    // whose uid no longer exists in auth.users. The orphan_profile_uids RPC
    // (SECURITY DEFINER) checks only the uids that actually have a storage
    // folder — it never enumerates the full user base — and is evaluated at a
    // single point in time, so a user (re)created meanwhile keeps their avatar.
    try {
      const profileUids: string[] = [];
      let offset = 0;
      for (;;) {
        const { data, error } = await admin.storage.from(BUCKET).list(PROFILES_PREFIX, { limit: LIST_PAGE, offset });
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const e of data) {
          if (e.id === null && UUID_RE.test(e.name)) profileUids.push(e.name); // uid sub-folder
        }
        if (data.length < LIST_PAGE) break;
        offset += LIST_PAGE;
      }
      if (profileUids.length > 0) {
        const { data: orphans, error: rpcErr } = await admin.rpc("orphan_profile_uids", { p_uids: profileUids });
        if (rpcErr) throw rpcErr;
        for (const uid of (orphans ?? []) as string[]) {
          if (budget <= 0) { result.capped = true; break; }
          const keys = await listFilesUnder(admin, `${PROFILES_PREFIX}/${uid}`);
          if (keys.length === 0) continue;
          const take = keys.slice(0, budget);
          result.orphan_profile_dirs += 1;
          if (dryRun) result.orphan_profile_files += take.length;
          else result.orphan_profile_files += await removeKeys(admin, take);
          budget -= take.length;
          if (take.length < keys.length) result.capped = true;
        }
      }
    } catch (e) {
      result.errors.push(`profile-gc: ${String(e)}`);
    }

    console.log(`purge-expired-rooms ${JSON.stringify(result)}`);
    return json(result, 200);
  } catch (e) {
    console.error("purge-expired-rooms exception", e);
    return json({ error: "SERVER_ERROR", detail: String(e) }, 500);
  }
});
