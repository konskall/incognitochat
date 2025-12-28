
import React from 'react';
import { Shield, Lock, Zap, Smartphone, ArrowRight, Video } from 'lucide-react';

interface LandingPageProps {
  onStart: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onStart }) => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white transition-colors duration-300 selection:bg-blue-500 selection:text-white">
      {/* Hero Section */}
      <div className="relative overflow-hidden pt-16 pb-12 lg:pt-32 lg:pb-24">
        {/* Background Blobs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-96 bg-blue-500/10 dark:bg-blue-600/5 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
          <div className="flex justify-center mb-8 animate-in fade-in zoom-in duration-700">
            <div className="relative">
              <div className="absolute -inset-4 bg-blue-500/20 rounded-full blur-xl animate-pulse"></div>
              <img 
                src="https://konskall.github.io/incognitochat/favicon-96x96.png" 
                alt="Logo" 
                className="relative w-24 h-24 rounded-3xl shadow-2xl border-4 border-white dark:border-slate-800"
              />
            </div>
          </div>

          <h1 className="text-5xl lg:text-7xl font-black tracking-tight mb-6 bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent animate-in slide-in-from-bottom-4 duration-700">
            Speak Free.<br />Stay Invisible.
          </h1>
          
          <p className="max-w-2xl mx-auto text-lg lg:text-xl text-slate-600 dark:text-slate-400 leading-relaxed mb-10 animate-in slide-in-from-bottom-6 duration-700 delay-100">
            Incognito Chat is a modern, privacy-first messaging platform. No logs, no tracking, just encrypted conversations in private rooms.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in slide-in-from-bottom-8 duration-700 delay-200">
            <button 
              onClick={onStart}
              className="group relative px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/30 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              Start Chatting Now
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div className="max-w-7xl mx-auto px-6 py-12 lg:py-24">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <FeatureCard 
            icon={<Lock className="text-blue-500" />}
            title="AES-256 E2EE"
            description="Messages are encrypted on your device using your room PIN. Even we can't read them."
          />
          <FeatureCard 
            icon={<Shield className="text-purple-500" />}
            title="Total Anonymity"
            description="No phone numbers or personal data required. Just a username and a secret room."
          />
          <FeatureCard 
            icon={<Video className="text-green-500" />}
            title="HD WebRTC Calls"
            description="High-quality audio and video calls directly between users, fully peer-to-peer."
          />
          <FeatureCard 
            icon={<Smartphone className="text-orange-500" />}
            title="PWA Ready"
            description="Install it on your phone just like a native app. Works offline and receives alerts."
          />
        </div>
      </div>

      {/* Trust Section */}
      <div className="max-w-4xl mx-auto px-6 py-12 lg:py-24 text-center">
        <div className="bg-blue-50 dark:bg-blue-900/10 rounded-3xl p-8 lg:p-12 border border-blue-100 dark:border-blue-900/30">
          <div className="inline-flex p-3 bg-blue-600 text-white rounded-2xl mb-6 shadow-lg shadow-blue-600/20">
            <Zap size={32} />
          </div>
          <h2 className="text-3xl font-bold mb-4">Fast & Transient</h2>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed mb-0">
            Rooms are created instantly. Share the Room Name and PIN with your friends and start talking. Once the host deletes the room, all data vanishes forever.
          </p>
        </div>
      </div>

      <footer className="py-12 border-t border-slate-200 dark:border-slate-900 text-center text-slate-500 text-sm">
        <p>© 2025 Incognito Chat. Secure, Private, Anonymous.</p>
      </footer>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) => (
  <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
    <div className="w-14 h-14 bg-slate-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-6 shadow-inner">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-3">{title}</h3>
    <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{description}</p>
  </div>
);

export default LandingPage;
