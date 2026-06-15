
import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import LandingPage from './components/LandingPage';
import { ChatConfig, User } from './types';
import { generateRoomKey } from './utils/helpers';
import { supabase, startCheckout } from './services/supabase';
import { flashToast } from './components/MessageActionMenu';

// Route-level code splitting: each screen is its own chunk so a visitor landing
// on the marketing/login view doesn't download the (heavy) chat + dashboard
// code. LandingPage stays eager — it's the initial paint.
const ChatScreen = lazy(() => import('./components/ChatScreen'));
const DashboardScreen = lazy(() => import('./components/DashboardScreen'));
const LoginScreen = lazy(() => import('./components/LoginScreen'));

const ScreenLoader: React.FC = () => (
  <div className="min-h-[100dvh] w-full flex items-center justify-center bg-slate-50 dark:bg-slate-950">
    <div className="w-8 h-8 border-2 border-slate-300 dark:border-slate-700 border-t-blue-500 rounded-full animate-spin" />
  </div>
);

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'landing' | 'login' | 'dashboard' | 'chat'>('landing');
  const [chatConfig, setChatConfig] = useState<ChatConfig | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // The popstate listener runs from a []-deps effect, so it can't read
  // currentView/currentUser directly without going stale. Mirror them into refs.
  const viewRef = React.useRef(currentView);
  useEffect(() => { viewRef.current = currentView; }, [currentView]);
  const userRef = React.useRef(currentUser);
  useEffect(() => { userRef.current = currentUser; }, [currentUser]);

  useEffect(() => {
    // Check if user has already seen landing page in this session
    const hasSeenLanding = sessionStorage.getItem('hasSeenLanding');
    
    // 1. Check for active session from URL (OAuth redirect) or LocalStorage
    const initSession = async () => {
      try {
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
            // Push a chat history entry so Back from a restored room steps to the
            // dashboard/login (handled in onPopState) instead of exiting the SPA.
            window.history.pushState({ icView: 'chat' }, '');
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
      } catch (e) {
        // getSession can reject (offline, CORS, corrupt stored session). Don't
        // hang on a blank screen — fall back to a usable entry point.
        console.error('Session restore failed', e);
        setCurrentView(hasSeenLanding ? 'login' : 'landing');
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user && !session.user.is_anonymous) {
            setCurrentUser({
                uid: session.user.id,
                isAnonymous: false,
                email: session.user.email
            });
            // Resume a paid-plan intent captured on the landing page before the
            // Google sign-in redirect. removeItem first so this can never loop.
            const pending = sessionStorage.getItem('pendingCheckoutTier');
            if (pending === 'basic' || pending === 'ultra') {
                sessionStorage.removeItem('pendingCheckoutTier');
                setTimeout(() => { void startCheckout(pending); }, 0);
            }
            // Only an explicit interactive sign-in (returning from the Google OAuth
            // redirect) routes to the dashboard. INITIAL_SESSION / TOKEN_REFRESHED
            // also fire on every page refresh, and previously this handler redirected
            // here on those too — racing with (and beating) initSession's room
            // restore, which bounced a logged-in user out of their room on refresh.
            // Gating on SIGNED_IN + not clobbering an already-restored chat fixes it.
            if (event === 'SIGNED_IN') {
                setCurrentView(prev => (prev === 'chat' ? prev : 'dashboard'));
            }
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
    // Push a chat history entry so the browser Back button steps back to the
    // dashboard/login (see onPopState) instead of jumping to the landing page.
    window.history.pushState({ icView: 'chat' }, '');
    setCurrentView('chat');
  };

  const handleStartApp = () => {
    sessionStorage.setItem('hasSeenLanding', 'true');
    // Push a history entry for the landing→app transition so the browser Back
    // button returns to the marketing page instead of leaving the site (handled
    // by the popstate listener below). This is the only entry we push.
    window.history.pushState({ icAppEntry: true }, '');
    if (currentUser && !currentUser.isAnonymous) {
      setCurrentView('dashboard');
    } else {
      setCurrentView('login');
    }
  };

  const handleChoosePlan = useCallback(async (tier: 'basic' | 'ultra') => {
    // Logged-in Google user -> straight to Stripe Checkout.
    if (currentUser && !currentUser.isAnonymous) {
      const res = await startCheckout(tier);
      if (!res.ok) flashToast(res.error === 'LOGIN_REQUIRED' ? 'Please sign in with Google to upgrade.' : 'Could not start checkout. Please try again.');
      return;
    }
    // Visitor / anonymous -> remember intent, send to login; resume after sign-in.
    sessionStorage.setItem('pendingCheckoutTier', tier);
    handleStartApp();
  }, [currentUser]);

  // Show the marketing landing again, and clear the "seen" flag so a subsequent
  // refresh stays on the landing instead of routing back to login.
  const goToLanding = () => {
    sessionStorage.removeItem('hasSeenLanding');
    setCurrentView('landing');
  };

  // History-aware Back. From a room, step back to the dashboard (Google) /
  // login (anon) — NOT all the way out to the marketing landing (the old
  // handler unconditionally went to landing, dumping the user out of their
  // place). From any other in-app view, Back returns to the landing. Reads the
  // live view/user via refs because this effect has []-deps.
  useEffect(() => {
    const onPopState = () => {
      if (viewRef.current === 'chat') {
        setChatConfig(null);
        localStorage.removeItem('chatPin');
        localStorage.removeItem('chatRoomName');
        setCurrentView(userRef.current && !userRef.current.isAnonymous ? 'dashboard' : 'login');
      } else {
        goToLanding();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // Clear all per-user local data so the next person on a shared device can't
    // see the previous user's identity, room list or read state. (Custom room
    // order now lives server-side in room_settings.sort_order; the roomOrder_*
    // sweep here just purges legacy localStorage copies left by older builds.)
    try {
      Object.keys(localStorage).forEach((k) => {
        if (
          k === 'chatPin' || k === 'chatRoomName' || k === 'chatAvatarURL' || k === 'chatUsername' ||
          k.startsWith('roomOrder_') || k.startsWith('lastRead_') || k.startsWith('joined_') || k.startsWith('roomFav_')
        ) {
          localStorage.removeItem(k);
        }
      });
    } catch { /* ignore */ }

    setCurrentUser(null);
    setCurrentView('login');
  };

  const handleExitChat = () => {
    setChatConfig(null);
    localStorage.removeItem("chatPin");
    // Was "roomName" (wrong key) — the value is stored under "chatRoomName",
    // so the room name used to linger after exiting the chat.
    localStorage.removeItem("chatRoomName");

    if (currentUser && !currentUser.isAnonymous) {
        setCurrentView('dashboard');
    } else {
        setCurrentView('login');
    }
  };

  return (
    <div className="min-h-[100dvh] w-full">
      {currentView === 'landing' ? (
        <LandingPage onStart={handleStartApp} onChoosePlan={handleChoosePlan} />
      ) : (
        <Suspense fallback={<ScreenLoader />}>
          {currentView === 'chat' && chatConfig ? (
            <ChatScreen config={chatConfig} onExit={handleExitChat} />
          ) : currentView === 'dashboard' && currentUser ? (
            <DashboardScreen user={currentUser} onJoinRoom={handleJoin} onLogout={handleLogout} />
          ) : (
            <LoginScreen onJoin={handleJoin} onShowLanding={goToLanding} />
          )}
        </Suspense>
      )}
    </div>
  );
};

export default App;
