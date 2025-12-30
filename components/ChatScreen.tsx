
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabase';
import { ChatConfig, Message, User, Subscriber, Presence, Room } from '../types';
import MessageList from './MessageList';
import CallManager from './CallManager';
import { initAudio, playBeep } from '../utils/helpers';
import emailjs from '@emailjs/browser';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';
import AiAvatarModal from './AiAvatarModal';
import UserProfileModal from './UserProfileModal';
import RoomSettingsModal from './RoomSettingsModal';
import { WifiOff, Trash2, Home, RefreshCcw } from 'lucide-react';

// Hooks
import { useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useIncoAI } from '../hooks/useIncoAI';

interface ChatScreenProps {
  config: ChatConfig;
  onExit: () => void;
}

// --- EMAILJS CONFIGURATION ---
const EMAILJS_SERVICE_ID: string = "service_cnerkn6";
const EMAILJS_TEMPLATE_ID: string = "template_zr9v8bp";
const EMAILJS_PUBLIC_KEY: string = "cSDU4HLqgylnmX957";

const RoomDeletedToast: React.FC<{ onExit: () => void, onRecreate: () => void }> = ({ onExit, onRecreate }) => {
    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-500">
            <div className="relative bg-slate-900/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center overflow-hidden ring-1 ring-white/10">
                <div className="flex flex-col items-center gap-6">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.3)] ring-1 ring-red-500/50">
                         <Trash2 size={40} className="text-red-500" />
                    </div>
                    <div className="space-y-3">
                        <h2 className="text-2xl font-bold text-white tracking-tight">Το δωμάτιο διαγράφηκε</h2>
                        <p className="text-slate-300 text-sm font-medium leading-relaxed">Αυτό το δωμάτιο δεν υπάρχει πλέον. Μπορείτε να το ξαναδημιουργήσετε ή να επιστρέψετε στην αρχική.</p>
                    </div>
                    <div className="flex flex-col gap-3 w-full">
                        <button onClick={onRecreate} className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95"><RefreshCcw size={18} /> Recreate Room</button>
                        <button onClick={onExit} className="w-full py-3.5 px-6 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-transform active:scale-95"><Home size={18} /> Return to Home</button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

