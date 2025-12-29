
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
  type?: 'text' | 'system';
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
}

// Webrtc Signaling Data
export interface SignalData {
  type: 'offer' | 'answer' | 'candidate' | 'bye' | 'reject';
  payload: any;
  fromUid: string;
  fromName: string;
  fromAvatar: string;
  toUid?: string; 
  callId?: string;
  callType?: 'audio' | 'video';
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
  pin: string; // Stored to allow auto-join for creator
  created_at: string;
  created_by: string;
  ai_enabled?: boolean;
  ai_avatar_url?: string;
}
