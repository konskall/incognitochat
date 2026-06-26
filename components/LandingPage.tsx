import React, { useState, useEffect, useRef } from 'react';
import { Shield, Lock, Zap, Smartphone, ArrowRight, Video, LogIn, KeyRound, Share2, MessagesSquare, ChevronDown, Sun, Moon, ArrowUp, Sparkles, Gem, Timer, Bell } from 'lucide-react';
import InstallButton from './InstallButton';
import PricingSection from './PricingSection';
import LegalModal from './LegalModal';
import { beginThemeTransition } from '../utils/helpers';
import HelicalDriftBG from '../lib/helicalDriftBg';

interface LandingPageProps {
  onStart: () => void;
  onChoosePlan: (tier: 'basic' | 'ultra') => void;
}

// Public-dir asset, resolved under the Vite base (`/incognitochat/`) so it works
// in dev, on GitHub Pages, and behind any custom domain — no hardcoded origin.
// The 192px PWA icon (not the 96px favicon) so the ~88px hero box stays crisp on
// high-DPR screens — a 96px source is too small once devicePixelRatio ≥ 1.5.
const LOGO = `${import.meta.env.BASE_URL}web-app-manifest-192x192.png`;

// Shared focus ring so keyboard users get a visible affordance (tap-highlight is
// disabled globally in index.css).
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-950';

// Per-theme tuning for the hero vortex (lib/helicalDriftBg). Dark uses an
// additive 'lighter' glow on the near-black background; light uses plain
// 'source-over' with a darker, denser palette so the dots read on near-white.
// NEVER use a software blend like 'multiply' for light — canvas software blend
// modes run on the CPU and collapse the frame rate (~1 fps).
const HERO_THEMES = {
  dark: { opacity: 0.6, blend: 'lighter', palette: ['#eaf2ff', '#3b6ef5', '#1b2b6b'] },
  light: {
    opacity: 1.0, blend: 'source-over', intensity: 1.1, pointSize: 1.8,
    spacing: 2.6, ringAmount: 0.42, palette: ['#0f1c56', '#2b4ed6', '#8fa9e0'],
  },
};

const FEATURES = [
  { icon: <Lock className="text-blue-500" />, title: 'PIN-Locked Private Rooms', description: 'Every message is scrambled with your room PIN — only people who join with the right name and PIN can read along.' },
  { icon: <Shield className="text-purple-500" />, title: 'No Sign-Up, Truly Anonymous', description: 'No phone number or email. Pick a username and a secret room; a Google login is optional, just to save your rooms.' },
  { icon: <Video className="text-green-500" />, title: 'Audio, Video & Screen Share', description: 'Group and 1-on-1 calls connect peer-to-peer with a secure relay fallback. Audio on Basic; video and screen sharing on Ultra.' },
  { icon: <Sparkles className="text-fuchsia-500" />, title: 'Inco AI Assistant', description: 'Summon an in-room AI to answer questions and look things up — with cited sources. Available on Ultra.' },
  { icon: <Timer className="text-orange-500" />, title: 'Disappearing & Self-Destruct Rooms', description: 'Set messages to vanish on a timer, or have the whole room auto-delete after a chosen period — on Basic and Ultra.' },
  { icon: <MessagesSquare className="text-emerald-500" />, title: 'Rich Messaging', description: 'Replies, reactions, polls, voice notes, location, a media gallery, link previews and in-room search.' },
  { icon: <Bell className="text-rose-500" />, title: 'Push & Email Alerts', description: 'Get notified of new messages by free web push — even when the app is closed — or by email on Basic and up, without exposing your message content.' },
  { icon: <Smartphone className="text-sky-500" />, title: 'Installable PWA + Dark Mode', description: 'Add it to your home screen like a native app, offline-ready, with a polished dark theme.' },
];

