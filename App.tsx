import React, { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import ChatScreen from './components/ChatScreen';
import { ChatConfig } from './types';
import { generateRoomKey, initAudio } from './utils/helpers';

const App: React.FC = () => {
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);

  useEffect(() => {
    // Audio Context Unlock for Mobile Browsers
    // Browsers block audio context unless resumed by a user gesture
    // We use initAudio() which plays a silent sound to unlock it without annoying the user
    const unlockAudio = () => {
       initAudio(); 
       window.removeEventListener('click', unlockAudio);
       window.removeEventListener('touchstart', unlockAudio);
       window.removeEventListener('keydown', unlockAudio);
    };

    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    // Auto-login logic: Check local storage for session details
    const storedPin = localStorage.getItem('chatPin');
    const storedRoomName = localStorage.getItem('chatRoomName');
    const storedUsername = localStorage.getItem('chatUsername');
    const storedAvatar = localStorage.getItem('chatAvatarURL');

    if (storedPin && storedRoomName && storedUsername) {
      const roomKey = generateRoomKey(storedPin, storedRoomName);
      setChatConfig({
        username: storedUsername,
        avatarURL: storedAvatar || '',
        roomName: storedRoomName,
        pin: storedPin,
        roomKey: roomKey
      });
    }
  }, []);

  const handleJoin = (config: ChatConfig) => {
    setChatConfig(config);
  };

  const handleExit = () => {
    setChatConfig(null);
    localStorage.removeItem("chatPin");
    localStorage.removeItem("chatRoomName");
    // We keep username/avatar in localstorage for convenience
  };

  return (
    <div className="min-h-[100dvh] w-full">
      {chatConfig ? (
        <ChatScreen config={chatConfig} onExit={handleExit} />
      ) : (
        <LoginScreen onJoin={handleJoin} />
      )}
    </div>
  );
};

export default App;
