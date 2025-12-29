
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabase';
import { ChatConfig, Message, User, Subscriber, Presence } from '../types';
import MessageList from './MessageList';
import CallManager from './CallManager';
import { initAudio, playBeep } from '../utils/helpers';
import emailjs from '@emailjs/browser';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';
import AiAvatarModal from './AiAvatarModal';
import UserProfileModal from './UserProfileModal';
import { WifiOff, Trash2, Home } from 'lucide-react';

// Hooks
import { useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useIncoAI } from '../hooks/useIncoAI';

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';

interface ChatScreenProps {
  config: ChatConfig;
  onExit: () => void;
}

// --- EMAILJS CONFIGURATION ---
const EMAILJS_SERVICE_ID: string = "service_cnerkn6";
const EMAILJS_TEMPLATE_ID: string = "template_zr9v8bp";
const EMAILJS_PUBLIC_KEY: string = "cSDU4HLqgylnmX957";

// Notification Cooldown in Minutes
const NOTIFICATION_COOLDOWN_MINUTES = 30;

// -- Custom Room Deleted Toast (Persistent) --
const RoomDeletedToast: React.FC<{ onExit: () => void }> = ({ onExit }) => {
    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-500">
            <div className="relative bg-slate-900/90 dark:bg-slate-900/90 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center overflow-hidden ring-1 ring-white/10">
                
                <div className="flex flex-col items-center gap-6">
                    <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(239,68,68,0.3)] ring-1 ring-red-500/50">
                         <Trash2 size={40} className="text-red-500" />
                    </div>
                    
                    <div className="space-y-3">
                        <h2 className="text-2xl font-bold text-white tracking-tight">Το δωμάτιο διαγράφηκε</h2>
                        <p className="text-slate-300 text-sm font-medium leading-relaxed">
                            Αυτό το δωμάτιο δεν υπάρχει πλέον καθώς διαγράφηκε από τον δημιουργό του.
                        </p>
                    </div>

                    <button 
                        onClick={onExit}
                        className="w-full py-3.5 px-6 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl shadow-lg shadow-red-900/20 transition-all transform active:scale-95 flex items-center justify-center gap-2"
                    >
                        <Home size={18} />
                        Επιστροφή στην Αρχική
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

