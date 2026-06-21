import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseConfig';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});

// --- Room access ---
// Membership + PIN verification is enforced server-side by the
// `join_or_create_room` SECURITY DEFINER RPC. This is the ONLY way to become a
// member of a room (RLS gates all reads/writes on membership). Direct inserts
// into rooms/subscribers are blocked by RLS.
export interface JoinRoomResult {
  room_key: string;
  room_name: string;
  created_by: string;
  ai_enabled: boolean;
  ai_avatar_url: string | null;
  avatar_url: string | null;
  background_url: string | null;
  background_type: string | null;
  background_preset: string | null;
  message_ttl_seconds: number | null;
  auto_delete_seconds: number | null;
  pinned_message_id: string | null;
  is_new: boolean;
}

export type JoinRoomErrorCode = 'WRONG_PIN' | 'ROOM_DELETED' | 'AUTH_REQUIRED' | 'ROOM_LIMIT' | 'UNKNOWN';

export async function joinOrCreateRoom(params: {
  roomKey: string;
  roomName: string;
  pin: string;
  username: string;
  createIfMissing?: boolean;
}): Promise<{ data: JoinRoomResult | null; error: { code: JoinRoomErrorCode; message: string } | null }> {
  const { data, error } = await supabase.rpc('join_or_create_room', {
    p_room_key: params.roomKey,
    p_room_name: params.roomName,
    p_pin: params.pin,
    p_username: params.username,
    p_create_if_missing: params.createIfMissing ?? true,
  });

  if (error) {
    const msg = error.message || '';
    let code: JoinRoomErrorCode = 'UNKNOWN';
    if (msg.includes('WRONG_PIN')) code = 'WRONG_PIN';
    else if (msg.includes('ROOM_DELETED')) code = 'ROOM_DELETED';
    else if (msg.includes('AUTH_REQUIRED')) code = 'AUTH_REQUIRED';
    else if (msg.includes('ROOM_LIMIT')) code = 'ROOM_LIMIT';
    return { data: null, error: { code, message: msg } };
  }
  return { data: data as JoinRoomResult, error: null };
}

// The user's permanent personal "Notes" room (Basic+). Idempotent server-side:
// returns the existing room or creates it (random PIN, default Notes avatar,
// permanent). Free tier is rejected (TIER_REQUIRED) — the UI shows a locked card.
export interface NotesRoomResult {
  room_key: string;
  room_name: string;
  pin: string;
  avatar_url: string | null;
  created_by: string;
  is_notes: true;
}

export async function getOrCreateNotesRoom(
  username: string,
): Promise<{ data: NotesRoomResult | null; error: { tierRequired: boolean; message: string } | null }> {
  const { data, error } = await supabase.rpc('get_or_create_notes_room', { p_username: username });
  if (error) {
    const msg = error.message || '';
    return { data: null, error: { tierRequired: msg.includes('TIER_REQUIRED'), message: msg } };
  }
  return { data: data as NotesRoomResult, error: null };
}

// Mirror the caller's CURRENT avatar onto ALL their `subscribers` rows so other
// members read it live (messages, tap-modal, Members, participants) instead of
// the avatar baked into old messages. Best-effort: a failed propagation just
// leaves room_members' latest-message fallback in place. Call after a profile
// photo change and after each successful room join.
export async function setMyAvatar(url: string): Promise<void> {
  try {
    await supabase.rpc('set_my_avatar', { p_avatar: url });
  } catch {
    /* best-effort — non-fatal */
  }
}

// Set/clear a room's absolute auto-delete deadline (Basic+). The SECURITY DEFINER
// RPC sets rooms.expires_at = now()+seconds (or null) AND stores the chosen
// interval in auto_delete_seconds. The RPC is the ONLY writer of auto_delete_seconds
// (the direct column write is revoked), so the two never desync.
export async function setRoomAutoDelete(
  roomKey: string,
  seconds: number | null,
): Promise<{ data: { expires_at: string | null; auto_delete_seconds: number | null } | null; error: unknown }> {
  const { data, error } = await supabase.rpc('set_room_auto_delete', {
    p_room_key: roomKey,
    p_seconds: seconds,
  });
  return { data: (data as { expires_at: string | null; auto_delete_seconds: number | null } | null) ?? null, error };
}

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

// Defense-in-depth: only ever navigate to an https Stripe URL. The URL comes from
// our own create-checkout-session / create-portal-session edge functions, but a
// server-side mistake (or a compromised upstream) returning a javascript:/data:
// scheme or a non-Stripe host would otherwise be a blind redirect. Mirrors the
// same-origin/scheme discipline in sw.js and helpers.ts (safeAvatarUrl).
function isStripeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)stripe\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

// Start Stripe Checkout (subscription mode) for a paid tier. Redirects on success.
export async function startCheckout(tier: 'basic' | 'ultra'): Promise<BillingResult> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { tier } });
  if (error) return { ok: false, error: await readFnError(error) };
  const url = (data as any)?.url;
  if (!url) return { ok: false, error: (data as any)?.error || 'NO_CHECKOUT_URL' };
  if (!isStripeUrl(url)) return { ok: false, error: 'BAD_CHECKOUT_URL' };
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
  if (!isStripeUrl(url)) return { ok: false, error: 'BAD_PORTAL_URL' };
  window.location.href = url;
  return { ok: true };
}
