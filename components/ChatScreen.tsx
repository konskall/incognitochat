import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { ChatConfig, User, Message } from '../types';
import ChatHeader from './ChatHeader';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import CallManager from './CallManager';
import { DeleteChatModal, EmailAlertModal } from './ChatModals';
import { useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { playBeep } from '../utils/helpers';
import { subscribeToPushNotifications, unsubscribeFromPushNotifications } from '../utils/pushService';

interface ChatScreenProps {
  config: ChatConfig;
  onExit: () => void;
}

const ChatScreen: React.FC<ChatScreenProps> = ({ config, onExit }) => {
  const [user, setUser] = useState<User | null>(null);
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  
  // Edit & Reply State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);

  // Settings State
  const [showParticipantsList, setShowParticipantsList] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  
  // Modals
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  // Theme
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');

  // Load User
  useEffect(() => {
    const loadUser = async () => {
       const { data: { user: authUser } } = await supabase.auth.getUser();
       if (authUser) {
           setUser({
               uid: authUser.id,
               isAnonymous: !!authUser.is_anonymous,
               email: authUser.email
           });
       }
    };
    loadUser();
  }, []);

  // Room Ready State
  const isRoomReady = !!user;

  // Hooks
  const { 
    messages, 
    isUploading, 
    sendMessage, 
    editMessage, 
    deleteMessage, 
    reactToMessage, 
    uploadFile 
  } = useChatMessages(config.roomKey, config.pin, user?.uid, (newMsg) => {
      if (newMsg.uid !== user?.uid) {
          if (soundEnabled) playBeep();
          if (vibrationEnabled && navigator.vibrate) navigator.vibrate(200);
      }
  });

  const { participants, typingUsers, setTyping } = useRoomPresence(config.roomKey, user, config);

  const { 
      isRecording, 
      recordingDuration, 
      startRecording, 
      stopRecording, 
      cancelRecording 
  } = useAudioRecorder(async (blob, mimeType) => {
      if (!user) return;
      try {
          const file = new File([blob], `voice_${Date.now()}.webm`, { type: mimeType });
          const attachment = await uploadFile(file);
          if (attachment) {
              await sendMessage('', { username: config.username, avatarURL: config.avatarURL }, attachment, replyingTo, null, 'text');
              setReplyingTo(null);
          }
      } catch(e) {
          console.error("Failed to send voice", e);
      }
  });

  // Check Email Subscription
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
              } else {
                  setEmailAlertsEnabled(false);
                  if (user.email) {
                      setEmailAddress(user.email);
                  }
              }
          };
          checkSubscription();
      }
  }, [isRoomReady, user, config.roomKey]);
  
  // Handlers
  const toggleTheme = () => {
      const newMode = !isDarkMode;
      setIsDarkMode(newMode);
      localStorage.setItem('theme', newMode ? 'dark' : 'light');
      if (newMode) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
  };

  const toggleNotifications = async () => {
      if (!user) return;
      if (!notificationsEnabled) {
          const success = await subscribeToPushNotifications(user.uid, config.roomKey);
          if (success) setNotificationsEnabled(true);
      } else {
          await unsubscribeFromPushNotifications(user.uid, config.roomKey);
          setNotificationsEnabled(false);
      }
  };

  const handleSend = async () => {
      if ((!inputText.trim() && !selectedFile) || !user) return;
      
      try {
          let attachment = null;
          if (selectedFile) {
              attachment = await uploadFile(selectedFile);
          }
          
          if (editingMessageId) {
             await editMessage(editingMessageId, inputText);
             setEditingMessageId(null);
          } else {
             await sendMessage(inputText, { username: config.username, avatarURL: config.avatarURL }, attachment, replyingTo);
          }
          
          setInputText('');
          setSelectedFile(null);
          setReplyingTo(null);
      } catch (e) {
          console.error("Send failed", e);
          alert("Failed to send message");
      }
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
      setTyping(true);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
      }
  };

  const handleSendLocation = () => {
      if (!navigator.geolocation) {
          alert("Geolocation is not supported");
          return;
      }
      setIsGettingLocation(true);
      navigator.geolocation.getCurrentPosition(async (position) => {
          const { latitude, longitude } = position.coords;
          await sendMessage('', { username: config.username, avatarURL: config.avatarURL }, null, replyingTo, { lat: latitude, lng: longitude });
          setIsGettingLocation(false);
      }, (err) => {
          console.error(err);
          alert("Unable to retrieve location");
          setIsGettingLocation(false);
      });
  };
  
  const handleSaveEmail = async () => {
      if (!emailAddress || !user) return;
      setIsSavingEmail(true);
      try {
          await supabase.from('subscribers').upsert({
              room_key: config.roomKey,
              uid: user.uid,
              username: config.username,
              email: emailAddress
          }, { onConflict: 'room_key, uid' });
          setEmailAlertsEnabled(true);
          setShowEmailModal(false);
      } catch (e) {
          console.error(e);
          alert("Failed to subscribe");
      } finally {
          setIsSavingEmail(false);
      }
  };

  const handleUnsubscribeEmail = async () => {
      if (!user) return;
      try {
          await supabase.from('subscribers').delete().eq('room_key', config.roomKey).eq('uid', user.uid);
          setEmailAlertsEnabled(false);
          setEmailAddress('');
          setShowEmailModal(false);
      } catch (e) {
          console.error(e);
          alert("Failed to unsubscribe");
      }
  };

  const handleDeleteRoom = async () => {
      setIsDeleting(true);
      try {
          await supabase.from('messages').delete().eq('room_key', config.roomKey);
          await supabase.from('rooms').delete().eq('room_key', config.roomKey);
          await supabase.from('subscribers').delete().eq('room_key', config.roomKey);
          onExit();
      } catch (e) {
          console.error(e);
          alert("Failed to delete room");
      } finally {
          setIsDeleting(false);
      }
  };

  if (!user) return <div className="flex items-center justify-center h-screen text-slate-500">Connecting...</div>;

  return (
    <div className="flex flex-col h-[100dvh] bg-slate-50 dark:bg-slate-950 transition-colors">
        <ChatHeader 
            config={config}
            participants={participants}
            isRoomReady={isRoomReady}
            showParticipantsList={showParticipantsList}
            setShowParticipantsList={setShowParticipantsList}
            showSettingsMenu={showSettingsMenu}
            setShowSettingsMenu={setShowSettingsMenu}
            canVibrate={!!navigator.vibrate}
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
            onExit={onExit}
        />
        
        <main className="flex-1 overflow-y-auto p-4 scroll-smooth">
            <MessageList 
                messages={messages}
                currentUserUid={user.uid}
                onEdit={(msg) => { setEditingMessageId(msg.id); setInputText(msg.text); }}
                onDelete={deleteMessage}
                onReact={reactToMessage}
                onReply={(msg) => setReplyingTo(msg)}
            />
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
            isOffline={!navigator.onLine}
            isRoomReady={isRoomReady}
            typingUsers={typingUsers}
        />
        
        <CallManager 
            user={user}
            config={config}
            users={participants}
            onCloseParticipants={() => setShowParticipantsList(false)}
            showParticipants={showParticipantsList}
            roomCreatorId={null} 
        />

        <DeleteChatModal 
            show={showDeleteModal}
            onCancel={() => setShowDeleteModal(false)}
            onConfirm={handleDeleteRoom}
            isDeleting={isDeleting}
        />

        <EmailAlertModal 
            show={showEmailModal}
            onCancel={() => setShowEmailModal(false)}
            onSave={handleSaveEmail}
            isSaving={isSavingEmail}
            emailAlertsEnabled={emailAlertsEnabled}
            onToggleOff={handleUnsubscribeEmail}
            emailAddress={emailAddress}
            setEmailAddress={setEmailAddress}
        />
    </div>
  );
};

export default ChatScreen;
