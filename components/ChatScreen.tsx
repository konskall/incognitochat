
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { ChatConfig, Message, User, Subscriber } from '../types';
import MessageList from './MessageList';
import CallManager from './CallManager';
import { initAudio, playBeep } from '../utils/helpers';
import emailjs from '@emailjs/browser';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';
import { WifiOff } from 'lucide-react';

// Hooks
import { useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

interface ChatScreenProps {
  config: ChatConfig;
  onExit: () => void;
}

// --- EMAILJS CONFIGURATION ---
const EMAILJS_SERVICE_ID: string = "service_cnerkn6";
const EMAILJS_TEMPLATE_ID: string = "template_zr9v8bp";
const EMAILJS_PUBLIC_KEY: string = "cSDU4HLqgylnmX957";

const ChatScreen: React.FC<ChatScreenProps> = ({ config, onExit }) => {
  const [user, setUser] = useState<User | null>(null);
  const [inputText, setInputText] = useState('');
  
  // UI States
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  
  // Room & Creator State
  const [isRoomReady, setIsRoomReady] = useState(false);
  const [roomCreatorId, setRoomCreatorId] = useState<string | null>(null);
  
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  // Edit & Reply State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Notification, Sound & Vibration State
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [canVibrate, setCanVibrate] = useState(false);

  // Email Alert State
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  
  // File & Location handling state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isFirstLoad = useRef(true);
  const prevMessageCount = useRef(0);

  // --- CUSTOM HOOKS INTEGRATION ---
  
  // 1. Message Handling
  const handleNewMessageReceived = useCallback(async (msg: Message) => {
    // Only notify if message is NOT from me and NOT system
    if (msg.uid !== user?.uid && msg.type !== 'system') {
        if (soundEnabled) {
            initAudio();
            setTimeout(() => playBeep(), 10);
        }
        
        if (vibrationEnabled && canVibrate && 'vibrate' in navigator) {
            navigator.vibrate(200);
        }

        if (document.hidden && notificationsEnabled) {
            new Notification(`New message from ${msg.username}`, {
                body: msg.text || 'Sent an attachment',
                icon: '/favicon-96x96.png'
            });
        }
    }
  }, [user, soundEnabled, vibrationEnabled, notificationsEnabled, canVibrate]);

  // Updated hook: Passing config.pin to allow AES decryption
  const { 
    messages, 
    isUploading, 
    sendMessage, 
    editMessage, 
    deleteMessage, 
    reactToMessage, 
    uploadFile 
  } = useChatMessages(config.roomKey, config.pin, user?.uid, handleNewMessageReceived);

  // 2. Presence Handling
  const { participants, typingUsers, setTyping } = useRoomPresence(config.roomKey, user, config);

  // 3. Audio Recorder Handling
  const handleRecordingComplete = async (blob: Blob, mimeType: string) => {
      try {
           const ext = mimeType.includes('mp4') || mimeType.includes('aac') ? 'mp4' : 'webm';
           const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
           const attachment = await uploadFile(file);
           if (attachment) {
               await sendMessage("", config, attachment, null, null, 'text');
               notifySubscribers('message', 'Sent a voice message');
           }
      } catch (e) {
          console.error("Failed to upload voice", e);
      }
  };

  const {
      isRecording,
      recordingDuration,
      startRecording,
      stopRecording,
      cancelRecording
  } = useAudioRecorder(handleRecordingComplete);


  // --- SIDE EFFECTS ---

  // Theme effect
  useEffect(() => {
    const root = document.documentElement;
    const darkColor = '#020617'; 
    const lightColor = '#f8fafc';
    const themeColor = isDarkMode ? darkColor : lightColor;

    if (isDarkMode) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    
    // Update PWA theme color dynamically
    let meta = document.querySelector("meta[name='theme-color']");
    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
    }
    meta.setAttribute('content', themeColor);
  }, [isDarkMode]);

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    setShowSettingsMenu(false);
  };

  const notifySubscribers = async (action: 'message' | 'deleted' | 'joined', details: string) => {
      if (!config.roomKey || !user) return;
      try {
          const { data, error } = await supabase
            .from('subscribers')
            .select('*')
            .eq('room_key', config.roomKey);
          
          if (error) return;
          const subscribers = data as Subscriber[];
          if (!subscribers || subscribers.length === 0) return;

          const recipients: string[] = [];
          subscribers.forEach(sub => {
              if (sub.uid !== user.uid && sub.email) {
                  recipients.push(sub.email);
              }
          });

          if (recipients.length > 0) {
              let actionLabel = 'New Message';
              if (action === 'deleted') actionLabel = 'Room Deleted';
              if (action === 'joined') actionLabel = 'New Participant';

              const emailParams = {
                  to_email: recipients.join(','), // Fixed: join requires comma
                  room_name: config.roomName,
                  action_type: actionLabel,
                  sender_name: config.username, 
                  message_body: details,
                  link: window.location.href
              };
              
              await emailjs.send(
                  EMAILJS_SERVICE_ID,
                  EMAILJS_TEMPLATE_ID,
                  emailParams,
                  EMAILJS_PUBLIC_KEY
              );
          }
      } catch (e) {
          console.error("EmailJS Failed", e);
      }
  };

  // Auth Status & Network
  useEffect(() => {
    const checkUser = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
             // Correctly populate user object including email from session
             setUser({ 
                 uid: session.user.id, 
                 isAnonymous: session.user.is_anonymous ?? false,
                 email: session.user.email 
             });
        } else {
             const { data: anonData } = await supabase.auth.signInAnonymously();
             if (anonData.user) {
                 setUser({ uid: anonData.user.id, isAnonymous: true });
             }
        }
    };
    checkUser();

    const handleNetworkChange = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);
    if ('Notification' in window && Notification.permission === 'granted') setNotificationsEnabled(true);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) setCanVibrate(true);

    return () => {
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
    };
  }, []);

  // Room Init
  useEffect(() => {
    const initRoom = async () => {
      if (!user || !config.roomKey) return;
      try {
        const { data: room } = await supabase
            .from('rooms')
            .select('*')
            .eq('room_key', config.roomKey)
            .maybeSingle();

        if (room) {
             setRoomCreatorId(room.created_by);
        } else {
             const { error: insertError } = await supabase
                .from('rooms')
                .insert({
                    room_key: config.roomKey,
                    room_name: config.roomName,
                    pin: config.pin,
                    created_by: user.uid
                });
             if (!insertError) {
                 setRoomCreatorId(user.uid);
                 await sendMessage(`Room created by ${config.username}`, config, null, null, null, 'system');
             }
        }
        setIsRoomReady(true);
      } catch (error) {
        console.error("Error initializing room:", error);
        setIsRoomReady(true); 
      }
    };
    initRoom();
  }, [user, config.roomKey]);

  // Check Subscription
  useEffect(() => {
      if (isRoomReady && user && config.roomKey) {
          const checkSubscription = async () => {
              const { data } = await supabase
                .from('subscribers')
                .select('email')
                .eq('room_key', config.roomKey)
                .eq('uid', user.uid)
                .maybeSingle();

              if (data) {
                  setEmailAlertsEnabled(true);
                  setEmailAddress(data.email);
              } else if (user.email) {
                  // Auto-fill with user's login email if available and not already subscribed
                  setEmailAddress(user.email);
              }
          };
          checkSubscription();
      }
  }, [isRoomReady, user, config.roomKey]);

  // Join Message
  useEffect(() => {
      if (isRoomReady && user && config.roomKey) {
          const sessionKey = `joined_${config.roomKey}`;
          if (!sessionStorage.getItem(sessionKey)) {
              sendMessage(`${config.username} joined the room`, config, null, null, null, 'system');
              notifySubscribers('joined', `${config.username} has entered the room.`);
              sessionStorage.setItem(sessionKey, 'true');
          }
      }
  }, [isRoomReady, user, config.roomKey]);

  // Scroll to bottom
  useEffect(() => {
    if (!messagesEndRef.current) return;
    if (isFirstLoad.current && messages.length > 0) {
        messagesEndRef.current.scrollIntoView({ behavior: "auto" });
        isFirstLoad.current = false;
    } else if (messages.length > prevMessageCount.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCount.current = messages.length;
  }, [messages]);

  // Room Deletion Listener
  useEffect(() => {
    if (!config.roomKey || !isRoomReady) return;
    const roomStatusChannel = supabase.channel(`room_status:${config.roomKey}`)
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'rooms',
        filter: `room_key=eq.${config.roomKey}`
      }, () => {
        alert("This room has been deleted by the host.");
        onExit();
      })
      .subscribe();
    return () => { supabase.removeChannel(roomStatusChannel); };
  }, [config.roomKey, isRoomReady]);


  // --- HANDLERS ---

  const handleExitChat = async () => {
      if (config.roomKey) {
          await sendMessage(`${config.username} left the room`, config, null, null, null, 'system');
          sessionStorage.removeItem(`joined_${config.roomKey}`);
          
          // Cleanup subscriptions is handled by hooks unmounting
      }
      onExit();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      setTyping(true);
  };

  const handleSend = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if ((!inputText.trim() && !selectedFile) || !user) return;
      
      const textToSend = inputText.trim();
      setInputText('');
      setTyping(false);
      setSelectedFile(null);
      setReplyingTo(null);

      if (editingMessageId) {
          await editMessage(editingMessageId, textToSend);
          setEditingMessageId(null);
      } else {
          let attachment = null;
          if (selectedFile) {
              attachment = await uploadFile(selectedFile);
          }
          await sendMessage(textToSend, config, attachment, replyingTo, null, 'text');
          notifySubscribers('message', textToSend || 'Sent a file');
      }
  };

  const handleSendLocation = async () => {
       if (!navigator.geolocation || !user) return;
       setIsGettingLocation(true);
       navigator.geolocation.getCurrentPosition(async (pos) => {
           try {
               await sendMessage("📍 Shared a location", config, null, null, { lat: pos.coords.latitude, lng: pos.coords.longitude }, 'text');
               notifySubscribers('message', 'Shared a location');
           } catch(e) { console.error(e); }
           finally { setIsGettingLocation(false); }
       });
  };

  const handleEditMessage = useCallback((msg: Message) => {
      setInputText(msg.text);
      setEditingMessageId(msg.id);
      setReplyingTo(null);
      setSelectedFile(null);
  }, []);
  
  const handleReply = useCallback((msg: Message) => {
      setReplyingTo(msg);
      setEditingMessageId(null);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
      }
      if (e.key === 'Escape') {
          setEditingMessageId(null);
          setReplyingTo(null);
          setInputText('');
      }
  };

  const handleDeleteChat = async () => {
      if (!config.roomKey) return;
      setIsDeleting(true);
      try {
           await notifySubscribers('deleted', 'Room was deleted by host');
           
           const { data: files } = await supabase.storage.from('attachments').list(config.roomKey);
           if (files && files.length > 0) {
               const filesToRemove = files.map(x => `${config.roomKey}/${x.name}`);
               await supabase.storage.from('attachments').remove(filesToRemove);
           }
           
           await supabase.from('rooms').delete().eq('room_key', config.roomKey);
           onExit();
      } catch(e) {
          console.error("Delete failed", e);
      } finally {
          setIsDeleting(false);
      }
  };
  
  // Settings & Subs
  const toggleNotifications = async () => {
      if (notificationsEnabled) {
          setNotificationsEnabled(false);
      } else {
          const p = await Notification.requestPermission();
          if (p === 'granted') setNotificationsEnabled(true);
      }
      setShowSettingsMenu(false);
  };

  const handleEmailToggle = async () => {
      if (!user || !config.roomKey) return;
      if (emailAlertsEnabled) {
          await supabase.from('subscribers').delete().eq('room_key', config.roomKey).eq('uid', user.uid);
          setEmailAlertsEnabled(false);
          setEmailAddress('');
          setShowEmailModal(false);
      } else {
          setShowEmailModal(true);
      }
  };

  const saveEmailSubscription = async () => {
      if (!user || !config.roomKey || !emailAddress.includes('@')) {
          alert("Please enter a valid email.");
          return;
      }
      setIsSavingEmail(true);
      try {
          await supabase.from('subscribers').insert({
              room_key: config.roomKey,
              uid: user.uid,
              username: config.username,
              email: emailAddress
          });
          setEmailAlertsEnabled(true);
          setShowEmailModal(false);
          setShowSettingsMenu(false);
      } catch (e: any) {
          console.error("Error saving email:", e);
          alert("Failed to subscribe.");
      } finally {
          setIsSavingEmail(false);
      }
  };

  return (
    <div className="fixed inset-0 flex flex-col h-[100dvh] w-full bg-slate-100 dark:bg-slate-900 max-w-5xl mx-auto shadow-2xl overflow-hidden z-50 md:relative md:inset-auto md:rounded-2xl md:my-4 md:h-[95vh] md:border border-white/40 dark:border-slate-800 transition-colors">
      {/* Offline Indicator */}
      {isOffline && (
        <div className="absolute top-20 left-0 right-0 flex justify-center z-40 pointer-events-none animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
              <div className="bg-red-500/20 p-1.5 rounded-full">
                <WifiOff size={14} className="text-red-500 animate-pulse" />
              </div>
              <span className="text-xs font-bold text-white dark:text-slate-900">No Connection</span>
          </div>
        </div>
      )}

      {user && isRoomReady && (
          <CallManager 
            user={user}
            config={config}
            users={participants}
            showParticipants={showParticipantsList}
            onCloseParticipants={() => setShowParticipantsList(false)}
            roomCreatorId={roomCreatorId}
          />
      )}

      <ChatHeader
        config={config}
        participants={participants}
        isRoomReady={isRoomReady}
        showParticipantsList={showParticipantsList}
        setShowParticipantsList={setShowParticipantsList}
        showSettingsMenu={showSettingsMenu}
        setShowSettingsMenu={setShowSettingsMenu}
        canVibrate={canVibrate}
        vibrationEnabled={vibrationEnabled}
        setVibrationEnabled={setVibrationEnabled}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        notificationsEnabled={notificationsEnabled}
        toggleNotifications={toggleNotifications}
        emailAlertsEnabled={emailAlertsEnabled}
        setShowEmailModal={setShowEmailModal}
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
        setShowDeleteModal={setShowDeleteModal}
        onExit={handleExitChat}
      />

      <main 
        className="flex-1 overflow-y-auto overscroll-contain p-4 pb-20 bg-slate-50/50 dark:bg-slate-950/50" 
        style={{
            backgroundImage: `radial-gradient(${isDarkMode ? '#334155' : '#cbd5e1'} 1px, transparent 1px)`, 
            backgroundSize: '20px 20px'
        }}
      >
        <MessageList 
            messages={messages} 
            currentUserUid={user?.uid || ''} 
            onEdit={handleEditMessage}
            onDelete={deleteMessage}
            onReply={handleReply}
            onReact={reactToMessage}
        />
        <div ref={messagesEndRef} />
      </main>

      <ChatInput
        inputText={inputText}
        setInputText={setInputText}
        handleSend={handleSend}
        handleInputChange={handleInputChange}
        handleKeyDown={handleKeyDown}
        isRecording={isRecording}
        recordingDuration={recordingDuration}
        startRecording={startRecording}
        stopRecording={stopRecording}
        cancelRecording={cancelRecording}
        selectedFile={selectedFile}
        setSelectedFile={setSelectedFile}
        isUploading={isUploading}
        isGettingLocation={isGettingLocation}
        handleSendLocation={handleSendLocation}
        editingMessageId={editingMessageId}
        cancelEdit={() => { setEditingMessageId(null); setInputText(''); }}
        replyingTo={replyingTo}
        cancelReply={() => setReplyingTo(null)}
        isOffline={isOffline}
        isRoomReady={isRoomReady}
        typingUsers={typingUsers}
      />

      <DeleteChatModal 
        show={showDeleteModal} 
        onCancel={() => setShowDeleteModal(false)} 
        onConfirm={handleDeleteChat} 
        isDeleting={isDeleting} 
      />

      <EmailAlertModal 
        show={showEmailModal} 
        onCancel={() => setShowEmailModal(false)} 
        onSave={saveEmailSubscription} 
        isSaving={isSavingEmail} 
        emailAlertsEnabled={emailAlertsEnabled} 
        onToggleOff={handleEmailToggle} 
        emailAddress={emailAddress} 
        setEmailAddress={setEmailAddress} 
      />
    </div>
  );
};

export default ChatScreen;