const STEPS = [
  {
    icon: <KeyRound size={22} className="text-blue-500" />,
    title: 'Create or join a room',
    description: 'Pick a room name and a PIN. If the room exists, the PIN lets you in; if not, it’s created instantly.',
  },
  {
    icon: <Share2 size={22} className="text-indigo-500" />,
    title: 'Share the name & PIN',
    description: 'Send the room name and PIN to whoever you want in the conversation — nothing else is needed.',
  },
  {
    icon: <MessagesSquare size={22} className="text-emerald-500" />,
    title: 'Chat & call privately',
    description: 'Message, share media, run polls, start audio/video calls, or summon Inco AI. Delete the room to wipe it for everyone.',
  },
];

// Kept in sync with the FAQPage JSON-LD in index.html.
// NOTE: the €5 / €10 amounts below are hardcoded copy. The pricing CARDS render
// LIVE Stripe prices (usePrices); these FAQ strings + the FAQPage JSON-LD in
// index.html do NOT — if the Stripe prices ever change, update BOTH here and the
// matching answers in index.html so advertised price === charged price.
const FAQS = [
  {
    q: 'Do I need an account to use Incognito Chat?',
    a: 'No. Just pick a username and a room — no phone number, email, or sign-up required. A Google login is optional, used to save your rooms and for paid plans.',
  },
  {
    q: 'Are my messages encrypted?',
    a: "Messages are scrambled with your room's PIN, and only members who join with the correct PIN can read them. This is strong access control rather than end-to-end encryption — treat the PIN like a shared password.",
  },
  {
    q: 'What plans are available and what do they cost?',
    a: 'Incognito Chat is free to use. Basic (€5/month) unlocks 10 rooms, 100 messages per day per room, audio calls, room customization, disappearing messages, a personal Notes room, email alerts, multi-file uploads and clear-chat. Ultra (€10/month) adds unlimited rooms and messages, video calls, screen sharing, the Inco AI assistant and 40MB uploads. You can cancel anytime from your dashboard.',
  },
  {
    q: 'How do the audio and video calls work?',
    a: "Calls connect directly between participants (peer-to-peer) when the network allows, and fall back to a secure relay otherwise. Audio calls are available on Basic and Ultra; video calls and screen sharing are Ultra (screen sharing isn't available on iPhone or iPad).",
  },
  {
    q: 'What is Inco, the AI assistant?',
    a: "Inco is an in-room AI helper available on Ultra. Mention “inco” in a message and it replies with answers and cited sources. Any signed-in member can switch it on or off for the room.",
  },
  {
    q: 'Can messages or rooms delete themselves?',
    a: 'Yes. On Basic and Ultra you can set messages to disappear on a timer, or have the entire room auto-delete after a chosen period. Free rooms also expire automatically 24 hours after they are created.',
  },
  {
    q: 'How large can my uploads be?',
    a: 'Up to 10MB per file on Free and Basic, and 40MB on Ultra. Images are compressed automatically to save data.',
  },
  {
    q: 'Will I be notified of new messages?',
    a: 'Yes — enable free web push notifications (they work even when the app is closed; on iPhone, add the app to your Home Screen first) or per-room email alerts on Basic and up. Your message content is never sent to the email service.',
  },
  {
    q: 'What happens when a room is deleted?',
    a: 'Any member can delete the room. Deleting it permanently removes every message and shared file for everyone — there is no archive.',
  },
  {
    q: 'Can I install it on my phone?',
    a: "Yes. It's a Progressive Web App — add it to your home screen from your browser to launch it like a native app, with optional push notifications.",
  },
];

// Fades/slides its children in the first time they scroll into view. Opacity-only
// motion on this wrapper, so inner cards keep their own hover transforms without
// fighting it. Reduce-motion users get an instant reveal (the global CSS guard
// zeroes the duration) — content is never left hidden.
const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number; as?: 'div' | 'li' }> = ({
  children,
  className = '',
  delay = 0,
  as: Tag = 'div',
}) => {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
    >
      {children}
    </Tag>
  );
};

