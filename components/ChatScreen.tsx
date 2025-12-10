import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { ChatConfig, Message, User, Attachment, Presence, Subscriber } from '../types';
import { decodeMessage, encodeMessage } from '../utils/helpers';
import MessageList from './MessageList';
import CallManager from './CallManager';
import { initAudio } from '../utils/helpers';
import emailjs from '@emailjs/browser';
import ChatHeader from './ChatHeader';
import ChatInput from './ChatInput';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';
import { RealtimeChannel } from '@supabase/supabase-js';

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
  const recordingMimeTypeRef = useRef<string>(''); 
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Refs for typing optimization and channels
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const roomChannelRef = useRef<RealtimeChannel | null>(null);
  
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

  const notifySubscribers = async (action: 'message' | 'deleted' | 'joined', details: string) => {
      if (!config.roomKey || !user) return;
      
      console.log(`[EmailJS] Attempting to notify subscribers. Action: ${action}`);

      try {
          // Fetch subscribers (explicitly typed)
          const { data, error } = await supabase
            .from('subscribers')
            .select('*')
            .eq('room_key', config.roomKey);
          
          if (error) {
              console.error("[EmailJS] Error fetching subscribers:", error);
              return;
          }

          const subscribers = data as Subscriber[];

          if (!subscribers || subscribers.length === 0) {
            console.log("[EmailJS] No subscribers found for this room.");
            return;
          }

          const recipients: string[] = [];
          subscribers.forEach(sub => {
              // Don't notify self
              if (sub.uid !== user.uid && sub.email) {
                  recipients.push(sub.email);
              }
          });

          if (recipients.length > 0) {
              const toEmailString = recipients.join(',');
              
              // Map internal action to display label
              let actionLabel = 'New Message';
              if (action === 'deleted') actionLabel = 'Room Deleted';
              if (action === 'joined') actionLabel = 'New Participant';

              console.log(`[EmailJS] Sending '${actionLabel}' to: ${toEmailString}`);
              
              const emailParams = {
                  to_email: toEmailString, // Ensure your EmailJS template uses {{to_email}} in the "To" field
                  room_name: config.roomName,
                  action_type: actionLabel,
                  message_body: details,
                  link: window.location.href
              };
              
              const response = await emailjs.send(
                  EMAILJS_SERVICE_ID,
                  EMAILJS_TEMPLATE_ID,
                  emailParams,
                  EMAILJS_PUBLIC_KEY
              );
              console.log("[EmailJS] SUCCESS!", response.status, response.text);
          } else {
              console.log("[EmailJS] No other recipients to notify (you are the only subscriber or filtering self).");
          }
      } catch (e) {
          console.error("[EmailJS] FAILED...", e);
      }
  };

  // Auth Status
  useEffect(() => {
    const checkUser = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
             setUser({ uid: session.user.id, isAnonymous: true });
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
        // Use maybeSingle() instead of single() to avoid 406 errors if row doesn't exist
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
                 await sendSystemMessage(`Room created by ${config.username}`);
             }
        }
        setIsRoomReady(true);
      } catch (error) {
        console.error("Error initializing room:", error);
        setIsRoomReady(true); 
      }
    };
    
    initRoom();
  }, [user, config.roomKey, config.roomName, config.username]);

  // Check Subscription
  useEffect(() => {
      if (isRoomReady && user && config.roomKey) {
          const checkSubscription = async () => {
              // Use maybeSingle() to return null instead of error if not found
              const { data, error } = await supabase
                .from('subscribers')
                .select('email')
                .eq('room_key', config.roomKey)
                .eq('uid', user.uid)
                .maybeSingle();

              if (error) {
                  console.error("Subscription Check Error:", error);
              }

              if (data) {
                  setEmailAlertsEnabled(true);
                  setEmailAddress(data.email);
              }
          };
          checkSubscription();
      }
  }, [isRoomReady, user, config.roomKey]);

  // Join Message & Notification
  useEffect(() => {
      if (isRoomReady && user && config.roomKey) {
          const sessionKey = `joined_${config.roomKey}`;
          if (!sessionStorage.getItem(sessionKey)) {
              // Send system message to chat
              sendSystemMessage(`${config.username} joined the room`);
              
              // Send email notification to subscribers
              notifySubscribers('joined', `${config.username} has entered the room.`);
              
              sessionStorage.setItem(sessionKey, 'true');
          }
      }
  }, [isRoomReady, user, config.roomKey, config.username, sendSystemMessage]);

  const handleExitChat = async () => {
      if (config.roomKey) {
          await sendSystemMessage(`${config.username} left the room`);
          sessionStorage.removeItem(`joined_${config.roomKey}`);
          
          if (roomChannelRef.current) {
              await roomChannelRef.current.unsubscribe();
          }
          const dbChannel = supabase.channel(`messages:${config.roomKey}`);
          await dbChannel.unsubscribe();
          
          const roomStatusChannel = supabase.channel(`room_status:${config.roomKey}`);
          await roomStatusChannel.unsubscribe();
      }
      onExit();
  };

  // ----------------------------------------------------------------------
  // SUPABASE REALTIME PRESENCE & SIGNALING CHANNEL
  // ----------------------------------------------------------------------
  useEffect(() => {
    if (!user || !config.roomKey || !isRoomReady) return;

    const channel = supabase.channel(`presence:${config.roomKey}`, {
      config: {
        presence: {
          key: user.uid,
        },
      },
    });

    roomChannelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const newState = channel.presenceState();
        const activeUsers: Presence[] = [];
        const typers: string[] = [];
        
        for (const key in newState) {
            const userPresences = newState[key] as unknown as Presence[];
            if (userPresences && userPresences.length > 0) {
                const p = userPresences[0]; 
                activeUsers.push(p);
                
                if (p.uid !== user.uid && p.isTyping) {
                    typers.push(p.username);
                }
            }
        }
        setParticipants(activeUsers);
        setTypingUsers(typers);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            uid: user.uid,
            username: config.username,
            avatar: config.avatarURL,
            isTyping: false,
            onlineAt: new Date().toISOString(),
            status: 'active'
          });
        }
      });

    return () => {
      channel.unsubscribe();
      roomChannelRef.current = null;
    };
  }, [user, config.roomKey, isRoomReady, config.username, config.avatarURL]);

  const updatePresenceState = async (overrides: Partial<Presence>) => {
      if (!roomChannelRef.current || !user) return;
      
      await roomChannelRef.current.track({
            uid: user.uid,
            username: config.username,
            avatar: config.avatarURL,
            isTyping: false,
            onlineAt: new Date().toISOString(),
            status: 'active',
            ...overrides
      });
  };

  // ----------------------------------------------------------------------
  // SUPABASE REALTIME MESSAGES (DB CHANNEL)
  // ----------------------------------------------------------------------
  useEffect(() => {
    if (!config.roomKey || !user || !isRoomReady) return;

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
                 isEdited: false, 
                 reactions: d.reactions || {},
                 replyTo: d.reply_to,
                 type: d.type || 'text'
             }));
             setMessages(msgs);
        }
    };

    fetchMessages();

    const dbChannel = supabase.channel(`messages:${config.roomKey}`)
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
                     isEdited: true 
                } : m));
            }
            else if (payload.eventType === 'DELETE') {
                 setMessages(prev => prev.filter(m => m.id !== payload.old.id));
            }
        })
        .subscribe();

    return () => {
        supabase.removeChannel(dbChannel);
    };

  }, [config.roomKey, user, isRoomReady, soundEnabled, vibrationEnabled, notificationsEnabled, canVibrate]);
  
  // ----------------------------------------------------------------------
  // SUPABASE ROOM DELETION LISTENER (Force Eject)
  // ----------------------------------------------------------------------
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

    return () => {
        supabase.removeChannel(roomStatusChannel);
    };
  }, [config.roomKey, isRoomReady, onExit]);


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
          const { error } = await supabase.from('subscribers')
            .delete()
            .eq('room_key', config.roomKey)
            .eq('uid', user.uid);
            
          if (error) {
              console.error("Error disabling alerts:", error);
              return;
          }
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
          const { error } = await supabase.from('subscribers').insert({
              room_key: config.roomKey,
              uid: user.uid,
              username: config.username,
              email: emailAddress
          });
          
          if (error) {
              console.error("Supabase insert error:", error);
              throw error;
          }

          setEmailAlertsEnabled(true);
          setShowEmailModal(false);
          setShowSettingsMenu(false);
          alert("Successfully subscribed to email alerts for this room.");
      } catch (e: any) {
          console.error("Error saving email:", e);
          alert("Failed to subscribe to alerts. The database table might be missing or permissions incorrect.");
      } finally {
          setIsSavingEmail(false);
      }
  };

  const uploadFile = async (file: File): Promise<Attachment | null> => {
      if (!user) return null;
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
      
      if (!isTypingRef.current) {
          isTypingRef.current = true;
          updatePresenceState({ isTyping: true });
      }
      
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      
      typingTimeoutRef.current = setTimeout(() => {
          isTypingRef.current = false;
          updatePresenceState({ isTyping: false });
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
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        const types = [
          'audio/mp4',
          'audio/aac',
          'audio/webm;codecs=opus',
          'audio/webm'
        ];
        
        const mimeType = types.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
        recordingMimeTypeRef.current = mimeType;
        
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
             if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorder.onstop = async () => {
             const audioBlob = new Blob(audioChunksRef.current, { type: recordingMimeTypeRef.current });
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
      if(mediaRecorderRef.current && isRecording) {
          mediaRecorderRef.current.onstop = null; 
          mediaRecorderRef.current.stop();
          setIsRecording(false);
          if(recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      }
  };

  const sendVoiceMessage = async (audioBlob: Blob) => {
      setIsUploading(true);
      try {
           const ext = recordingMimeTypeRef.current.includes('mp4') || recordingMimeTypeRef.current.includes('aac') ? 'mp4' : 'webm';
           const file = new File([audioBlob], `voice_${Date.now()}.${ext}`, { type: recordingMimeTypeRef.current });
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
      
      if (isTypingRef.current) {
          isTypingRef.current = false;
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          updatePresenceState({ isTyping: false });
      }

      if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = '40px';
      }

      try {
          if (editingMessageId) {
               await supabase.from('messages').update({
                   text: encodeMessage(textToSend),
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
           // Notify users BEFORE deleting the room so subscribers table is still intact
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
