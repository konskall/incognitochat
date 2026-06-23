
import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import LandingPage from './components/LandingPage';
import ErrorBoundary from './components/ErrorBoundary';
import { ChatConfig, User } from './types';
import { generateRoomKey } from './utils/helpers';
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

  // Prevents a double-click on a paid CTA from firing two create-checkout-session
  // calls (each would open an orphaned Stripe session).
  const checkoutBusy = React.useRef(false);

  useEffect(() => {
    // Check if user has already seen landing page in this session
    const hasSeenLanding = sessionStorage.getItem('hasSeenLanding');
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    // Supabase is dynamic-imported (NOT a top-level import) so @supabase/supabase-js
    // (~210KB) stays OFF the marketing landing's first-paint critical path; it loads
    // right after mount when we check the session.
    (async () => {
      const { supabase, startCheckout } = await import('./services/supabase');
      if (cancelled) return;

      // 1. Restore session (OAuth redirect or stored session) and route.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
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
        const storedAvatar = localStorage.getItem('chatAvatarURL') || session?.user?.user_metadata?.custom_avatar || session?.user?.user_metadata?.avatar_url;

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
        if (!cancelled) setCurrentView(hasSeenLanding ? 'login' : 'landing');
      }

      if (cancelled) return;

      // 2. Auth state listener (sign-in redirect handling + paid-plan resume).
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user && !session.user.is_anonymous) {
            setCurrentUser({
                uid: session.user.id,
                isAnonymous: false,
                email: session.user.email
            });
            // Only an explicit interactive sign-in (returning from the Google OAuth
            // redirect) routes to the dashboard AND resumes a pending checkout.
            // INITIAL_SESSION / TOKEN_REFRESHED also fire on every page refresh;
            // gating BOTH on SIGNED_IN stops (a) a logged-in user being bounced out
            // of a restored room on refresh, and (b) a STALE pendingCheckoutTier
            // silently re-launching Stripe on a later refresh/token-refresh.
            if (event === 'SIGNED_IN') {
                // Resume a paid-plan intent captured before the sign-in redirect.
                // removeItem first so this can never loop; share the checkoutBusy
                // guard so the resume can't race a manual Upgrade click into two sessions.
                const pending = sessionStorage.getItem('pendingCheckoutTier');
                if ((pending === 'basic' || pending === 'ultra') && !checkoutBusy.current) {
                    sessionStorage.removeItem('pendingCheckoutTier');
                    checkoutBusy.current = true;
                    // Defer a tick so the dashboard view flushes before navigating to Stripe.
                    setTimeout(() => {
                        void startCheckout(pending)
                            .then((r) => { if (!r.ok) flashToast('Could not start checkout. Please try again.'); })
                            .finally(() => { checkoutBusy.current = false; });
                    }, 0);
                }
                setCurrentView(prev => (prev === 'chat' ? prev : 'dashboard'));
            }
        } else if (event === 'SIGNED_OUT') {
            // A sign-out (or token revocation / permanent refresh failure), possibly
            // propagated from ANOTHER tab via shared storage. Supabase emits this with
            // a null session. Mirror handleLogout's in-tab cleanup so this tab doesn't
            // keep rendering a stale signed-in identity (email + room list) until refresh.
            setCurrentUser(null);
            setChatConfig(null);
            setCurrentView(prev => (prev === 'landing' ? prev : 'login'));
        }
      });
      subscription = data.subscription;
    })();

    return () => { cancelled = true; if (subscription) subscription.unsubscribe(); };
  }, []);

  const handleJoin = (config: ChatConfig) => {
    // Entering a room means the user chose to chat, not pay — drop any stale paid
    // intent so it can't resume a Stripe redirect on a later sign-in (see BF-1).
    sessionStorage.removeItem('pendingCheckoutTier');
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
      if (checkoutBusy.current) return;            // ignore rapid double-clicks
      checkoutBusy.current = true;
      try {
        const { startCheckout } = await import('./services/supabase');
        const res = await startCheckout(tier);
        if (!res.ok) flashToast(res.error === 'LOGIN_REQUIRED' ? 'Please sign in with Google to upgrade.' : 'Could not start checkout. Please try again.');
      } finally {
        checkoutBusy.current = false;
      }
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
    sessionStorage.removeItem('pendingCheckoutTier'); // abandon any pending paid intent
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

  // Handle returns from Stripe Checkout / Customer Portal: toast + clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const portal = params.get('portal');
    if (!checkout && !portal) return;
    if (checkout === 'success') {
      // The entitlement webhook is asynchronous — the plan may not be committed the
      // instant Stripe redirects back. Don't assert "active"; mark a short poll
      // (useEntitlements reads this) so features unlock as soon as the webhook lands.
      sessionStorage.setItem('postCheckoutPoll', '1');
      flashToast('Payment received — activating your plan…');
    }
    else if (checkout === 'cancel') flashToast('Checkout canceled.');
    else if (portal === 'return') flashToast('Billing updated.');
    // Strip the params so a refresh doesn't re-toast.
    params.delete('checkout'); params.delete('portal');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, []);

  const handleLogout = async () => {
    const { supabase } = await import('./services/supabase');
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
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
};

export default App;
