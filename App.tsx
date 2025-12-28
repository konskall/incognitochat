
import React, { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import ChatScreen from './components/ChatScreen';
import DashboardScreen from './components/DashboardScreen';
import LandingPage from './components/LandingPage';
import { ChatConfig, User } from './types';
import { generateRoomKey } from './utils/helpers';
import { supabase } from './services/supabase';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'landing' | 'login' | 'dashboard' | 'chat'>('landing');
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    // Check if user has already seen landing page in this session
    const hasSeenLanding = sessionStorage.getItem('hasSeenLanding');
    
    // 1. Check for active session from URL (OAuth redirect) or LocalStorage
    const initSession = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        let isGoogleUser = false;
        
        if (session?.user) {
            const isAnon = !!session.user.is_anonymous;
            isGoogleUser = !isAnon;

            setCurrentUser({ 
                uid: session.user.id, 
                isAnonymous: isAnon,
                email: session.user.email 
            });
        }

        const storedPin = localStorage.getItem('chatPin');
        const storedRoomName = localStorage.getItem('chatRoomName');
        const storedUsername = localStorage.getItem('chatUsername') || session?.user?.user_metadata?.full_name;
        const storedAvatar = localStorage.getItem('chatAvatarURL') || session?.user?.user_metadata?.avatar_url;
        
        if (storedPin && storedRoomName && storedUsername) {
            const roomKey = generateRoomKey(storedPin, storedRoomName);
            setChatConfig({
                username: storedUsername,
                avatarURL: storedAvatar || '',
                roomName: storedRoomName,
                pin: storedPin,
                roomKey: roomKey
            });
            setCurrentView('chat');
        } else if (isGoogleUser) {
            setCurrentView('dashboard');
        } else if (hasSeenLanding) {
            // If they haven't logged in but have seen the landing, show login
            setCurrentView('login');
        } else {
            // Default is landing
            setCurrentView('landing');
        }
    };
    
    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user && !session.user.is_anonymous) {
             setCurrentUser({ 
                uid: session.user.id, 
                isAnonymous: false,
                email: session.user.email 
            });
            setChatConfig(prev => {
                if (!prev) setCurrentView('dashboard');
                return prev;
            });
        }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleJoin = (config: ChatConfig) => {
    localStorage.setItem('chatPin', config.pin);
    localStorage.setItem('chatRoomName', config.roomName);
    localStorage.setItem('chatUsername', config.username);
    localStorage.setItem('chatAvatarURL', config.avatarURL);

    setChatConfig(config);
    setCurrentView('chat');
  };

  const handleStartApp = () => {
    sessionStorage.setItem('hasSeenLanding', 'true');
    if (currentUser && !currentUser.isAnonymous) {
      setCurrentView('dashboard');
    } else {
      setCurrentView('login');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('chatPin');
    localStorage.removeItem('chatRoomName');
    localStorage.removeItem('chatAvatarURL'); 

    setCurrentUser(null);
    setCurrentView('login');
  };

  const handleExitChat = () => {
    setChatConfig(null);
    localStorage.removeItem("chatPin");
    localStorage.removeItem("roomName");
    
    if (currentUser && !currentUser.isAnonymous) {
        setCurrentView('dashboard');
    } else {
        setCurrentView('login');
    }
  };

  return (
    <div className="min-h-[100dvh] w-full">
      {currentView === 'landing' ? (
        <LandingPage onStart={handleStartApp} />
      ) : currentView === 'chat' && chatConfig ? (
        <ChatScreen config={chatConfig} onExit={handleExitChat} />
      ) : currentView === 'dashboard' && currentUser ? (
        <DashboardScreen user={currentUser} onJoinRoom={handleJoin} onLogout={handleLogout} />
      ) : (
        <LoginScreen onJoin={handleJoin} onShowLanding={() => setCurrentView('landing')} />
      )}
    </div>
  );
};

export default App;
