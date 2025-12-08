
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, setDoc, deleteDoc, getDocs, writeBatch, updateDoc, getDoc, arrayUnion, arrayRemove, QuerySnapshot, DocumentData } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import { getToken } from 'firebase/messaging';
import { db, auth, messaging } from '../services/firebase';
import { ChatConfig, Message, User, Attachment, Presence, Subscriber } from '../types';
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

// Reduced to 500KB to ensure Base64 overhead (~33%) + metadata fits within Firestore 1MB limit
const MAX_FILE_SIZE = 500 * 1024; 

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
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const isFirstLoad = useRef(true);
  const isFirstSnapshot = useRef(true);
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
    if (!config.roomKey) return;
    try {
        await addDoc(collection(db, "chats", config.roomKey, "messages"), {
            text: encodeMessage(text),
            uid: "system",
            username: "System",
            avatarURL: "",
            createdAt: serverTimestamp(),
            type: 'system',
            reactions: {}
        });
    } catch (e) {
        console.error("Failed to send system message", e);
    }
  }, [config.roomKey]);

  const notifySubscribers = async (action: 'message' | 'deleted', details: string) => {
      if (!config.roomKey || !user) return;
      
      try {
          const subscribersRef = collection(db, "chats", config.roomKey, "subscribers");
          const snapshot = await getDocs(subscribersRef);
          
          if (snapshot.empty) return;

          const recipients: string[] = [];
          snapshot.forEach(doc => {
              const sub = doc.data() as Subscriber;
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

              console.log(`[Email Service] Sending notification to ${recipients.length} subscribers...`);
              
              await emailjs.send(
                  EMAILJS_SERVICE_ID,
                  EMAILJS_TEMPLATE_ID,
                  emailParams,
                  EMAILJS_PUBLIC_KEY
              );
              console.log("[Email Service] Notification sent successfully.");
          }
      } catch (e) {
          console.error("Failed to notify subscribers", e);
      }
  };

  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged((u) => {
      if (u) {
        setUser({ uid: u.uid, isAnonymous: u.isAnonymous });
      } else {
        signInAnonymously(auth).catch((error) => {
          console.error("Auth Error:", error);
        });
      }
    });

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
      unsubAuth();
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
    };
  }, []);

  useEffect(() => {
      const unlockAudioContext = () => {
          initAudio();
          document.removeEventListener('click', unlockAudioContext);
          document.removeEventListener('keydown', unlockAudioContext);
          document.removeEventListener('touchstart', unlockAudioContext);
      };

      document.addEventListener('click', unlockAudioContext);
      document.addEventListener('keydown', unlockAudioContext);
      document.addEventListener('touchstart', unlockAudioContext);

      return () => {
          document.removeEventListener('click', unlockAudioContext);
          document.removeEventListener('keydown', unlockAudioContext);
          document.removeEventListener('touchstart', unlockAudioContext);
      };
  }, []);

  useEffect(() => {
    const checkAndCreateRoom = async () => {
      if (!user || !config.roomKey) return;
      
      const roomRef = doc(db, "chats", config.roomKey);
      
      try {
        const roomDoc = await getDoc(roomRef);
        
        if (roomDoc.exists()) {
           const data = roomDoc.data();
           if (!data.createdBy) {
              await updateDoc(roomRef, { createdBy: user.uid });
              setRoomCreatorId(user.uid);
           } else {
              setRoomCreatorId(data.createdBy);
           }
           
           await updateDoc(roomRef, {
             lastActive: serverTimestamp()
           });
        } else {
           await setDoc(roomRef, {
             createdAt: serverTimestamp(),
             roomKey: config.roomKey,
             roomName: config.roomName,
             createdBy: user.uid,
             lastActive: serverTimestamp()
           });
           setRoomCreatorId(user.uid);

           await addDoc(collection(db, "chats", config.roomKey, "messages"), {
              text: encodeMessage(`Room created by ${config.username}`),
              uid: "system",
              username: "System",
              avatarURL: "",
              createdAt: serverTimestamp(),
              type: 'system',
              reactions: {}
           });
        }
        setIsRoomReady(true);
      } catch (error) {
        console.error("Error initializing room:", error);
        setIsRoomReady(true);
      }
    };
    
    checkAndCreateRoom();
  }, [user, config.roomKey, config.roomName, config.username]);

  useEffect(() => {
      if (isRoomReady && user && config.roomKey) {
          const checkSubscription = async () => {
              const subDocRef = doc(db, "chats", config.roomKey, "subscribers", user.uid);
              const docSnap = await getDoc(subDocRef);
              if (docSnap.exists()) {
                  setEmailAlertsEnabled(true);
                  setEmailAddress(docSnap.data().email);
              }
          };
          checkSubscription();
      }
  }, [isRoomReady, user, config.roomKey]);

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
      }
      onExit();
  };

  useEffect(() => {
    if (!config.roomKey || !isRoomReady || isDeleting) return;

    const roomRef = doc(db, "chats", config.roomKey);
    
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
        if (!docSnap.exists()) {
            alert("⚠️ The chat room has been deleted by the administrator.");
            onExit();
        }
    }, (error) => {
        console.log("Room existence listener error:", error);
    });

    return () => unsubscribe();
  }, [config.roomKey, isRoomReady, isDeleting, onExit]);

  useEffect(() => {
      if (notificationsEnabled && user && messaging && isRoomReady) {
          const registerToken = async () => {
              try {
                  if ('serviceWorker' in navigator) {
                     await navigator.serviceWorker.register('./firebase-messaging-sw.js').catch(err => console.log("SW Register fail:", err));
                  }

                  const currentToken = await getToken(messaging).catch(() => null);

                  if (currentToken) {
                      const tokenRef = doc(db, "chats", config.roomKey, "fcm_tokens", user.uid);
                      await setDoc(tokenRef, {
                          token: currentToken,
                          uid: user.uid,
                          username: config.username,
                          updatedAt: serverTimestamp()
                      });
                  }
              } catch (err) {
                  console.log("Notification setup warning:", err);
              }
          };

          registerToken();
      }
  }, [notificationsEnabled, user, config.roomKey, config.username, isRoomReady]);

  const updatePresence = useCallback((overrides: Partial<Presence> = {}) => {
    if (!user || !config.roomKey || !isRoomReady) return;
    const uid = user.uid;
    const presRef = doc(db, "chats", config.roomKey, "presence", uid);

    setDoc(presRef, {
        uid,
        username: config.username,
        avatar: config.avatarURL,
        lastSeen: serverTimestamp(),
        status: "active",
        ...overrides
    }, { merge: true }).catch(console.error);
  }, [user, config.roomKey, config.username, config.avatarURL, isRoomReady]);

  useEffect(() => {
    if (!user || !config.roomKey || !isRoomReady) return;

    updatePresence({ isTyping: false, status: 'active' });
    
    const interval = setInterval(() => {
        if (document.visibilityState === 'visible') {
            updatePresence({ status: 'active' });
        }
    }, 30000);

    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            updatePresence({ status: 'active' });
        } else {
            updatePresence({ status: 'inactive' });
        }
    };

    const cleanup = () => {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        const presRef = doc(db, "chats", config.roomKey, "presence", user.uid);
        deleteDoc(presRef).catch(() => {});
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener('beforeunload', cleanup);

    return () => {
        clearInterval(interval);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener('beforeunload', cleanup);
        cleanup();
    };
  }, [user, config.roomKey, updatePresence, isRoomReady]);

  useEffect(() => {
     if (!config.roomKey || !user || !isRoomReady) return;

     const q = collection(db, "chats", config.roomKey, "presence");
     const unsubscribe = onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
         const typers: string[] = [];
         const currentUsers: Presence[] = [];
         
         snapshot.forEach(doc => {
             const data = doc.data() as Presence;
             currentUsers.push(data);
             
             if (data.uid !== user.uid && data.isTyping && data.status === 'active') {
                 typers.push(data.username);
             }
         });
         setParticipants(currentUsers);
         setTypingUsers(typers);
     }, (error) => {
         console.log("Presence listener warning:", error.message);
     });

     return () => unsubscribe();
  }, [config.roomKey, user, isRoomReady]);

  useEffect(() => {
    if (!config.roomKey || !user || !isRoomReady) return;

    const q = query(
      collection(db, "chats", config.roomKey, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot: QuerySnapshot<DocumentData>) => {
      const msgs: Message[] = [];
      let lastMsg: Message | null = null;
      let hasNewMessageFromOthers = false;

      for (const change of snapshot.docChanges()) {
        if (change.type === "added") {
           const data = change.doc.data();
           if (!snapshot.metadata.fromCache && data.uid !== user.uid && data.type !== 'system') {
               hasNewMessageFromOthers = true;
               lastMsg = { 
                   id: change.doc.id, 
                   text: decodeMessage(data.text || ''), 
                   username: data.username, 
                   uid: data.uid,
                   avatarURL: data.avatarURL,
                   createdAt: data.createdAt,
                   attachment: data.attachment,
                   location: data.location,
                   reactions: data.reactions,
                   replyTo: data.replyTo,
                   type: data.type || 'text'
               };
           }
        }
      }

      snapshot.forEach((doc) => {
        const data = doc.data();
        msgs.push({
          id: doc.id,
          text: decodeMessage(data.text || ''),
          uid: data.uid,
          username: data.username,
          avatarURL: data.avatarURL,
          createdAt: data.createdAt,
          attachment: data.attachment,
          location: data.location,
          isEdited: data.isEdited,
          reactions: data.reactions || {},
          replyTo: data.replyTo,
          type: data.type || 'text'
        });
      });

      setMessages(msgs);

      if (!isFirstSnapshot.current && hasNewMessageFromOthers && lastMsg) {
          if (soundEnabled) {
              initAudio(); 
              setTimeout(() => {
                  const playSound = async () => {
                       const { playBeep } = await import('../utils/helpers');
                       playBeep();
                  }
                  playSound();
              }, 10);
          }

          if (vibrationEnabled && canVibrate && 'vibrate' in navigator) {
              navigator.vibrate(200);
          }

          if (document.hidden && notificationsEnabled) {
             const title = `New message from ${lastMsg.username}`;
             let body = lastMsg.text;
             if (lastMsg.attachment) body = `Sent a file: ${lastMsg.attachment.name}`;
             if (lastMsg.location) body = `Shared a location`;

             try {
                new Notification(title, {
                    body: body,
                    icon: '/favicon-96x96.png',
                    tag: 'chat-msg'
                });
             } catch (e) {
                 console.error("Local notification failed", e);
             }
          }
      }
      
      if (isFirstSnapshot.current) {
          isFirstSnapshot.current = false;
      }
    }, (error) => {
        console.error("Message listener error:", error);
    });

    return () => unsubscribe();
  }, [config.roomKey, user, notificationsEnabled, isRoomReady, soundEnabled, vibrationEnabled, canVibrate]);

  useEffect(() => {
    if (!messagesEndRef.current) return;

    if (isFirstLoad.current && messages.length > 0) {
        messagesEndRef.current.scrollIntoView({ behavior: "auto" });
        isFirstLoad.current = false;
        prevMessageCount.current = messages.length;
        return;
    }

    if (messages.length > prevMessageCount.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        prevMessageCount.current = messages.length;
    } else {
        prevMessageCount.current = messages.length;
    }
  }, [messages]); 

  // Handle Input Auto-resize in Effect
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

      if (!('Notification' in window)) {
          alert('This browser does not support desktop notifications.');
          return;
      }
      
      if (Notification.permission === 'granted') {
          setNotificationsEnabled(true);
          new Notification("Notifications Enabled", { body: "You will be notified when the tab is in the background." });
      } else if (Notification.permission !== 'denied') {
          try {
              const permission = await Notification.requestPermission();
              if (permission === 'granted') {
                  setNotificationsEnabled(true);
                  new Notification("Notifications Enabled", { body: "You will be notified when the tab is in the background." });
              } else if (permission === 'denied') {
                  alert("Notifications are blocked in your browser settings.");
              }
          } catch (error) {
              console.error("Error requesting permission", error);
          }
      } else {
          alert("Notifications are blocked in your browser settings.");
      }
      setShowSettingsMenu(false);
  };

  const handleEmailToggle = async () => {
      if (!user || !config.roomKey) return;

      if (emailAlertsEnabled) {
          const subDocRef = doc(db, "chats", config.roomKey, "subscribers", user.uid);
          await deleteDoc(subDocRef);
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
          const subDocRef = doc(db, "chats", config.roomKey, "subscribers", user.uid);
          await setDoc(subDocRef, {
              uid: user.uid,
              username: config.username,
              email: emailAddress,
              createdAt: serverTimestamp()
          });
          setEmailAlertsEnabled(true);
          setShowEmailModal(false);
          setShowSettingsMenu(false);
          alert("Email alerts enabled for this room.");
      } catch (e) {
          console.error("Error saving email", e);
          alert("Failed to save email subscription.");
      } finally {
          setIsSavingEmail(false);
      }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
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
      
      const msgRef = doc(db, "chats", config.roomKey, "messages", msg.id);
      
      try {
        const msgDoc = await getDoc(msgRef);
        if (!msgDoc.exists()) return;
        
        const currentReactions = (msgDoc.data() as any)?.reactions || {};
        const userList = currentReactions[emoji] || [];
        
        let updateOp;
        
        if (userList.includes(user.uid)) {
            updateOp = arrayRemove(user.uid);
        } else {
            updateOp = arrayUnion(user.uid);
        }
        
        await updateDoc(msgRef, {
            [`reactions.${emoji}`]: updateOp
        });
        
      } catch (error) {
          console.error("Error toggling reaction:", error);
      }
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
      
      let options: MediaRecorderOptions = {};
      if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options = { mimeType: 'audio/webm;codecs=opus' };
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      }
      
      recordingMimeTypeRef.current = options.mimeType || '';

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const type = recordingMimeTypeRef.current || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type });
        await sendVoiceMessage(audioBlob);
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      
      setRecordingDuration(0);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access denied or not available.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const cancelRecording = () => {
     if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = () => {
          if(mediaRecorderRef.current && mediaRecorderRef.current.stream) {
              mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
          }
      };
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const sendVoiceMessage = async (audioBlob: Blob) => {
      if (audioBlob.size > MAX_FILE_SIZE) {
          alert("Voice message too long (max 500KB).");
          return;
      }
      
      setIsUploading(true);
      try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
              const base64Audio = reader.result as string;
              const ext = audioBlob.type.includes('mp4') ? 'm4a' : 'webm';
              
               await addDoc(collection(db, "chats", config.roomKey, "messages"), {
                uid: user!.uid,
                username: config.username,
                avatarURL: config.avatarURL,
                text: "",
                createdAt: serverTimestamp(),
                type: 'text',
                attachment: {
                    url: base64Audio,
                    name: `recorder_${Date.now()}.${ext}`,
                    type: audioBlob.type,
                    size: audioBlob.size
                },
                reactions: {},
                replyTo: null
              });
              
              notifySubscribers('message', 'Sent a voice message');
          };
      } catch (error) {
          console.error("Error sending voice message", error);
      } finally {
          setIsUploading(false);
      }
  };

  const handleSendLocation = async () => {
    if (!navigator.geolocation || !user || !isRoomReady || isOffline) {
        if (!navigator.geolocation) alert("Geolocation is not supported by your browser.");
        return;
    }

    setIsGettingLocation(true);

    navigator.geolocation.getCurrentPosition(async (position) => {
        try {
            const locationData = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            
            await addDoc(collection(db, "chats", config.roomKey, "messages"), {
                uid: user.uid,
                username: config.username,
                avatarURL: config.avatarURL,
                text: encodeMessage("📍 Shared a location"),
                createdAt: serverTimestamp(),
                type: 'text',
                reactions: {},
                location: locationData,
                replyTo: replyingTo ? {
                    id: replyingTo.id,
                    username: replyingTo.username,
                    text: replyingTo.text || 'Shared a content',
                    isAttachment: !!replyingTo.attachment
                } : null
            });
            
            notifySubscribers('message', 'Shared a location');
            setReplyingTo(null);
        } catch (error) {
            console.error("Error sending location:", error);
            alert("Failed to send location.");
        } finally {
            setIsGettingLocation(false);
        }
    }, (error) => {
        console.error("Geolocation error:", error);
        alert("Unable to retrieve your location. Please check permissions.");
        setIsGettingLocation(false);
    }, { enableHighAccuracy: true });
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!inputText.trim() && !selectedFile) || !user || isOffline || isUploading || !isRoomReady) return;

    const textToSend = inputText.trim();
    
    setInputText('');
    setIsUploading(true);
    
    if (textareaRef.current) {
        textareaRef.current.focus();
    }
    
    if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
    }
    updatePresence({ isTyping: false });
    
    if (textareaRef.current) {
        textareaRef.current.style.height = '40px';
    }

    try {
      if (editingMessageId) {
          const msgRef = doc(db, "chats", config.roomKey, "messages", editingMessageId);
          await updateDoc(msgRef, {
              text: encodeMessage(textToSend),
              isEdited: true
          });
          setEditingMessageId(null);
      } else {
          let attachment: Attachment | null = null;

          if (selectedFile) {
            const base64 = await convertFileToBase64(selectedFile);
            attachment = {
              url: base64,
              name: selectedFile.name,
              type: selectedFile.type,
              size: selectedFile.size
            };
          }

          const messageData: any = {
            uid: user.uid,
            username: config.username,
            avatarURL: config.avatarURL,
            text: encodeMessage(textToSend),
            createdAt: serverTimestamp(),
            type: 'text',
            reactions: {},
            replyTo: replyingTo ? {
                id: replyingTo.id,
                username: replyingTo.username,
                text: replyingTo.text || 'Shared a file',
                isAttachment: !!replyingTo.attachment
            } : null
          };
          if (attachment) messageData.attachment = attachment;

          await addDoc(collection(db, "chats", config.roomKey, "messages"), messageData);
          
          notifySubscribers('message', textToSend || 'Sent a file');
          
          setReplyingTo(null);
          // clearFile is now local to input or passed via setter, we handle via prop
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Failed to send/edit message: Missing permissions or connection error.");
      setInputText(textToSend);
    } finally {
      setIsUploading(false);
      if (!editingMessageId) {
         setSelectedFile(null);
         if (fileInputRef.current) fileInputRef.current.value = '';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
        if (editingMessageId) cancelEdit();
        if (replyingTo) cancelReply();
    }
  };

  const handleDeleteChat = async () => {
    if (!config.roomKey) return;
    setIsDeleting(true);

    try {
        await notifySubscribers('deleted', 'The chat room has been deleted.');

        const chatRef = doc(db, "chats", config.roomKey);
        
        const deleteCollection = async (collName: string) => {
            const collRef = collection(chatRef, collName);
            const snapshot = await getDocs(collRef);
            const chunk = 400; 
            for (let i = 0; i < snapshot.docs.length; i += chunk) {
                const batch = writeBatch(db);
                snapshot.docs.slice(i, i + chunk).forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        };

        await Promise.allSettled([
            deleteCollection("presence"),
            deleteCollection("messages"),
            deleteCollection("fcm_tokens"),
            deleteCollection("calls"), 
            deleteCollection("subscribers")
        ]);

        try {
            await deleteDoc(chatRef);
        } catch (roomError) {
            console.warn("Could not delete room doc", roomError);
        }

        onExit(); 
    } catch (error) {
        console.error("Delete failed", error);
        alert("Error clearing chat. Please try again.");
        setIsDeleting(false);
        setShowDeleteModal(false);
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
