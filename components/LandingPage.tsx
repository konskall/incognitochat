import React from 'react';
import { Shield, Lock, Zap, Smartphone, ArrowRight, Video, LogIn, KeyRound, Share2, MessagesSquare, ChevronDown } from 'lucide-react';
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

const LandingPage: React.FC<LandingPageProps> = ({ onStart }) => {
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
        <a href="#top" className={`flex items-center gap-2.5 rounded-xl -m-1 p-1 ${focusRing}`}>
          <img src={LOGO} alt="" width={32} height={32} className="w-8 h-8 rounded-lg shadow-sm" />
          <span className="font-extrabold tracking-tight text-slate-900 dark:text-white">Incognito Chat</span>
        </a>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <InstallButton />
          <button
            onClick={onStart}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition active:scale-95 ${focusRing}`}
          >
            <LogIn size={16} /> Log in
          </button>
        </div>
      </header>

      <main id="top">
        {/* Hero Section */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden pt-10 pb-12 lg:pt-24 lg:pb-24">
          {/* Background blob (decorative, clipped by overflow-hidden) */}
          <div
            aria-hidden="true"
            className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-blue-500/10 dark:bg-blue-600/5 rounded-full blur-3xl pointer-events-none"
          ></div>

          <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
            <div className="flex justify-center mb-8 animate-in fade-in zoom-in duration-700">
              <div className="relative">
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

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in slide-in-from-bottom-8 duration-700 delay-200">
              <button
                onClick={onStart}
                className={`group relative px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-2 ${focusRing}`}
              >
                Start Chatting Now
                <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
              </button>
              <button
                onClick={onStart}
                className={`px-6 py-4 rounded-2xl font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition active:scale-95 ${focusRing}`}
              >
                I already have a room
              </button>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section aria-labelledby="features-title" className="max-w-7xl mx-auto px-6 py-12 lg:py-20">
          <h2 id="features-title" className="text-3xl font-bold text-center mb-10 lg:mb-14">Why Incognito Chat</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {FEATURES.map((f) => (
              <FeatureCard key={f.title} icon={f.icon} title={f.title} description={f.description} />
            ))}
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-title" className="max-w-5xl mx-auto px-6 py-12 lg:py-20">
          <h2 id="how-title" className="text-3xl font-bold text-center mb-10 lg:mb-14">How it works</h2>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="relative bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm"
              >
                <span className="absolute -top-3 -left-3 w-9 h-9 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shadow-lg shadow-blue-600/30">
                  {i + 1}
                </span>
                <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-4 shadow-inner">
                  {s.icon}
                </div>
                <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{s.description}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* FAQ */}
        <section aria-labelledby="faq-title" className="max-w-3xl mx-auto px-6 py-12 lg:py-20">
          <h2 id="faq-title" className="text-3xl font-bold text-center mb-10 lg:mb-14">Frequently asked questions</h2>
          <div className="space-y-3">
            {FAQS.map((f) => (
              <details key={f.q} className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
                <summary className={`flex items-center justify-between gap-4 cursor-pointer list-none px-5 py-4 font-semibold text-slate-800 dark:text-slate-100 rounded-2xl [&::-webkit-details-marker]:hidden ${focusRing}`}>
                  <span>{f.q}</span>
                  <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-5 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Trust Section */}
        <section aria-labelledby="trust-title" className="max-w-4xl mx-auto px-6 py-12 lg:py-20 text-center">
          <div className="bg-blue-50 dark:bg-blue-900/10 rounded-3xl p-8 lg:p-12 border border-blue-100 dark:border-blue-900/30">
            <div className="inline-flex p-3 bg-blue-600 text-white rounded-2xl mb-6 shadow-lg shadow-blue-600/20">
              <Zap size={32} />
            </div>
            <h2 id="trust-title" className="text-3xl font-bold mb-4">Fast & Transient</h2>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-0">
              Rooms are created instantly — just share the name and PIN to start talking. When a member deletes the room, every message and shared file is wiped for everyone.
            </p>
          </div>
        </section>
      </main>

      <footer
        className="py-12 border-t border-slate-200 dark:border-slate-900 text-center text-slate-600 dark:text-slate-500 text-sm"
        style={{ paddingBottom: 'max(3rem, env(safe-area-inset-bottom))' }}
      >
        <p>© {new Date().getFullYear()} Incognito Chat. Private, anonymous, ephemeral.</p>
      </footer>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
  <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
    <div className="w-14 h-14 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-3">{title}</h3>
    <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{description}</p>
  </div>
);

export default LandingPage;