// Defers MOUNTING its children until they approach the viewport. Unlike Reveal
// (which renders children immediately and only animates opacity), this keeps the
// subtree — and any effect/fetch it runs on mount — out of the initial landing
// view. Used to hold PricingSection's get-prices edge fetch until the user
// scrolls near it, so a bounce that never reaches pricing costs no invocation.
const DeferUntilVisible: React.FC<{ children: React.ReactNode; minHeight?: number }> = ({ children, minHeight = 640 }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return show ? <>{children}</> : <div ref={ref} aria-hidden="true" style={{ minHeight }} />;
};

const LandingPage: React.FC<LandingPageProps> = ({ onStart, onChoosePlan }) => {
  // Self-contained dark/light toggle. The boot script in index.html already set
  // the initial class from localStorage, so we seed from the live DOM state and
  // keep localStorage + the theme-color meta in sync (the rest of the app reads
  // the same localStorage key on entry).
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  const toggleTheme = () => {
    const next = !isDark;
    beginThemeTransition();
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    document.querySelector("meta[name='theme-color']")?.setAttribute('content', next ? '#020617' : '#f8fafc');
  };

  // Scroll-to-top affordance — appears once the user has scrolled past the hero.
  const [showTop, setShowTop] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Keep this tab's theme in sync when another tab toggles it (localStorage
  // 'theme' fires a 'storage' event only in OTHER tabs). Mirrors the class +
  // theme-color so both tabs agree, instead of only self-healing on reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'theme') return;
      const next = e.newValue === 'dark';
      setIsDark(next);
      document.documentElement.classList.toggle('dark', next);
      document.querySelector("meta[name='theme-color']")?.setAttribute('content', next ? '#020617' : '#f8fafc');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  // Ref (not getElementById) because PricingSection is lazy-mounted by
  // DeferUntilVisible — its #pricing element isn't in the DOM until the user
  // scrolls near it, so getElementById('pricing') was a silent no-op from the
  // top of the page (the "View Plans" button appeared dead). The ref targets the
  // always-present wrapper; scrolling to it brings the placeholder into view,
  // which mounts PricingSection.
  const pricingRef = useRef<HTMLDivElement>(null);
  const scrollToPricing = () => pricingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Animated phyllotactic-vortex background radiating from the hero logo. The
  // engine self-mounts a pointer-events:none, z-index:0 canvas layer into the
  // hero (behind the z-10 content) and handles its own resize, off-screen /
  // hidden-tab pause, reduced-motion and DPR caps — see lib/helicalDriftBg.
  // Shown in BOTH themes with per-theme tuning (HERO_THEMES): the blend mode and
  // palette switch so it glows on dark and reads cleanly on light. Re-created on
  // every theme change (`theme` dep) with destroy() cleanup, so there is never
  // more than one canvas layer.
  const heroRef = useRef<HTMLElement>(null);
  const heroLogoRef = useRef<HTMLImageElement>(null);
  const theme = isDark ? 'dark' : 'light';
  useEffect(() => {
    const host = heroRef.current;
    const logo = heroLogoRef.current;
    if (!host || !logo) return;
    const bg = new HelicalDriftBG(host, {
      centerEl: logo,
      voidPad: 2,
      rotationSpeed: 0.03,
      ...HERO_THEMES[theme],
    });
    return () => bg.destroy();
  }, [theme]);

  return (
    <div
      className="min-h-[100dvh] overflow-x-clip bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-300 selection:bg-blue-500 selection:text-white"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      {/* Top nav (sticky, glass) */}
      <header
        className="sticky top-0 z-30 border-b border-slate-200/60 dark:border-slate-800/60 bg-slate-50/80 dark:bg-slate-950/80 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
        <button
          type="button"
          onClick={scrollToTop}
          aria-label="Back to top"
          className={`flex items-center gap-2.5 rounded-xl -m-1 p-1 ${focusRing}`}
        >
          <img src={LOGO} alt="" width={32} height={32} className="w-8 h-8 rounded-lg shadow-sm" />
          <span className="font-extrabold tracking-tight text-slate-900 dark:text-white">Incognito Chat</span>
        </button>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            onClick={toggleTheme}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`p-2 rounded-full inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-500 hover:text-blue-600 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800 transition-colors active:scale-90 ${focusRing}`}
          >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <InstallButton />
          <button
            onClick={onStart}
            title="Log in"
            aria-label="Log in"
            className={`p-2 rounded-full inline-flex items-center justify-center min-w-[44px] min-h-[44px] text-slate-500 hover:text-blue-600 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800 transition-colors active:scale-90 ${focusRing}`}
          >
            <LogIn size={20} />
          </button>
        </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Section */}
        <section ref={heroRef} aria-labelledby="hero-title" className="relative overflow-hidden pt-10 pb-12 lg:pt-24 lg:pb-24">
          {/* Background blob (decorative, clipped by overflow-hidden) */}
          <div
            aria-hidden="true"
            style={{ animationDuration: '7s' }}
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-blue-500/10 dark:bg-blue-600/5 rounded-full blur-3xl pointer-events-none animate-pulse"
          ></div>

          <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
            <div className="flex justify-center mb-8 animate-in fade-in zoom-in duration-700">
              <div className="relative animate-float">
                <div aria-hidden="true" className="absolute -inset-4 bg-blue-500/20 rounded-full blur-xl"></div>
                <img
                  ref={heroLogoRef}
                  src={LOGO}
                  alt="Incognito Chat logo"
                  width={96}
                  height={96}
                  fetchPriority="high"
                  className="relative w-24 h-24 rounded-3xl shadow-2xl border-4 border-white dark:border-slate-800"
                />
              </div>
            </div>

            <h1
              id="hero-title"
              className="text-4xl sm:text-5xl lg:text-7xl font-black tracking-tight mb-6 bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent animate-in slide-in-from-bottom-4 duration-700"
            >
              Speak Free.<br />Stay Invisible.
            </h1>

            <p className="max-w-2xl mx-auto text-lg lg:text-xl text-slate-600 dark:text-slate-400 leading-relaxed mb-10 animate-in slide-in-from-bottom-6 duration-700 delay-100">
              Incognito Chat is a privacy-first messaging app. Spin up a room, lock it with a PIN, and only the people you invite can read along — no phone number, no sign-up. Add calls, AI, polls and disappearing messages when you want more.
            </p>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-3 sm:gap-4 animate-in slide-in-from-bottom-8 duration-700 delay-200">
              <button
                onClick={onStart}
                className={`group relative px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 ${focusRing}`}
              >
                Start Chatting Now
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={scrollToPricing}
                className={`group relative px-8 py-4 font-bold rounded-2xl text-white transition-all hover:scale-105 active:scale-95 ${focusRing}`}
              >
                <span aria-hidden="true" className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-purple-500 to-indigo-500 opacity-40 blur-md group-hover:opacity-80 transition-opacity"></span>
                <span className="relative flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 -mx-8 -my-4 px-8 py-4 rounded-2xl shadow-xl shadow-purple-500/30">
                  <Gem size={20} className="group-hover:rotate-12 transition-transform" />
                  View Plans
                </span>
              </button>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section aria-labelledby="features-title" className="max-w-7xl mx-auto px-6 py-12 lg:py-20">
          <Reveal><h2 id="features-title" className="text-3xl font-bold text-center mb-10 lg:mb-14">Why Incognito Chat</h2></Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 90}>
                <FeatureCard icon={f.icon} title={f.title} description={f.description} />
              </Reveal>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-title" className="max-w-5xl mx-auto px-6 py-12 lg:py-20">
          <Reveal><h2 id="how-title" className="text-3xl font-bold text-center mb-10 lg:mb-14">How it works</h2></Reveal>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 110}>
                <div className="group relative h-full bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                  <span className="absolute -top-3 -left-3 w-9 h-9 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shadow-lg shadow-blue-600/30 transition-transform duration-300 group-hover:scale-110">
                    {i + 1}
                  </span>
                  <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-4 shadow-inner transition-transform duration-300 group-hover:scale-110">
                    {s.icon}
                  </div>
                  <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                  <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{s.description}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* scroll-mt-20 keeps the heading clear of the sticky glass header. */}
        <div ref={pricingRef} className="scroll-mt-20">
          <DeferUntilVisible minHeight={720}>
            <PricingSection onStartFree={onStart} onChoosePlan={onChoosePlan} />
          </DeferUntilVisible>
        </div>

        {/* Trust Section */}
        <section aria-labelledby="trust-title" className="max-w-4xl mx-auto px-6 py-12 lg:py-20 text-center">
          <Reveal className="bg-blue-50 dark:bg-blue-900/10 rounded-3xl p-8 lg:p-12 border border-blue-100 dark:border-blue-900/30">
            <div className="inline-flex p-3 bg-blue-600 text-white rounded-2xl mb-6 shadow-lg shadow-blue-600/20">
              <Zap size={32} />
            </div>
            <h2 id="trust-title" className="text-3xl font-bold mb-4">Fast & Transient</h2>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-0">
              Rooms are created instantly — just share the name and PIN to start talking. When a member deletes the room, every message and shared file is wiped for everyone.
            </p>
          </Reveal>
        </section>

        {/* FAQ */}
        <section aria-labelledby="faq-title" className="max-w-3xl mx-auto px-6 py-12 lg:py-20">
          <Reveal><h2 id="faq-title" className="text-3xl font-bold text-center mb-10 lg:mb-14">Frequently asked questions</h2></Reveal>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <Reveal key={f.q} delay={i * 70}>
              <details className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm transition-colors duration-200 hover:border-blue-200 dark:hover:border-blue-900/50">
                <summary className={`flex items-center justify-between gap-4 cursor-pointer list-none px-5 py-4 font-semibold text-slate-800 dark:text-slate-100 rounded-2xl [&::-webkit-details-marker]:hidden ${focusRing}`}>
                  <span>{f.q}</span>
                  <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.a}</p>
              </details>
              </Reveal>
            ))}
          </div>
        </section>
      </main>

      <footer
        className="py-12 px-6 border-t border-slate-200 dark:border-slate-900 text-center text-slate-600 dark:text-slate-400 text-sm"
        style={{ paddingBottom: 'max(3rem, env(safe-area-inset-bottom))' }}
      >
        {/* Stacks on phones (© line, then tagline); single line on ≥sm with a dot. */}
        <p className="flex flex-col sm:flex-row items-center justify-center gap-x-2 gap-y-0.5">
          <span>© {new Date().getFullYear()} Incognito Chat</span>
          <span aria-hidden="true" className="hidden sm:inline text-slate-300 dark:text-slate-700">·</span>
          <span>Private, anonymous, ephemeral.</span>
        </p>
        <p className="mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setShowLegal(true)}
            className={`text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-medium hover:underline transition-colors rounded ${focusRing}`}
          >
            Privacy &amp; Terms
          </button>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
          <a
            href="mailto:info@incognitochat.gr"
            className={`text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 font-medium hover:underline transition-colors rounded ${focusRing}`}
          >
            Contact
          </a>
        </p>
      </footer>

      <LegalModal show={showLegal} onClose={() => setShowLegal(false)} />

      {/* Scroll-to-top */}
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Scroll to top"
        style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom))', right: 'max(1.5rem, env(safe-area-inset-right))' }}
        className={`fixed z-40 p-3 rounded-full bg-blue-600 text-white shadow-xl shadow-blue-600/30 hover:bg-blue-700 transition-all duration-300 active:scale-90 ${focusRing} ${showTop ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'}`}
      >
        <ArrowUp size={20} />
      </button>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
  <div className="group h-full bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-blue-200 dark:hover:border-blue-900/50 transition-all duration-300">
    <div className="w-14 h-14 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-6 shadow-inner transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-3">{title}</h3>
    <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{description}</p>
  </div>
);

export default LandingPage;
