
export interface User {
  uid: string;
  isAnonymous: boolean;
  email?: string;
}

export interface Attachment {
  url: string; 
  name: string;
  type: string;
  size: number;
}

export interface ReplyInfo {
  id: string;
  username: string;
  text: string;
  isAttachment: boolean;
}

export interface GroundingSource {
  title?: string;
  uri?: string;
}

export interface PollOption {
  id: string;
  text: string;
}

export interface Poll {
  question: string;
  options: PollOption[];
  // optionId -> list of voter uids
  votes: { [optionId: string]: string[] };
  multi: boolean;   // allow selecting more than one option
  closed: boolean;  // no further voting once closed
}

export interface Message {
  id: string;
  text: string;
  uid: string;
  username: string;
  avatarURL: string;
  createdAt: string;
  attachment?: Attachment;
  location?: {
    lat: number;
    lng: number;
  };
  isEdited?: boolean;
  reactions?: { [emoji: string]: string[] };
  replyTo?: ReplyInfo | null;
  type?: 'text' | 'system' | 'poll';
  groundingMetadata?: GroundingSource[];
  poll?: Poll | null;
}

export interface ChatConfig {
  username: string;
  avatarURL: string;
  roomName: string;
  pin: string;
  roomKey: string; 
}

export interface Presence {
  uid: string;
  username: string;
  avatar: string;
  isTyping: boolean;
  onlineAt: string;
  status: 'active' | 'inactive';
  lastReadAt?: string; // ISO timestamp of the latest message this user has seen
}

// WebRTC mesh signaling (broadcast on the `calls:<roomKey>` channel).
// - join:    "I'm in the room call now" (broadcast to everyone)
// - present: "I'm already in the call" (directed reply to a newcomer)
// - offer/answer/candidate: standard per-peer negotiation (directed via toUid)
// - leave:   "I left the call" (broadcast)
// - decline: "I rejected your ring" (directed back to the caller via toUid) so a
//   1-on-1 caller stops waiting instead of hanging on "Waiting for others…".
export interface SignalData {
  type: 'offer' | 'answer' | 'candidate' | 'join' | 'present' | 'leave' | 'screenshare' | 'decline';
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | null;
  fromUid: string;
  fromName: string;
  fromAvatar: string;
  toUid?: string;
  callType?: 'audio' | 'video';
  // For type === 'screenshare': whether the sender just started (true) or
  // stopped (false) sharing. Cosmetic only — drives a tile badge; media never
  // depends on it.
  sharing?: boolean;
}

export interface Subscriber {
    id?: string;
    room_key: string;
    uid: string;
    username: string;
    email: string;
    created_at?: string;
    last_notified_at?: string; // Track last email time
}

// New Interface for Room Dashboard
export interface Room {
  id: string;
  room_key: string;
  room_name: string;
  display_name?: string | null; // Cosmetic owner-set label; room_key/PIN unchanged
  pin: string; // Stored to allow auto-join for creator
  created_at: string;
  created_by: string;
  ai_enabled?: boolean;
  ai_avatar_url?: string;
  auto_delete_seconds?: number | null; // Ephemeral rooms: auto-delete after inactivity
}
