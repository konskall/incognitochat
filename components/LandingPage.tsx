import React, { useState, useEffect, useRef } from 'react';
import { Shield, Lock, Zap, Smartphone, ArrowRight, Video, LogIn, KeyRound, Share2, MessagesSquare, ChevronDown, Sun, Moon, ArrowUp } from 'lucide-react';
import InstallButton from './InstallButton';

interface LandingPageProps {
  onStart: () => void;
}

// Public-dir asset, resolved under the Vite base (`/incognitochat/`) so it works
// in dev, on GitHub Pages, and behind any custom domain — no hardcoded origin.
const LOGO = `${import.meta.env.BASE_URL}favicon-96x96.png`;

// Shared focus ring so keyboard users get a visible affordance (tap-highlight is
// disabled globally in index.css).
const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-offset-slate-950';

const FEATURES = [
  {
    icon: <Lock className="text-blue-500" />,
    title: 'PIN-Locked Rooms',
    description:
      'Every message is scrambled with your room PIN, and only people who join with the correct name and PIN can read along.',
  },
  {
    icon: <Shield className="text-purple-500" />,
    title: 'No Sign-Up Required',
    description: 'No phone number or personal data needed — just pick a username and a secret room.',
  },
  {
    icon: <Video className="text-green-500" />,
    title: 'Audio & Video Calls',
    description: 'Group and 1-on-1 calls connect peer-to-peer when the network allows, with a secure relay as fallback.',
  },
  {
    icon: <Smartphone className="text-orange-500" />,
    title: 'Installable PWA',
    description: 'Add it to your home screen like a native app, with optional push notifications and an offline-ready shell.',
  },
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
    description: 'Message, share media, run polls, and start audio/video calls. Delete the room to wipe it for everyone.',
  },
];

// Kept in sync with the FAQPage JSON-LD in index.html.
const FAQS = [
  {
    q: 'Do I need an account to use Incognito Chat?',
    a: 'No. Just pick a username and a room — no phone number, email, or sign-up required. A Google login is optional and only used to save your rooms.',
  },
  {
    q: 'Are my messages encrypted?',
    a: "Messages are scrambled with your room's PIN, and only members who join with the correct PIN can read them. This is strong access control rather than end-to-end encryption — treat the PIN like a shared password.",
  },
  {
    q: 'How do the audio and video calls work?',
    a: "Calls connect directly between participants (peer-to-peer) when the network allows, and fall back to a secure relay when a direct connection isn't possible. Both group and 1-on-1 calls are supported.",
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

const LandingPage: React.FC<LandingPageProps> = ({ onStart }) => {
  // Self-contained dark/light toggle. The boot script in index.html already set
  // the initial class from localStorage, so we seed from the live DOM state and
  // keep localStorage + the theme-color meta in sync (the rest of the app reads
  // the same localStorage key on entry).
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
    document.querySelector("meta[name='theme-color']")?.setAttribute('content', next ? '#020617' : '#f8fafc');
  };

  // Scroll-to-top affordance — appears once the user has scrolled past the hero.
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div
      className="min-h-[100dvh] overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-300 selection:bg-blue-500 selection:text-white"
      style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      {/* Top nav */}
      <header
        className="relative z-20 max-w-7xl mx-auto flex items-center justify-between px-6 pb-4"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
      >
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
            className={`p-2 rounded-full text-slate-500 hover:text-blue-600 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800 transition-colors active:scale-90 ${focusRing}`}
          >
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <InstallButton />
          <button
            onClick={onStart}
            title="Log in"
            aria-label="Log in"
            className={`p-2 rounded-full text-slate-500 hover:text-blue-600 hover:bg-slate-200/70 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800 transition-colors active:scale-90 ${focusRing}`}
          >
            <LogIn size={20} />
          </button>
        </div>
      </header>

      <main id="top">
        {/* Hero Section */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden pt-10 pb-12 lg:pt-24 lg:pb-24">
          {/* Background blob (decorative, clipped by overflow-hidden) */}
          <div
            aria-hidden="true"
            style={{ animationDuration: '7s' }}
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-blue-500/10 dark:bg-blue-600/5 rounded-full blur-3xl pointer-events-none animate-pulse"
          ></div>

          <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
            <div className="flex justify-center mb-8 animate-in fade-in zoom-in duration-700">
              <div className="relative animate-float">
                <div aria-hidden="true" className="absolute -inset-4 bg-blue-500/20 rounded-full blur-xl animate-pulse"></div>
                <img
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
              Incognito Chat is a privacy-first messaging app. Spin up a room, lock it with a PIN, and only the people you invite can read along — no phone number, no sign-up.
            </p>

            <div className="flex justify-center animate-in slide-in-from-bottom-8 duration-700 delay-200">
              <button
                onClick={onStart}
                className={`group relative px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 ${focusRing}`}
              >
                Start Chatting Now
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
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
      </main>

      <footer
        className="py-12 px-6 border-t border-slate-200 dark:border-slate-900 text-center text-slate-600 dark:text-slate-500 text-sm"
        style={{ paddingBottom: 'max(3rem, env(safe-area-inset-bottom))' }}
      >
        {/* Stacks on phones (© line, then tagline); single line on ≥sm with a dot. */}
        <p className="flex flex-col sm:flex-row items-center justify-center gap-x-2 gap-y-0.5">
          <span>© {new Date().getFullYear()} Incognito Chat</span>
          <span aria-hidden="true" className="hidden sm:inline text-slate-300 dark:text-slate-700">·</span>
          <span>Private, anonymous, ephemeral.</span>
        </p>
      </footer>

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
