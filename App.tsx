
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
        let isGoogleUser = false;
        
        if (session?.user) {
            // User is logged in
            const isAnon = !!session.user.is_anonymous;
            isGoogleUser = !isAnon;

            setCurrentUser({ 
                uid: session.user.id, 
                isAnonymous: isAnon,
                email: session.user.email 
            });
        }

        // 2. Check local storage for active room session details (for ALL users)
        // This ensures that if a Google user refreshes inside a room, they stay there.
        const storedPin = localStorage.getItem('chatPin');
        const storedRoomName = localStorage.getItem('chatRoomName');
        
        // We look for username/avatar in storage first (set by Login or Dashboard), 
        // fallback to session metadata for Google users if storage is empty.
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
            // If no active room in storage, but authenticated via Google, go to Dashboard
            setCurrentView('dashboard');
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
            // Only redirect to dashboard if we are NOT already in a chat state (handled by initSession above)
            setChatConfig(prev => {
                if (!prev) setCurrentView('dashboard');
                return prev;
            });
        }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleJoin = (config: ChatConfig) => {
    // Persist room details to localStorage so refresh works
    localStorage.setItem('chatPin', config.pin);
    localStorage.setItem('chatRoomName', config.roomName);
    localStorage.setItem('chatUsername', config.username);
    localStorage.setItem('chatAvatarURL', config.avatarURL);

    setChatConfig(config);
    setCurrentView('chat');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    
    // Clear persisted data on logout
    localStorage.removeItem('chatPin');
    localStorage.removeItem('chatRoomName');
    localStorage.removeItem('chatAvatarURL'); 

    setCurrentUser(null);
    setCurrentView('login');
  };

  const handleExitChat = () => {
    setChatConfig(null);
    
    // Clear active room persistence for everyone
    localStorage.removeItem("chatPin");
    localStorage.removeItem("chatRoomName");
    
    // If user is authenticated with Google, go back to Dashboard
    if (currentUser && !currentUser.isAnonymous) {
        setCurrentView('dashboard');
    } else {
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