const ChatScreen: React.FC<ChatScreenProps> = ({ config, onExit }) => {
  const [user, setUser] = useState<User | null>(null);
  const [inputText, setInputText] = useState('');
  
  // UI States
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showAiAvatarModal, setShowAiAvatarModal] = useState(false);
  const [selectedUserPresence, setSelectedUserPresence] = useState<Presence | null>(null);
  const [selectedUserSubscriber, setSelectedUserSubscriber] = useState<Subscriber | null>(null);
  
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  
  // Room Status
  const [roomDeleted, setRoomDeleted] = useState(false);
  
  // Room & Creator State
  const [isRoomReady, setIsRoomReady] = useState(false);
  const [roomCreatorId, setRoomCreatorId] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAvatarUrl, setAiAvatarUrl] = useState('');
  
  // Theme State - Default to Dark Mode
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') !== 'light';
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
  
  const handleNewMessageReceived = useCallback(async (msg: Message) => {
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
                icon: 'https://konskall.github.io/incognitochat/favicon-96x96.png'
            });
        }
    }
  }, [user, soundEnabled, vibrationEnabled, notificationsEnabled, canVibrate]);

  const { 
    messages, 
    isUploading, 
    sendMessage, 
    editMessage, 
    deleteMessage, 
    reactToMessage, 
    uploadFile 
  } = useChatMessages(config.roomKey, config.pin, user?.uid, handleNewMessageReceived);

  const { participants, typingUsers, setTyping } = useRoomPresence(config.roomKey, user, config);

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

  const isBotResponding = useIncoAI(config.roomKey, config.pin, messages, config, aiEnabled, aiAvatarUrl);

  const combinedTypingUsers = isBotResponding ? [...typingUsers, 'inco'] : typingUsers;

  // --- SIDE EFFECTS ---

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
      if (action === 'joined') return;

      try {
          const { data, error } = await supabase
            .from('subscribers')
            .select('*')
            .eq('room_key', config.roomKey);
          
          if (error) return;
          const subscribers = data as Subscriber[];
          if (!subscribers || subscribers.length === 0) return;

          const onlineUserIds = new Set(participants.map(p => p.uid));
          const recipientsToEmail: string[] = [];
          const subscriberIdsToUpdate: string[] = [];
          const now = new Date();

          subscribers.forEach(sub => {
              if (sub.uid === user.uid) return;
              if (onlineUserIds.has(sub.uid)) return;

              if (sub.last_notified_at) {
                  const lastNotified = new Date(sub.last_notified_at);
                  const diffInMinutes = (now.getTime() - lastNotified.getTime()) / 60000;
                  if (diffInMinutes < NOTIFICATION_COOLDOWN_MINUTES && action !== 'deleted') {
                      return;
                  }
              }

              if (sub.email) {
                  recipientsToEmail.push(sub.email);
                  if (sub.id) subscriberIdsToUpdate.push(sub.uid); 
              }
          });

          if (recipientsToEmail.length > 0) {
              let actionLabel = 'New Message';
              if (action === 'deleted') actionLabel = 'Room Deleted';

              const emailParams = {
                  to_email: recipientsToEmail.join(','), 
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

              if (subscriberIdsToUpdate.length > 0) {
                  await supabase
                      .from('subscribers')
                      .update({ last_notified_at: new Date().toISOString() })
                      .in('uid', subscriberIdsToUpdate)
                      .eq('room_key', config.roomKey);
              }
          }
      } catch (e) {
          console.error("EmailJS Failed", e);
      }
  };

  useEffect(() => {
    const checkUser = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
             setUser({ 
                 uid: session.user.id, 
                 isAnonymous: session.user.is_anonymous ?? true,
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

  const checkRoomStatus = useCallback(async () => {
    if (!config.roomKey) return;
    const { data, error } = await supabase
        .from('rooms')
        .select('room_key')
        .eq('room_key', config.roomKey)
        .maybeSingle();
    
    if (!data || error) {
        setRoomDeleted(true);
    }
  }, [config.roomKey]);

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
             setAiEnabled(!!room.ai_enabled);
             setAiAvatarUrl(room.ai_avatar_url || '');
             setIsRoomReady(true);
        } else {
             // Αν δεν υπάρχει το δωμάτιο, ελέγχουμε αν μόλις μπήκαμε ή αν διαγράφηκε ενώ ήμασταν μέσα
             const sessionKey = `joined_${config.roomKey}`;
             if (sessionStorage.getItem(sessionKey)) {
                 // Ήμασταν ήδη μέσα, άρα διαγράφηκε
                 setRoomDeleted(true);
             } else {
                 // Νέα προσπάθεια εισόδου, το δημιουργούμε
                 const { error: insertError } = await supabase
                    .from('rooms')
                    .insert({
                        room_key: config.roomKey,
                        room_name: config.roomName,
                        pin: config.pin,
                        created_by: user.uid,
                        ai_enabled: false
                    });
                 if (!insertError) {
                     setRoomCreatorId(user.uid);
                     await sendMessage(`Room created by ${config.username}`, config, null, null, null, 'system');
                 }
                 setIsRoomReady(true);
             }
        }
      } catch (error) {
        console.error("Error initializing room:", error);
        setIsRoomReady(true); 
      }
    };
    initRoom();

    // Listener για mobile background sync
    const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
            checkRoomStatus();
        }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', checkRoomStatus);

    return () => {
        document.removeEventListener('visibilitychange', handleVisibility);
        window.removeEventListener('focus', checkRoomStatus);
    };
  }, [user, config.roomKey, config.roomName, config.pin, checkRoomStatus]);

  useEffect(() => {
      if (isRoomReady && user && config.roomKey && !roomDeleted) {
          const checkSubscription = async () => {
              const { data } = await supabase
                .from('subscribers')
                .select('email')
                .eq('room_key', config.roomKey)
                .eq('uid', user.uid)
                .maybeSingle();

              if (data && data.email) {
                  setEmailAlertsEnabled(true);
                  setEmailAddress(data.email);
              } else if (user.email) {
                  setEmailAddress(user.email);
              }
          };
          checkSubscription();
      }
  }, [isRoomReady, user, config.roomKey, roomDeleted]);

  useEffect(() => {
      if (isRoomReady && user && config.roomKey && !roomDeleted) {
          const sessionKey = `joined_${config.roomKey}`;
          if (!sessionStorage.getItem(sessionKey)) {
              sendMessage(`${config.username} joined the room`, config, null, null, null, 'system');
              notifySubscribers('joined', `${config.username} has entered the room.`);
              sessionStorage.setItem(sessionKey, 'true');
          }
      }
  }, [isRoomReady, user, config.roomKey, roomDeleted]);

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

  useEffect(() => {
    if (!config.roomKey || !isRoomReady || roomDeleted) return;
    const roomStatusChannel = supabase.channel(`room_status:${config.roomKey}`)
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'rooms',
        filter: `room_key=eq.${config.roomKey}`
      }, () => {
        setRoomDeleted(true);
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `room_key=eq.${config.roomKey}`
      }, (payload) => {
        if (payload.new) {
            if (payload.new.ai_enabled !== undefined) setAiEnabled(payload.new.ai_enabled);
            if (payload.new.ai_avatar_url !== undefined) setAiAvatarUrl(payload.new.ai_avatar_url || '');
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(roomStatusChannel); };
  }, [config.roomKey, isRoomReady, roomDeleted]);

  const handleExitChat = async () => {
      if (config.roomKey && !roomDeleted) {
          await sendMessage(`${config.username} left the room`, config, null, null, null, 'system');
      }
      sessionStorage.removeItem(`joined_${config.roomKey}`);
      onExit();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      setTyping(true);
  };

  const handleSend = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if ((!inputText.trim() && !selectedFile) || !user || roomDeleted) return;
      
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
       if (!navigator.geolocation || !user || roomDeleted) return;
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
          setIsDeleting(false);
      }
  };
  
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
          await supabase.from('subscribers')
            .update({ email: '' })
            .eq('room_key', config.roomKey)
            .eq('uid', user.uid);

          setEmailAlertsEnabled(false);
          setEmailAddress('');
          setShowEmailModal(false);
      } else {
          if (!emailAddress && user.email) {
              setEmailAddress(user.email);
          }
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
          await supabase.from('subscribers').upsert({
              room_key: config.roomKey,
              uid: user.uid,
              username: config.username,
              email: emailAddress,
              last_notified_at: new Date().toISOString()
          }, { onConflict: 'room_key, uid' });

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

  const handleToggleAI = async () => {
    const isOwner = user?.uid === roomCreatorId;
    if (!isOwner || !config.roomKey) return;
    const newState = !aiEnabled;
    try {
      await supabase
        .from('rooms')
        .update({ ai_enabled: newState })
        .eq('room_key', config.roomKey);
      
      setAiEnabled(newState);
      await sendMessage(`Inco AI ${newState ? 'enabled' : 'disabled'} by ${config.username}`, config, null, null, null, 'system');
    } catch (e) {
      console.error("Failed to toggle AI", e);
    }
  };

  const handleUserClick = async (uid: string, username: string, avatar: string) => {
      if (uid === INCO_BOT_UUID) return;
      
      const activeUser = participants.find(p => p.uid === uid);
      
      const userToDisplay: Presence = activeUser || {
          uid,
          username,
          avatar,
          status: 'inactive',
          isTyping: false,
          onlineAt: ''
      };

      setSelectedUserPresence(userToDisplay);
      
      try {
          const { data } = await supabase
            .from('subscribers')
            .select('*')
            .eq('room_key', config.roomKey)
            .eq('uid', uid)
            .maybeSingle();
          
          if (data) {
              setSelectedUserSubscriber(data as Subscriber);
              if (!activeUser) {
                  setSelectedUserPresence(prev => prev ? ({...prev, onlineAt: data.last_notified_at || ''}) : null);
              }
          }
      } catch (e) {
          console.error("Failed to fetch user subscriber info", e);
      }
  };

  return (
    <div className="fixed inset-0 flex flex-col h-[100dvh] w-full bg-slate-100 dark:bg-slate-900 max-w-5xl mx-auto shadow-2xl overflow-hidden z-50 md:relative md:inset-auto md:rounded-2xl md:my-4 md:h-[95vh] md:border border-white/40 dark:border-slate-800 transition-colors">
      
      {roomDeleted && <RoomDeletedToast onExit={onExit} />}

      {isOffline && (
        <div className="absolute top-20 left-0 right-0 flex justify-center z-40 pointer-events-none animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900/90 dark:bg-white/90 backdrop-blur-md rounded-full shadow-2xl border border-white/10 dark:border-slate-200/20">
              <div className="bg-red-500/20 p-1.5 rounded-full">
                <WifiOff size={14} className="text-red-500 animate-pulse" />
              </div>
              <span className="text-xs font-bold text-white dark:text-slate-900">Χωρίς Σύνδεση</span>
          </div>
        </div>
      )}

      {user && isRoomReady && !roomDeleted && (
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
        isRoomReady={isRoomReady && !roomDeleted}
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
        isOwner={user?.uid === roomCreatorId}
        isGoogleUser={user ? !user.isAnonymous : false}
        aiEnabled={aiEnabled}
        onToggleAI={handleToggleAI}
        onOpenAiAvatar={() => setShowAiAvatarModal(true)}
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
            onUserClick={handleUserClick}
        />
        <div ref={messagesEndRef} />
      </main>

      {!roomDeleted && (
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
            typingUsers={combinedTypingUsers}
        />
      )}

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

      <AiAvatarModal
        show={showAiAvatarModal}
        onClose={() => setShowAiAvatarModal(false)}
        currentAvatarUrl={aiAvatarUrl}
        roomKey={config.roomKey}
        onUpdate={(newUrl) => setAiAvatarUrl(newUrl)}
      />

      {selectedUserPresence && (
          <UserProfileModal
            user={selectedUserPresence}
            subscriberInfo={selectedUserSubscriber}
            isRoomOwner={selectedUserPresence.uid === roomCreatorId}
            onClose={() => { setSelectedUserPresence(null); setSelectedUserSubscriber(null); }}
          />
      )}
    </div>
  );
};

export default ChatScreen;
