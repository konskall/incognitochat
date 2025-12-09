import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { ChatConfig, Message, User, Attachment, Presence } from '../types';
import { decodeMessage, encodeMessage } from '../utils/helpers';
import MessageList from './MessageList';
import CallManager from './CallManager';
import { initAudio } from '../utils/helpers';
import emailjs from '@emailjs/browser';

// Import refactored components
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [participants, setParticipants] = useState<Presence[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  
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
  const [isUploading, setIsUploading] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const isFirstLoad = useRef(true);
  const prevMessageCount = useRef(0);

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

    const existingMeta = document.querySelector("meta[name='theme-color']");
    if (existingMeta) {
      existingMeta.remove();
    }

    const newMeta = document.createElement('meta');
    newMeta.setAttribute('name', 'theme-color');
    newMeta.setAttribute('content', themeColor);
    document.head.appendChild(newMeta);
    
  }, [isDarkMode]);

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
    setShowSettingsMenu(false);
  };

  const sendSystemMessage = useCallback(async (text: string) => {
    if (!config.roomKey || !user) return;
    try {
        await supabase.from('messages').insert({
            room_key: config.roomKey,
            uid: "system",
            username: "System",
            avatar_url: "",
            text: encodeMessage(text),
            type: 'system',
            attachment: null,
            reactions: {}
        });
    } catch (e) {
        console.error("Failed to send system message", e);
    }
  }, [config.roomKey, user]);

  const notifySubscribers = async (action: 'message' | 'deleted', details: string) => {
      if (!config.roomKey || !user) return;
      
      try {
          const { data: subscribers, error } = await supabase
            .from('subscribers')
            .select('*')
            .eq('room_key', config.roomKey);
          
          if (error || !subscribers || subscribers.length === 0) return;

          const recipients: string[] = [];
          subscribers.forEach(sub => {
              if (sub.uid !== user.uid && sub.email) {
                  recipients.push(sub.email);
              }
          });

          if (recipients.length > 0) {
              const emailParams = {
                  to_email: recipients.join(','),
                  room_name: config.roomName,
                  action_type: action === 'message' ? 'New Message' : 'Room Deleted',
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
          console.error("Failed to notify subscribers", e);
      }
  };

  // Auth Status
  useEffect(() => {
    const checkUser = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
             setUser({ uid: session.user.id, isAnonymous: true });
        } else {
             // Should have been logged in by LoginScreen, but handle refresh
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

    if ('Notification' in window && Notification.permission === 'granted') {
      setNotificationsEnabled(true);
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        setCanVibrate(true);
    }

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
        // Check if room exists
        const { data: room } = await supabase
            .from('rooms')
            .select('*')
            .eq('room_key', config.roomKey)
            .single();

        if (room) {
             setRoomCreatorId(room.created_by);
        } else {
             // Create room
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
                 await sendSystemMessage(`Room created by ${config.username}`);
             }
        }
        setIsRoomReady(true);
      } catch (error) {
        console.error("Error initializing room:", error);
        setIsRoomReady(true); // Proceed anyway to try
      }
    };
    
    initRoom();
  }, [user, config.roomKey, config.roomName, config.username]);

  // Check Subscription
  useEffect(() => {
      if (isRoomReady && user && config.roomKey) {
          const checkSubscription = async () => {
              const { data } = await supabase
                .from('subscribers')
                .select('email')
                .eq('room_key', config.roomKey)
                .eq('uid', user.uid)
                .single();

              if (data) {
                  setEmailAlertsEnabled(true);
                  setEmailAddress(data.email);
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
              sendSystemMessage(`${config.username} joined the room`);
              sessionStorage.setItem(sessionKey, 'true');
          }
      }
  }, [isRoomReady, user, config.roomKey, config.username, sendSystemMessage]);

  const handleExitChat = async () => {
      if (config.roomKey) {
          await sendSystemMessage(`${config.username} left the room`);
          sessionStorage.removeItem(`joined_${config.roomKey}`);
          
          // Leave presence channel
          const channel = supabase.channel(`room:${config.roomKey}`);
          await channel.unsubscribe();
      }
      onExit();
  };

  // ----------------------------------------------------------------------
  // SUPABASE REALTIME PRESENCE
  // ----------------------------------------------------------------------
  useEffect(() => {
    if (!user || !config.roomKey || !isRoomReady) return;

    const channel = supabase.channel(`room:${config.roomKey}`, {
      config: {
        presence: {
          key: user.uid,
        },
      },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const newState = channel.presenceState();
        const users: Presence[] = [];
        const typers: string[] = [];
        
        for (const key in newState) {
            const presences = newState[key] as unknown as Presence[];
            if (presences.length > 0) {
                // Take the most recent presence state for this user
                const p = presences[0];
                users.push(p);
                if (p.uid !== user.uid && p.isTyping) {
                    typers.push(p.username);
                }
            }
        }
        setParticipants(users);
        setTypingUsers(typers);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            uid: user.uid,
            username: config.username,
            avatar: config.avatarURL,
            status: 'active',
            isTyping: false,
            lastSeen: new Date().toISOString(),
          });
        }
      });

    return () => {
      channel.unsubscribe();
    };
  }, [user, config.roomKey, isRoomReady, config.username, config.avatarURL]);

  const updatePresence = useCallback(async (overrides: Partial<Presence>) => {
      if (!user || !config.roomKey) return;
      const channel = supabase.channel(`room:${config.roomKey}`);
      // We rely on the existing channel state, tracking updates the object
      await channel.track({
            uid: user.uid,
            username: config.username,
            avatar: config.avatarURL,
            status: 'active',
            lastSeen: new Date().toISOString(),
            ...overrides
      });
  }, [user, config.roomKey, config.username, config.avatarURL]);


  // ----------------------------------------------------------------------
  // SUPABASE REALTIME MESSAGES
  // ----------------------------------------------------------------------
  useEffect(() => {
    if (!config.roomKey || !user || !isRoomReady) return;

    // Load initial messages
    const fetchMessages = async () => {
        const { data } = await supabase
            .from('messages')
            .select('*')
            .eq('room_key', config.roomKey)
            .order('created_at', { ascending: true });
        
        if (data) {
             const msgs: Message[] = data.map(d => ({
                 id: d.id,
                 text: decodeMessage(d.text || ''),
                 uid: d.uid,
                 username: d.username,
                 avatarURL: d.avatar_url,
                 createdAt: d.created_at,
                 attachment: d.attachment,
                 location: d.location,
                 isEdited: false, // You might want to add is_edited column to DB if needed
                 reactions: d.reactions || {},
                 replyTo: d.reply_to,
                 type: d.type || 'text'
             }));
             setMessages(msgs);
        }
    };

    fetchMessages();

    // Subscribe to new messages
    const channel = supabase.channel(`messages:${config.roomKey}`)
        .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'messages',
            filter: `room_key=eq.${config.roomKey}` 
        }, (payload) => {
            if (payload.eventType === 'INSERT') {
                 const d = payload.new;
                 const newMsg: Message = {
                     id: d.id,
                     text: decodeMessage(d.text || ''),
                     uid: d.uid,
                     username: d.username,
                     avatarURL: d.avatar_url,
                     createdAt: d.created_at,
                     attachment: d.attachment,
                     location: d.location,
                     reactions: d.reactions || {},
                     replyTo: d.reply_to,
                     type: d.type || 'text'
                 };
                 setMessages(prev => [...prev, newMsg]);

                 // Sound & Notifications
                 if (d.uid !== user.uid && d.type !== 'system') {
                      if (soundEnabled) {
                          initAudio();
                          setTimeout(async () => {
                              const { playBeep } = await import('../utils/helpers');
                              playBeep();
                          }, 10);
                      }
                      
                      if (vibrationEnabled && canVibrate && 'vibrate' in navigator) {
                          navigator.vibrate(200);
                      }

                      if (document.hidden && notificationsEnabled) {
                          new Notification(`New message from ${d.username}`, {
                              body: newMsg.text || 'Sent an attachment',
                              icon: '/favicon-96x96.png'
                          });
                      }
                 }
            } 
            else if (payload.eventType === 'UPDATE') {
                const d = payload.new;
                setMessages(prev => prev.map(m => m.id === d.id ? {
                     ...m,
                     text: decodeMessage(d.text || ''),
                     reactions: d.reactions || {},
                     isEdited: true // Simplified logic
                } : m));
            }
            else if (payload.eventType === 'DELETE') {
                 setMessages(prev => prev.filter(m => m.id !== payload.old.id));
            }
        })
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };

  }, [config.roomKey, user, isRoomReady, soundEnabled, vibrationEnabled, notificationsEnabled, canVibrate]);

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


  // ... (Input Resize Logic kept same) ...
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      if (inputText === '') {
          textareaRef.current.style.height = '40px';
          textareaRef.current.classList.add('h-[40px]');
      } else {
          textareaRef.current.classList.remove('h-[40px]');
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
      }
    }
  }, [inputText]);

  // Notifications toggle logic same...
  const toggleNotifications = async () => {
      if (notificationsEnabled) {
          setNotificationsEnabled(false);
          setShowSettingsMenu(false);
          return;
      }
      if (Notification.permission === 'granted') {
          setNotificationsEnabled(true);
      } else if (Notification.permission !== 'denied') {
          const p = await Notification.requestPermission();
          if (p === 'granted') setNotificationsEnabled(true);
      }
      setShowSettingsMenu(false);
  };

  const handleEmailToggle = async () => {
      if (!user || !config.roomKey) return;
      if (emailAlertsEnabled) {
          await supabase.from('subscribers')
            .delete()
            .eq('room_key', config.roomKey)
            .eq('uid', user.uid);
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
      } catch (e) {
          console.error("Error saving email", e);
      } finally {
          setIsSavingEmail(false);
      }
  };

  // ... (FileUpload and Location logic needs Supabase Storage) ...

  const uploadFile = async (file: File): Promise<Attachment | null> => {
      if (!user) return null;
      // Upload to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${config.roomKey}/${fileName}`;
      
      const { error } = await supabase.storage
        .from('attachments')
        .upload(filePath, file);

      if (error) {
          console.error("Upload failed", error);
          throw error;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('attachments')
        .getPublicUrl(filePath);

      return {
          url: publicUrl,
          name: file.name,
          type: file.type,
          size: file.size
      };
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      if (!user) return;
      
      if (!typingTimeoutRef.current) updatePresence({ isTyping: true });
      
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
          updatePresence({ isTyping: false });
          typingTimeoutRef.current = null;
      }, 2000);
  };

  const handleEditMessage = useCallback((msg: Message) => {
      setInputText(msg.text);
      setEditingMessageId(msg.id);
      setReplyingTo(null);
      setSelectedFile(null);
      textareaRef.current?.focus();
  }, []);
  
  const handleReply = useCallback((msg: Message) => {
      setReplyingTo(msg);
      setEditingMessageId(null);
      textareaRef.current?.focus();
  }, []);

  const handleReaction = useCallback(async (msg: Message, emoji: string) => {
      if (!user || !config.roomKey) return;
      
      // Get current reactions
      const currentReactions = msg.reactions || {};
      const userList = currentReactions[emoji] || [];
      let newList: string[];

      if (userList.includes(user.uid)) {
           newList = userList.filter(u => u !== user.uid);
      } else {
           newList = [...userList, user.uid];
      }
      
      const updatedReactions = { ...currentReactions, [emoji]: newList };
      
      await supabase.from('messages')
        .update({ reactions: updatedReactions })
        .eq('id', msg.id);

  }, [user, config.roomKey]);

  const cancelEdit = useCallback(() => {
      setEditingMessageId(null);
      setInputText('');
  }, []);
  
  const cancelReply = useCallback(() => {
      setReplyingTo(null);
  }, []);

  const startRecording = async () => {
    // ... same logic as before for MediaRecorder ...
    // Using simple implementation
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
             if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorder.onstop = async () => {
             const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
             await sendVoiceMessage(audioBlob);
             stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        setIsRecording(true);
        setRecordingDuration(0);
        recordingTimerRef.current = setInterval(() => setRecordingDuration(p => p+1), 1000);

    } catch (e) {
        console.error("Mic error", e);
    }
  };

  const stopRecording = () => {
     if(mediaRecorderRef.current && isRecording) {
         mediaRecorderRef.current.stop();
         setIsRecording(false);
         if(recordingTimerRef.current) clearInterval(recordingTimerRef.current);
     }
  };

  const cancelRecording = () => {
      // same logic
      if(mediaRecorderRef.current && isRecording) {
          // hack to prevent onstop triggering upload
          mediaRecorderRef.current.onstop = null; 
          mediaRecorderRef.current.stop();
          setIsRecording(false);
          if(recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      }
  };

  const sendVoiceMessage = async (audioBlob: Blob) => {
      setIsUploading(true);
      try {
           const file = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
           const attachment = await uploadFile(file);
           
           if (attachment) {
               await supabase.from('messages').insert({
                   room_key: config.roomKey,
                   uid: user!.uid,
                   username: config.username,
                   avatar_url: config.avatarURL,
                   text: "",
                   type: 'text',
                   attachment: attachment,
                   reactions: {}
               });
               notifySubscribers('message', 'Sent a voice message');
           }
      } catch(e) {
          console.error("Voice send failed", e);
      } finally {
          setIsUploading(false);
      }
  };

  const handleSendLocation = async () => {
       if (!navigator.geolocation || !user) return;
       setIsGettingLocation(true);
       navigator.geolocation.getCurrentPosition(async (pos) => {
           try {
               await supabase.from('messages').insert({
                   room_key: config.roomKey,
                   uid: user.uid,
                   username: config.username,
                   avatar_url: config.avatarURL,
                   text: encodeMessage("📍 Shared a location"),
                   type: 'text',
                   reactions: {},
                   location: { lat: pos.coords.latitude, lng: pos.coords.longitude }
               });
               notifySubscribers('message', 'Shared a location');
           } catch(e) { console.error(e); }
           finally { setIsGettingLocation(false); }
       });
  };

  const handleSend = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if ((!inputText.trim() && !selectedFile) || !user) return;
      
      const textToSend = inputText.trim();
      setInputText('');
      setIsUploading(true);
      
      if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = '40px';
      }
      updatePresence({ isTyping: false });

      try {
          if (editingMessageId) {
               await supabase.from('messages').update({
                   text: encodeMessage(textToSend),
                   // You might need a JSON column for metadata or just rely on convention
               }).eq('id', editingMessageId);
               setEditingMessageId(null);
          } else {
               let attachment = null;
               if (selectedFile) {
                   attachment = await uploadFile(selectedFile);
               }

               await supabase.from('messages').insert({
                   room_key: config.roomKey,
                   uid: user.uid,
                   username: config.username,
                   avatar_url: config.avatarURL,
                   text: encodeMessage(textToSend),
                   type: 'text',
                   reactions: {},
                   attachment: attachment,
                   reply_to: replyingTo ? {
                       id: replyingTo.id,
                       username: replyingTo.username,
                       text: replyingTo.text || 'Attachment',
                       isAttachment: !!replyingTo.attachment
                   } : null
               });

               notifySubscribers('message', textToSend || 'Sent a file');
               setReplyingTo(null);
               setSelectedFile(null);
               if(fileInputRef.current) fileInputRef.current.value = '';
          }
      } catch (error) {
          console.error("Send error", error);
          setInputText(textToSend); // Restore on error
      } finally {
          setIsUploading(false);
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
      }
      if (e.key === 'Escape') {
          cancelEdit();
          cancelReply();
      }
  };

  const handleDeleteChat = async () => {
      if (!config.roomKey) return;
      setIsDeleting(true);
      try {
          // SQL cascade delete should handle messages if room is deleted, 
          // but if we just want to clear messages:
          await supabase.from('messages').delete().eq('room_key', config.roomKey);
          
          // Optionally notify and delete room
           notifySubscribers('deleted', 'Room was deleted');
           await supabase.from('rooms').delete().eq('room_key', config.roomKey);
           
           onExit();
      } catch(e) {
          console.error("Delete failed", e);
      } finally {
          setIsDeleting(false);
      }
  };

  return (
    <div className="fixed inset-0 flex flex-col h-[100dvh] w-full bg-slate-100 dark:bg-slate-900 max-w-5xl mx-auto shadow-2xl overflow-hidden z-50 md:relative md:inset-auto md:rounded-2xl md:my-4 md:h-[95vh] md:border border-white/40 dark:border-slate-800 transition-colors">
      {isOffline && (
        <div className="bg-red-500 text-white text-center py-1 text-sm font-bold animate-pulse absolute top-0 w-full z-50">
          📴 You are offline. Messages will not be sent.
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
            onReply={handleReply}
            onReact={handleReaction}
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
        cancelEdit={cancelEdit}
        replyingTo={replyingTo}
        cancelReply={cancelReply}
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
