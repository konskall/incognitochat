
export interface User {
  uid: string;
  isAnonymous: boolean;
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
  // Supabase returns ISO strings for dates
  createdAt: string; 
  attachment?: Attachment;
  location?: {
    lat: number;
    lng: number;
  };
  isEdited?: boolean;
  reactions?: { [emoji: string]: string[] }; // Key: emoji char, Value: array of uids
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
  status: 'active' | 'inactive';
  lastSeen: string;
  isTyping?: boolean;
  onlineAt?: string; // Supabase presence timestamp
}

// Webrtc Signaling Data
export interface SignalData {
  type: 'offer' | 'answer' | 'candidate' | 'bye' | 'reject';
  payload: any;
  fromUid: string;
  fromName: string;
  fromAvatar: string;
  toUid?: string; // If specific target
  callId?: string;
  callType?: 'audio' | 'video';
}

export interface Subscriber {
    uid: string;
    email: string;
    username: string;
    createdAt: string;
}
