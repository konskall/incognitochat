
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { ChatConfig, Message, User, Subscriber, Presence } from '../types';
import MessageList from './MessageList';
import CallManager from './CallManager';
import { initAudio, playBeep } from '../utils/helpers';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import ChatModalsContainer from './ChatModalsContainer';
import { WifiOff, Trash2, Home, RefreshCcw } from 'lucide-react';
import { createPortal } from 'react-dom';

// Hooks
import { useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useIncoAI } from '../hooks/useIncoAI';
import { useChatSettings } from '../hooks/useChatSettings';
import { useRoomManagement } from '../hooks/useRoomManagement';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';

interface ChatScreenProps {
  config: ChatConfig;
  onExit: () => void;
}

const RoomDeletedToast: React.FC<{ onExit: () => void, onRecreate: () => void }> = ({ onExit, onRecreate }) => {
    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-500">
            <div className="relative bg-slate-900/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center overflow-hidden ring-1 ring-white/10">
                <div className="flex flex-col items-center gap-6">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.3)] ring-1 ring-red-500/50">
                         <Trash2 size={40} className="text-red-500" />
                    </div>
                    <div className="space-y-3">
                        <h2 className="text-2xl font-bold text-white tracking-tight">The room was deleted</h2>
                        <p className="text-slate-300 text-sm font-medium leading-relaxed">This room no longer exists.</p>
                    </div>
                    <div className="flex flex-col gap-3 w-full">
                        <button onClick={onRecreate} className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all transform active:scale-95 flex items-center justify-center gap-2">
                            <RefreshCcw size={18} /> Recreate Room
                        </button>
                        <button onClick={onExit} className="w-full py-3.5 px-6 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-all transform active:scale-95 flex items-center justify-center gap-2">
                            <Home size={18} /> Return to Home
                        </button>
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
  
  // UI Control States
  const [modals, setModals] = useState({ delete: false, email: false, ai: false });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{presence: Presence | null, sub: Subscriber | null}>({presence: null, sub: null});
  const [ui, setUI] = useState({ participants: false, settings: false, offline: !navigator.onLine });
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize Hooks
  const handleNewMsg = useCallback(async (msg: Message) => {
    if (msg.uid !== user?.uid && msg.type !== 'system') {
        if (settings.soundEnabled) { initAudio(); playBeep(); }
        if (settings.vibrationEnabled && 'vibrate' in navigator) navigator.vibrate(200);
    }
  }, [user]);

  const { messages, isUploading, sendMessage, editMessage, deleteMessage, reactToMessage, uploadFile } = useChatMessages(config.roomKey, config.pin, user?.uid, handleNewMsg);
  const { participants, typingUsers, setTyping } = useRoomPresence(config.roomKey, user, config);
  const room = useRoomManagement(config, user, onExit);
  const settings = useChatSettings(config, user, participants);
  
  const handleRecordingComplete = async (blob: Blob, mimeType: string) => {
      const file = new File([blob], `voice_${Date.now()}.mp4`, { type: mimeType });
      const attachment = await uploadFile(file);
      if (attachment) {
          await sendMessage("", config, attachment, null, null, 'text');
          settings.notifySubscribers('message', 'Sent a voice message');
      }
  };

  const { isRecording, recordingDuration, startRecording, stopRecording, cancelRecording } = useAudioRecorder(handleRecordingComplete);
  const isBotResponding = useIncoAI(config.roomKey, config.pin, messages, config, room.aiEnabled, room.aiAvatarUrl);

  useEffect(() => {
    const checkUser = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user ? { uid: session.user.id, isAnonymous: !!session.user.is_anonymous, email: session.user.email } : null);
    };
    checkUser();
  }, []);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && !selectedFile) || !user || room.roomDeleted) return;
    const text = inputText.trim();
    setInputText(''); setTyping(false); setSelectedFile(null); setReplyingTo(null);

    if (editingMessageId) {
        await editMessage(editingMessageId, text);
        setEditingMessageId(null);
    } else {
        const attachment = selectedFile ? await uploadFile(selectedFile) : null;
        await sendMessage(text, config, attachment, replyingTo, null, 'text');
        settings.notifySubscribers('message', text || 'Sent a file');
    }
  };

  const handleUserClick = async (uid: string, username: string, avatar: string) => {
      if (uid === INCO_BOT_UUID) return;
      const p = participants.find(x => x.uid === uid) || { uid, username, avatar, status: 'inactive', isTyping: false, onlineAt: '' } as Presence;
      const { data } = await supabase.from('subscribers').select('*').eq('room_key', config.roomKey).eq('uid', uid).maybeSingle();
      setSelectedUser({ presence: p, sub: data as Subscriber });
  };

  return (
    <div className="fixed inset-0 flex flex-col h-[100dvh] w-full bg-slate-100 dark:bg-slate-900 max-w-5xl mx-auto shadow-2xl overflow-hidden z-50 md:relative md:inset-auto md:rounded-2xl md:my-4 md:h-[95vh] md:border border-white/40 dark:border-slate-800 transition-colors">
      
      {room.roomDeleted && <RoomDeletedToast onExit={onExit} onRecreate={room.handleRecreate} />}

      {ui.offline && (
        <div className="absolute top-20 left-0 right-0 flex justify-center z-40 pointer-events-none animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
              <WifiOff size={14} className="text-red-500 animate-pulse" />
              <span className="text-xs font-bold text-white dark:text-slate-900">Χωρίς Σύνδεση</span>
          </div>
        </div>
      )}

      {user && room.isRoomReady && !room.roomDeleted && (
          <CallManager user={user} config={config} users={participants} showParticipants={ui.participants} onCloseParticipants={() => setUI({...ui, participants: false})} roomCreatorId={room.roomCreatorId} />
      )}

      <ChatHeader
        config={config} participants={participants} isRoomReady={room.isRoomReady && !room.roomDeleted}
        showParticipantsList={ui.participants} setShowParticipantsList={(v) => setUI({...ui, participants: v})}
        showSettingsMenu={ui.settings} setShowSettingsMenu={(v) => setUI({...ui, settings: v})}
        canVibrate={settings.canVibrate} vibrationEnabled={settings.vibrationEnabled} setVibrationEnabled={settings.setVibrationEnabled}
        soundEnabled={settings.soundEnabled} setSoundEnabled={settings.setSoundEnabled}
        notificationsEnabled={settings.notificationsEnabled} toggleNotifications={settings.toggleNotifications}
        emailAlertsEnabled={settings.emailAlertsEnabled} setShowEmailModal={(v) => setModals({...modals, email: v})}
        isDarkMode={settings.isDarkMode} toggleTheme={() => settings.setIsDarkMode(!settings.isDarkMode)}
        setShowDeleteModal={(v) => setModals({...modals, delete: v})}
        onExit={onExit} isOwner={user?.uid === room.roomCreatorId} isGoogleUser={user ? !user.isAnonymous : false}
        aiEnabled={room.aiEnabled} onToggleAI={() => room.setAiEnabled(!room.aiEnabled)} onOpenAiAvatar={() => setModals({...modals, ai: true})}
      />

      <main className="flex-1 overflow-y-auto overscroll-contain p-4 pb-20 bg-slate-50/50 dark:bg-slate-950/50" style={{ backgroundImage: `radial-gradient(${settings.isDarkMode ? '#334155' : '#cbd5e1'} 1px, transparent 1px)`, backgroundSize: '20px 20px' }}>
        <MessageList messages={messages} currentUserUid={user?.uid || ''} onEdit={(m) => { setInputText(m.text); setEditingMessageId(m.id); }} onDelete={deleteMessage} onReply={setReplyingTo} onReact={reactToMessage} onUserClick={handleUserClick} />
        <div ref={messagesEndRef} />
      </main>

      {!room.roomDeleted && (
        <ChatInput
            inputText={inputText} setInputText={setInputText} handleSend={handleSend} handleInputChange={(e) => { setInputText(e.target.value); setTyping(true); }}
            handleKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            isRecording={isRecording} recordingDuration={recordingDuration} startRecording={startRecording} stopRecording={stopRecording} cancelRecording={cancelRecording}
            selectedFile={selectedFile} setSelectedFile={setSelectedFile} isUploading={isUploading}
            isGettingLocation={isGettingLocation} handleSendLocation={async () => { setIsGettingLocation(true); navigator.geolocation.getCurrentPosition(p => sendMessage("📍 Location", config, null, null, {lat:p.coords.latitude, lng:p.coords.longitude})) }}
            editingMessageId={editingMessageId} cancelEdit={() => setEditingMessageId(null)}
            replyingTo={replyingTo} cancelReply={() => setReplyingTo(null)}
            isOffline={ui.offline} isRoomReady={room.isRoomReady} typingUsers={isBotResponding ? [...typingUsers, 'inco'] : typingUsers}
        />
      )}

      <ChatModalsContainer 
        showDeleteModal={modals.delete} setShowDeleteModal={(v) => setModals({...modals, delete: v})} handleDeleteChat={async () => { setIsDeleting(true); try { await room.deleteRoom(); } finally { setIsDeleting(false); } }} isDeleting={isDeleting}
        showEmailModal={modals.email} setShowEmailModal={(v) => setModals({...modals, email: v})} 
        saveEmailSubscription={async () => { setIsSavingEmail(true); try { await supabase.from('subscribers').upsert({room_key:config.roomKey, uid:user?.uid, email:settings.emailAddress}); setModals({...modals, email: false}); settings.setEmailAlertsEnabled(true); } finally { setIsSavingEmail(false); } }}
        isSavingEmail={isSavingEmail} emailAlertsEnabled={settings.emailAlertsEnabled} handleEmailToggle={() => settings.setEmailAlertsEnabled(false)}
        emailAddress={settings.emailAddress} setEmailAddress={settings.setEmailAddress}
        showAiAvatarModal={modals.ai} setShowAiAvatarModal={(v) => setModals({...modals, ai: v})} aiAvatarUrl={room.aiAvatarUrl} roomKey={config.roomKey} setAiAvatarUrl={room.setAiAvatarUrl}
        selectedUserPresence={selectedUser.presence} selectedUserSubscriber={selectedUser.sub} roomCreatorId={room.roomCreatorId} closeUserProfile={() => setSelectedUser({presence: null, sub: null})}
      />
    </div>
  );
};

export default ChatScreen;
