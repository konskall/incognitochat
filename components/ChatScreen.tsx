
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

// Notification Cooldown in Minutes
const NOTIFICATION_COOLDOWN_MINUTES = 30;

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
      
      // RULE 1: Do not send emails for 'joined' events to reduce noise
      if (action === 'joined') return;

      try {
          const { data, error } = await supabase
            .from('subscribers')
            .select('*')
            .eq('room_key', config.roomKey);
          
          if (error) return;
          const subscribers = data as Subscriber[];
          if (!subscribers || subscribers.length === 0) return;

          // RULE 2: Get IDs of currently ONLINE participants (to exclude them from emails)
          // We assume 'participants' from useRoomPresence contains active users.
          const onlineUserIds = new Set(participants.map(p => p.uid));
          
          // Filter subscribers who need to be notified
          const recipientsToEmail: string[] = [];
          const subscriberIdsToUpdate: string[] = [];
          const now = new Date();

          subscribers.forEach(sub => {
              // Skip self
              if (sub.uid === user.uid) return;
              
              // Skip if they are currently online in the room (Presence Check)
              if (onlineUserIds.has(sub.uid)) return;

              // RULE 3: Cooldown Check
              // Check if we sent them an email recently
              if (sub.last_notified_at) {
                  const lastNotified = new Date(sub.last_notified_at);
                  const diffInMinutes = (now.getTime() - lastNotified.getTime()) / 60000;
                  // If notified recently, skip (unless it's a critical 'deleted' event)
                  if (diffInMinutes < NOTIFICATION_COOLDOWN_MINUTES && action !== 'deleted') {
                      return;
                  }
              }

              if (sub.email) {
                  recipientsToEmail.push(sub.email);
                  if (sub.id) subscriberIdsToUpdate.push(sub.uid); // Track by UID for update
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

              // Update the last_notified_at timestamp for these users
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

  // Auth Status & Network
  useEffect(() => {
    const checkUser = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
             // Correctly identify if user is anonymous or authenticated (e.g. Google)
             // and store email if available.
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

              if (data && data.email) {
                  // User has set an email for this room specifically
                  setEmailAlertsEnabled(true);
                  setEmailAddress(data.email);
              } else if (user.email) {
                  // If no subscription exists (or email is empty in DB), 
                  // but user has a Google Account email, pre-fill the input
                  // so they don't have to type it.
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
              // We pass 'joined' here, but inside notifySubscribers it is ignored for email, 
              // keeping it for future extensibility or other notification types.
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
          // Instead of deleting the row (which would remove the room from dashboard),
          // we just clear the email field to stop notifications.
          await supabase.from('subscribers')
            .update({ email: '' })
            .eq('room_key', config.roomKey)
            .eq('uid', user.uid);

          setEmailAlertsEnabled(false);
          setEmailAddress('');
          setShowEmailModal(false);
      } else {
          // If turning ON, pre-fill with Google email if available and field is empty
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
          // Upsert to ensure we update existing record if present
          await supabase.from('subscribers').upsert({
              room_key: config.roomKey,
              uid: user.uid,
              username: config.username,
              email: emailAddress,
              last_notified_at: new Date().toISOString() // Initialize with current time to start cooldown immediately
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

  // Determine Background Style
  const getBackgroundStyle = () => {
      if (!config.backgroundImage) {
          return {
              backgroundImage: `radial-gradient(${isDarkMode ? '#334155' : '#cbd5e1'} 1px, transparent 1px)`, 
              backgroundSize: '20px 20px'
          };
      }
      
      // Check if it's an SVG pattern (from our generator which uses data:image/svg+xml)
      const isSvgPattern = config.backgroundImage.includes('image/svg+xml');

      // Check if it looks like a URL (basic check) or a gradient string
      if (config.backgroundImage.includes('url(') || config.backgroundImage.startsWith('http') || config.backgroundImage.startsWith('data:')) {
           return {
               backgroundImage: config.backgroundImage.startsWith('http') || config.backgroundImage.startsWith('data:') 
                  ? `url(${config.backgroundImage})` 
                  : config.backgroundImage,
               backgroundSize: isSvgPattern ? 'auto' : 'cover', // Use 'auto' for patterns to repeat correctly, 'cover' for images
               backgroundRepeat: isSvgPattern ? 'repeat' : 'no-repeat',
               backgroundPosition: 'center',
               backgroundAttachment: 'fixed'
           };
      }
      
      // Assume CSS gradient string
      return {
          background: config.backgroundImage
      };
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
        className={`flex-1 overflow-y-auto overscroll-contain p-4 pb-20 ${!config.backgroundImage ? 'bg-slate-50/50 dark:bg-slate-950/50' : ''}`}
        style={getBackgroundStyle()}
      >
        {/* If custom image background, add an overlay for readability */}
        {config.backgroundImage && (config.backgroundImage.includes('http') || (config.backgroundImage.includes('url') && !config.backgroundImage.includes('svg+xml'))) && (
            <div className="absolute inset-0 bg-white/30 dark:bg-black/40 pointer-events-none" />
        )}
        
        <div className="relative z-10 min-h-full flex flex-col justify-end">
            <MessageList 
                messages={messages} 
                currentUserUid={user?.uid || ''} 
                onEdit={handleEditMessage}
                onDelete={deleteMessage}
                onReply={handleReply}
                onReact={reactToMessage}
            />
            <div ref={messagesEndRef} />
        </div>
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
