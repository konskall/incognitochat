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
  approval_required: boolean;
  is_notes: boolean;
  is_new: boolean;
}

export type JoinRoomErrorCode = 'WRONG_PIN' | 'ROOM_DELETED' | 'AUTH_REQUIRED' | 'ROOM_LIMIT' | 'UNKNOWN';

export async function joinOrCreateRoom(params: {
  roomKey: string;
  roomName: string;
  pin: string;
  username: string;
  createIfMissing?: boolean;
}): Promise<{ data: JoinRoomResult | null; pending: boolean; error: { code: JoinRoomErrorCode; message: string } | null }> {
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
    return { data: null, pending: false, error: { code, message: msg } };
  }
  // A locked room returns { pending: true } instead of a membership row.
  if (data && (data as { pending?: boolean }).pending) {
    return { data: null, pending: true, error: null };
  }
  return { data: data as JoinRoomResult, pending: false, error: null };
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

// GDPR self-serve account deletion. The delete-account edge function (service role)
// cancels the Stripe customer, deletes owned rooms + memberships + settings +
// subscription + storage, then the auth user. IRREVERSIBLE.
export async function deleteAccount(): Promise<BillingResult> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) return { ok: false, error: await readFnError(error) };
  if ((data as any)?.ok) return { ok: true };
  return { ok: false, error: (data as any)?.error || 'DELETE_FAILED' };
}

// --- Re-entry approval (room lockdown) ---
export interface PendingRequest { uid: string; username: string; requested_at: string; }

// Owner reads pending knocks for their room. RLS (rar_select_owner_or_self)
// returns only this owner's room requests.
export async function listAccessRequests(roomKey: string): Promise<PendingRequest[]> {
  const { data, error } = await supabase
    .from('room_access_requests')
    .select('uid, username, requested_at')
    .eq('room_key', roomKey)
    .order('requested_at', { ascending: true });
  if (error) { console.error('listAccessRequests failed', error); return []; }
  return (data as PendingRequest[]) ?? [];
}

export async function approveAccessRequest(roomKey: string, uid: string): Promise<boolean> {
  const { error } = await supabase.rpc('approve_access_request', { p_room_key: roomKey, p_uid: uid });
  if (error) { console.error('approve_access_request failed', error); return false; }
  return true;
}

export async function denyAccessRequest(roomKey: string, uid: string): Promise<boolean> {
  const { error } = await supabase.rpc('deny_access_request', { p_room_key: roomKey, p_uid: uid });
  if (error) { console.error('deny_access_request failed', error); return false; }
  return true;
}

export async function setRoomApproval(roomKey: string, required: boolean): Promise<boolean> {
  const { error } = await supabase.rpc('set_room_approval', { p_room_key: roomKey, p_required: required });
  if (error) { console.error('set_room_approval failed', error); return false; }
  return true;
}
