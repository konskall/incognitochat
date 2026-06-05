import { createClient } from '@supabase/supabase-js';

// Hardcoded keys for development environment where .env is not available.
const supabaseUrl = 'https://qygirixqsuraclbdfnjp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5Z2lyaXhxc3VyYWNsYmRmbmpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUyOTA4NjIsImV4cCI6MjA4MDg2Njg2Mn0.x1KpxEUDQ4EOW58MgsgeKJ5Y9NIqcRIgKmZ-qhkhWZQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
  is_new: boolean;
}

export type JoinRoomErrorCode = 'WRONG_PIN' | 'ROOM_DELETED' | 'AUTH_REQUIRED' | 'UNKNOWN';

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
    return { data: null, error: { code, message: msg } };
  }
  return { data: data as JoinRoomResult, error: null };
}