const ChatScreen: React.FC<ChatScreenProps> = ({ config, onExit }) => {
  const [user, setUser] = useState<User | null>(null);
  const [inputText, setInputText] = useState('');
  const [roomData, setRoomData] = useState<Room | null>(null);
  
  // UI States
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAiAvatarModal, setShowAiAvatarModal] = useState(false);
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [selectedUserPresence, setSelectedUserPresence] = useState<Presence | null>(null);
  const [selectedUserSubscriber, setSelectedUserSubscriber] = useState<Subscriber | null>(null);
  
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  
  // Room Status
  const [roomDeleted, setRoomDeleted] = useState(false);
  const [isRoomReady, setIsRoomReady] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAvatarUrl, setAiAvatarUrl] = useState('');
  
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') !== 'light');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [canVibrate, setCanVibrate] = useState(false);
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isFirstLoad = useRef(true);
  const prevMessageCount = useRef(0);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser({ uid: session.user.id, isAnonymous: !!session.user.is_anonymous, email: session.user.email });
      }
      setCanVibrate('vibrate' in navigator);
    };
    init();
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  const handleNewMessageReceived = useCallback(async (msg: Message) => {
    if (msg.uid !== user?.uid && msg.type !== 'system') {
        if (soundEnabled) { initAudio(); setTimeout(() => playBeep(), 10); }
        if (vibrationEnabled && canVibrate && 'vibrate' in navigator) navigator.vibrate(200);
        if (document.hidden && notificationsEnabled) {
            new Notification(`New message from ${msg.username}`, { body: msg.text || 'Sent an attachment', icon: 'https://konskall.github.io/incognitochat/favicon-96x96.png' });
        }
    }
  }, [user, soundEnabled, vibrationEnabled, notificationsEnabled, canVibrate]);

  const { messages, isUploading, sendMessage, editMessage, deleteMessage, reactToMessage, uploadFile } = useChatMessages(config.roomKey, config.pin, user?.uid, handleNewMessageReceived);
  const { participants, typingUsers, setTyping } = useRoomPresence(config.roomKey, user, config);
  const { isRecording, recordingDuration, startRecording, stopRecording, cancelRecording } = useAudioRecorder(async (blob, mimeType) => {
      const file = new File([blob], `voice_${Date.now()}.mp4`, { type: mimeType });
      const attachment = await uploadFile(file);
      if (attachment) { await sendMessage("", config, attachment, null, null, 'text'); notifySubscribers('message', 'Sent a voice message'); }
  });
  const isBotResponding = useIncoAI(config.roomKey, config.pin, messages, config, aiEnabled, aiAvatarUrl);
  const combinedTypingUsers = isBotResponding ? [...typingUsers, 'inco'] : typingUsers;

  useEffect(() => {
    const root = document.documentElement;
    const themeColor = isDarkMode ? '#020617' : '#f8fafc';
    if (isDarkMode) { root.classList.add('dark'); root.style.colorScheme = 'dark'; } else { root.classList.remove('dark'); root.style.colorScheme = 'light'; }
    document.querySelector("meta[name='theme-color']")?.setAttribute('content', themeColor);
  }, [isDarkMode]);

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    setShowSettingsMenu(false);
  };

  const toggleNotifications = async () => {
    if (!notificationsEnabled) {
      if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') setNotificationsEnabled(true); else alert("Notification permission denied.");
      } else alert("This browser does not support desktop notifications.");
    } else setNotificationsEnabled(false);
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!inputText.trim() && !selectedFile) || isUploading || isOffline || !isRoomReady || !user) return;
    try {
      if (editingMessageId) { await editMessage(editingMessageId, inputText); setEditingMessageId(null); setInputText(''); }
      else {
        let attachment = null;
        if (selectedFile) { attachment = await uploadFile(selectedFile); setSelectedFile(null); }
        await sendMessage(inputText, config, attachment, replyingTo, null, 'text');
        setInputText(''); setReplyingTo(null); notifySubscribers('message', attachment ? 'Sent an attachment' : (inputText || 'Sent a message'));
      }
    } catch (error) { console.error("Failed to send message", error); }
  };

  const handleSendLocation = async () => {
    if (!navigator.geolocation) { alert("Geolocation is not supported by your browser"); return; }
    setIsGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try { await sendMessage("Shared my location", config, null, null, { lat: latitude, lng: longitude }, 'text'); notifySubscribers('message', 'Shared a location'); }
        catch (error) { console.error("Error sending location:", error); }
        finally { setIsGettingLocation(false); }
      },
      (error) => { console.error("Geolocation error:", error); setIsGettingLocation(false); alert("Unable to retrieve your location."); },
      { timeout: 10000 }
    );
  };

  const initRoom = useCallback(async () => {
    if (!user || !config.roomKey) return;
    try {
      const { data: room } = await supabase.from('rooms').select('*').eq('room_key', config.roomKey).maybeSingle();
      if (room) {
           setRoomData(room);
           setAiEnabled(!!room.ai_enabled);
           setAiAvatarUrl(room.ai_avatar_url || '');
           setIsRoomReady(true);
           setRoomDeleted(false);
      } else {
           const sessionKey = `joined_${config.roomKey}`;
           if (sessionStorage.getItem(sessionKey)) { setRoomDeleted(true); } 
           else {
               const { error: insertError } = await supabase.from('rooms').insert({ room_key: config.roomKey, room_name: config.roomName, pin: config.pin, created_by: user.uid, ai_enabled: false });
               if (!insertError) { await sendMessage(`Room created by ${config.username}`, config, null, null, null, 'system'); }
               initRoom();
           }
      }
    } catch (error) { setIsRoomReady(true); }
  }, [user, config, sendMessage]);

  useEffect(() => {
    initRoom();
    const handleVisibility = () => { if (document.visibilityState === 'visible') initRoom(); };
    window.addEventListener('focus', handleVisibility);
    return () => { window.removeEventListener('focus', handleVisibility); };
  }, [initRoom]);

  const notifySubscribers = async (action: 'message' | 'deleted' | 'joined', details: string) => {
    if (!config.roomKey || !user || action === 'joined') return;
    const { data } = await supabase.from('subscribers').select('*').eq('room_key', config.roomKey);
    if (!data || data.length === 0) return;
    const onlineUserIds = new Set(participants.map(p => p.uid));
    const recipients = (data as Subscriber[]).filter(s => s.uid !== user.uid && !onlineUserIds.has(s.uid)).map(s => s.email).filter(Boolean);
    if (recipients.length > 0) {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, { to_email: recipients.join(','), room_name: config.roomName, action_type: action === 'deleted' ? 'Room Deleted' : 'New Message', sender_name: config.username, message_body: details, link: window.location.href }, EMAILJS_PUBLIC_KEY);
    }
  };

  useEffect(() => {
    if (!messagesEndRef.current) return;
    if (isFirstLoad.current && messages.length > 0) { messagesEndRef.current.scrollIntoView({ behavior: "auto" }); isFirstLoad.current = false; }
    else if (messages.length > prevMessageCount.current) { messagesEndRef.current.scrollIntoView({ behavior: "smooth" }); }
    prevMessageCount.current = messages.length;
  }, [messages]);

  const handleRoomUpdate = (updates: Partial<Room>) => {
    setRoomData(prev => prev ? { ...prev, ...updates } : null);
  };

  const getBackgroundStyle = () => {
    if (!roomData) return {};
    if (roomData.background_type === 'image' && roomData.background_url) {
        return { backgroundImage: `url(${roomData.background_url})`, backgroundSize: 'cover', backgroundPosition: 'center' };
    }
    if (roomData.background_preset && roomData.background_preset !== 'none') {
        const presets: Record<string, string> = {
            'prism': 'https://www.transparenttextures.com/patterns/cubes.png',
            'grid': 'https://www.transparenttextures.com/patterns/stardust.png',
            'circuit': 'https://www.transparenttextures.com/patterns/circuit-board.png',
            'waves': 'https://www.transparenttextures.com/patterns/double-lined-grid.png',
            'polygons': 'https://www.transparenttextures.com/patterns/diagonal-striped-brick.png'
        };
        const url = presets[roomData.background_preset];
        if (url) return { backgroundImage: `url(${url})`, backgroundSize: '80px', backgroundRepeat: 'repeat' };
    }
    return { backgroundImage: `radial-gradient(${isDarkMode ? '#334155' : '#cbd5e1'} 1px, transparent 1px)`, backgroundSize: '20px 20px' };
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
        await supabase.from('rooms').delete().eq('room_key', config.roomKey);
        notifySubscribers('deleted', 'The room has been closed.');
        onExit();
    } catch (err) {
        alert("Delete failed");
    } finally {
        setIsDeleting(false);
        setShowDeleteModal(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!emailAddress) return;
    setIsSavingEmail(true);
    try {
        const { error } = await supabase.from('subscribers').upsert({
            room_key: config.roomKey,
            uid: user?.uid,
            username: config.username,
            email: emailAddress
        }, { onConflict: 'room_key, uid' });
        if (error) throw error;
        setEmailAlertsEnabled(true);
        setShowEmailModal(false);
    } catch (err) {
        alert("Failed to save email");
    } finally {
        setIsSavingEmail(false);
    }
  };

  const handleUserClick = async (uid: string) => {
    const presence = participants.find(p => p.uid === uid);
    if (!presence) return;
    
    setSelectedUserPresence(presence);
    
    const { data } = await supabase.from('subscribers')
        .select('*')
        .eq('room_key', config.roomKey)
        .eq('uid', uid)
        .maybeSingle();
        
    setSelectedUserSubscriber(data);
  };

  const isOwner = user?.uid === roomData?.created_by;

  return (
    <div className="fixed inset-0 flex flex-col h-[100dvh] w-full bg-slate-100 dark:bg-slate-900 max-w-5xl mx-auto shadow-2xl overflow-hidden z-50 md:relative md:inset-auto md:rounded-2xl md:my-4 md:h-[95vh] md:border border-white/40 dark:border-slate-800 transition-colors">
      {roomDeleted && <RoomDeletedToast onExit={onExit} onRecreate={() => { setRoomDeleted(false); initRoom(); }} />}
      {isOffline && <div className="absolute top-20 left-0 right-0 flex justify-center z-40"><div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900/90 dark:bg-white/90 rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20 text-xs font-bold text-white dark:text-slate-900"><WifiOff size={14} className="text-red-500 animate-pulse" /> Χωρίς Σύνδεση</div></div>}

      {user && isRoomReady && !roomDeleted && (
          <CallManager user={user} config={config} users={participants} showParticipants={showParticipantsList} onCloseParticipants={() => setShowParticipantsList(false)} roomCreatorId={roomData?.created_by} />
      )}

      <ChatHeader
        config={config} roomData={roomData} participants={participants}
        isRoomReady={isRoomReady && !roomDeleted}
        showParticipantsList={showParticipantsList} setShowParticipantsList={setShowParticipantsList}
        showSettingsMenu={showSettingsMenu} setShowSettingsMenu={setShowSettingsMenu}
        canVibrate={canVibrate} vibrationEnabled={vibrationEnabled} setVibrationEnabled={setVibrationEnabled}
        soundEnabled={soundEnabled} setSoundEnabled={setSoundEnabled}
        notificationsEnabled={notificationsEnabled} toggleNotifications={toggleNotifications}
        emailAlertsEnabled={emailAlertsEnabled} setShowEmailModal={setShowEmailModal}
        isDarkMode={isDarkMode} toggleTheme={toggleTheme}
        setShowDeleteModal={setShowDeleteModal} onExit={onExit} isOwner={isOwner}
        isGoogleUser={user ? !user.isAnonymous : false} aiEnabled={aiEnabled}
        onToggleAI={() => { const n = !aiEnabled; setAiEnabled(n); supabase.from('rooms').update({ ai_enabled: n }).eq('room_key', config.roomKey).then(); }}
        onOpenAiAvatar={() => setShowAiAvatarModal(true)} onOpenRoomSettings={() => setShowRoomSettings(true)}
      />

      <main className="flex-1 overflow-y-auto overscroll-contain p-4 pb-20 bg-slate-50/50 dark:bg-slate-950/50 relative" style={getBackgroundStyle()}>
        <div className={`absolute inset-0 pointer-events-none ${roomData?.background_preset && roomData.background_preset !== 'none' ? (isDarkMode ? 'bg-slate-950/50' : 'bg-white/50') : ''}`}></div>
        <div className="relative z-10">
          <MessageList messages={messages} currentUserUid={user?.uid || ''} onEdit={(msg) => { setInputText(msg.text); setEditingMessageId(msg.id); }} onDelete={deleteMessage} onReact={reactToMessage} onReply={setReplyingTo} onUserClick={handleUserClick} />
          <div ref={messagesEndRef} />
        </div>
      </main>

      {!roomDeleted && <ChatInput inputText={inputText} setInputText={setInputText} handleSend={handleSend} handleInputChange={(e) => { setInputText(e.target.value); setTyping(true); }} handleKeyDown={(e) => { if(e.key==='Enter'&&!e.shiftKey) handleSend(); }} isRecording={isRecording} recordingDuration={recordingDuration} startRecording={startRecording} stopRecording={stopRecording} cancelRecording={cancelRecording} selectedFile={selectedFile} setSelectedFile={setSelectedFile} isUploading={isUploading} isGettingLocation={isGettingLocation} handleSendLocation={handleSendLocation} editingMessageId={editingMessageId} cancelEdit={() => { setEditingMessageId(null); setInputText(''); }} replyingTo={replyingTo} cancelReply={() => setReplyingTo(null)} isOffline={isOffline} isRoomReady={isRoomReady} typingUsers={combinedTypingUsers} />}

      <DeleteChatModal show={showDeleteModal} onCancel={() => setShowDeleteModal(false)} onConfirm={handleDeleteConfirm} isDeleting={isDeleting} />
      <EmailAlertModal show={showEmailModal} onCancel={() => setShowEmailModal(false)} onSave={handleSaveEmail} isSaving={isSavingEmail} emailAlertsEnabled={emailAlertsEnabled} onToggleOff={() => setEmailAlertsEnabled(false)} emailAddress={emailAddress} setEmailAddress={setEmailAddress} />
      <AiAvatarModal show={showAiAvatarModal} onClose={() => setShowAiAvatarModal(false)} currentAvatarUrl={aiAvatarUrl} roomKey={config.roomKey} onUpdate={setAiAvatarUrl} />

      {selectedUserPresence && <UserProfileModal user={selectedUserPresence} subscriberInfo={selectedUserSubscriber} isRoomOwner={selectedUserPresence.uid === roomData?.created_by} onClose={() => setSelectedUserPresence(null)} />}
      
      {showRoomSettings && roomData && (
          <RoomSettingsModal
            room={roomData} creatorName={participants.find(p => p.uid === roomData.created_by)?.username || "Host"}
            onClose={() => setShowRoomSettings(false)} onUpdate={handleRoomUpdate}
          />
      )}
    </div>
  );
};

export default ChatScreen;
