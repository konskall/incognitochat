
import React, { useState, useEffect } from 'react';
import LoginScreen from './components/LoginScreen';
import ChatScreen from './components/ChatScreen';
import DashboardScreen from './components/DashboardScreen';
import { ChatConfig, User } from './types';
import { generateRoomKey } from './utils/helpers';
import { supabase } from './services/supabase';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'login' | 'dashboard' | 'chat'>('login');
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    // 1. Check for active session from URL (OAuth redirect) or LocalStorage
    const initSession = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
            // User is logged in
            const isAnon = !!session.user.is_anonymous;
            setCurrentUser({ 
                uid: session.user.id, 
                isAnonymous: isAnon,
                email: session.user.email 
            });

            if (!isAnon) {
                // If persistent user (Google), go to Dashboard
                setCurrentView('dashboard');
                return;
            }
        }

        // 2. Auto-login logic for anonymous users: Check local storage for session details
        // Only if we didn't find a Google session above.
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
            setCurrentView('chat');
        } else {
            // If no session and no local storage room data, show login
            if (!session?.user) {
                setCurrentView('login');
            }
        }
    };
    
    initSession();

    // Listen for auth changes (e.g. successful OAuth redirect)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user && !session.user.is_anonymous) {
             setCurrentUser({ 
                uid: session.user.id, 
                isAnonymous: false,
                email: session.user.email 
            });
            // If we are not already in a chat, show dashboard
            setChatConfig(prev => {
                if (!prev) setCurrentView('dashboard');
                return prev;
            });
        }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleJoin = (config: ChatConfig) => {
    setChatConfig(config);
    setCurrentView('chat');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setCurrentView('login');
  };

  const handleExitChat = () => {
    setChatConfig(null);
    
    // If user is authenticated with Google, go back to Dashboard
    if (currentUser && !currentUser.isAnonymous) {
        setCurrentView('dashboard');
    } else {
        // If anonymous, go back to login and clear room persistence
        localStorage.removeItem("chatPin");
        localStorage.removeItem("chatRoomName");
        setCurrentView('login');
    }
  };

  return (
    <div className="min-h-[100dvh] w-full">
      {currentView === 'chat' && chatConfig ? (
        <ChatScreen config={chatConfig} onExit={handleExitChat} />
      ) : currentView === 'dashboard' && currentUser ? (
        <DashboardScreen user={currentUser} onJoinRoom={handleJoin} onLogout={handleLogout} />
      ) : (
        <LoginScreen onJoin={handleJoin} />
      )}
    </div>
  );
};

export default App;
