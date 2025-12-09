import React, { useState, useEffect, useRef } from 'react';
import { ChatConfig } from '../types';
import { generateRoomKey, initAudio } from '../utils/helpers';
import { Info, ChevronDown, ChevronUp, Eye, EyeOff, Moon, Sun, History, X, Trash2 } from 'lucide-react';
import { supabase } from '../services/supabase';

interface LoginScreenProps {
  onJoin: (config: ChatConfig) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onJoin }) => {
  const [username, setUsername] = useState(localStorage.getItem('chatUsername') || '');
  const [avatar, setAvatar] = useState(localStorage.getItem('chatAvatarURL') || '');
  const [roomName, setRoomName] = useState(localStorage.getItem('chatRoomName') || '');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Room History State
  const [roomHistory, setRoomHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  
  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  // Advanced Avatar State
  const [avatarStyle, setAvatarStyle] = useState('bottts');
  const [avatarSeed, setAvatarSeed] = useState(Math.random().toString(36).substring(7));
  const [useCustomUrl, setUseCustomUrl] = useState(!!localStorage.getItem('chatAvatarURL') && !localStorage.getItem('chatAvatarURL')?.includes('dicebear'));

  const AVATAR_STYLES = [
      { id: 'bottts', label: 'Robots' },
      { id: 'avataaars', label: 'People' },
      { id: 'micah', label: 'Minimal' },
      { id: 'adventurer', label: 'Fun' },
      { id: 'fun-emoji', label: 'Emoji' }
  ];

  useEffect(() => {
    let metaThemeColor = document.querySelector("meta[name='theme-color']");
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }

    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      metaThemeColor.setAttribute("content", "#020617");
    } else {
      document.documentElement.classList.remove('dark');
      metaThemeColor.setAttribute("content", "#f8fafc");
    }
  }, [isDarkMode]);

  useEffect(() => {
      try {
          const history = JSON.parse(localStorage.getItem('chatRoomHistory') || '[]');
          if (Array.isArray(history)) {
              setRoomHistory(history);
          }
      } catch (e) {
          console.error("Failed to load room history", e);
      }

      const handleClickOutside = (event: MouseEvent) => {
          if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
              setShowHistory(false);
          }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
  };

  const getDiceBearUrl = (style: string, seed: string) => {
      return `https://api.dicebear.com/9.x/${style}/svg?seed=${seed}`;
  };

  const regenerateAvatar = (e: React.MouseEvent) => {
      e.preventDefault();
      setAvatarSeed(Math.random().toString(36).substring(7));
  };

  const toggleCustomUrl = () => {
      const willBeCustom = !useCustomUrl;
      setUseCustomUrl(willBeCustom);
      
      if (willBeCustom && avatar.includes('dicebear')) {
          setAvatar('');
      }
  };

  const handleRoomSelect = (selectedRoom: string) => {
      setRoomName(selectedRoom);
      setShowHistory(false);
  };

  const deleteFromHistory = (e: React.MouseEvent, roomToDelete: string) => {
      e.stopPropagation();
      const newHistory = roomHistory.filter(r => r !== roomToDelete);
      setRoomHistory(newHistory);
      localStorage.setItem('chatRoomHistory', JSON.stringify(newHistory));
  };

  const clearHistory = () => {
      if (window.confirm('Clear all visited rooms from history?')) {
          setRoomHistory([]);
          localStorage.removeItem('chatRoomHistory');
          setShowHistory(false);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (username.length < 2) {
      alert("Username must have at least 2 characters.");
      return;
    }
    if (!pin.match(/^[\w\d]{4,}$/)) {
      alert("PIN must be at least 4 characters (letters/numbers).");
      return;
    }
    if (!roomName.match(/^[\w\d]{3,}$/)) {
      alert("Room name must be at least 3 Latin characters.");
      return;
    }

    setLoading(true);
    initAudio();

    // Authenticate with Supabase anonymously
    const { error } = await supabase.auth.signInAnonymously();

    if (error) {
        console.error("Login failed:", error);
        alert("Could not connect to server. Please try again.");
        setLoading(false);
        return;
    }

    const roomKey = generateRoomKey(pin, roomName);
    const finalAvatar = useCustomUrl ? avatar : getDiceBearUrl(avatarStyle, avatarSeed);

    // Save to local storage
    localStorage.setItem('chatUsername', username);
    localStorage.setItem('chatAvatarURL', finalAvatar);
    localStorage.setItem('chatRoomName', roomName);
    localStorage.setItem('chatPin', pin); 

    const newHistory = [roomName, ...roomHistory.filter(r => r !== roomName)].slice(0, 10);
    setRoomHistory(newHistory);
    localStorage.setItem('chatRoomHistory', JSON.stringify(newHistory));

    setLoading(false);
    onJoin({
      username,
      avatarURL: finalAvatar,
      roomName,
      pin,
      roomKey
    });
  };

  return (
    <div className="flex flex-col items-center justify-start min-h-[100dvh] p-4 pt-2 md:pt-6 w-full max-w-md mx-auto animate-in slide-in-from-bottom-4 duration-500 relative">
      <main className="relative bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-3xl shadow-2xl shadow-blue-500/10 dark:shadow-blue-900/10 w-full p-8 border border-white/50 dark:border-slate-800 transition-colors">
        <button 
            onClick={toggleTheme}
            className="absolute top-6 right-6 p-2 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors z-10"
            title="Toggle Theme"
        >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        <div className="flex flex-col items-center mb-6">
           <img 
            src="https://konskall.github.io/incognitochat/favicon-96x96.png" 
            alt="Logo"
            style={{ width: '64px', height: '64px' }}
            className="w-16 h-16 rounded-2xl shadow-lg mb-4"
          />
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Incognito Chat</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Secure, anonymous, real-time.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 ml-1 mb-1 block uppercase">Identity</label>
            <input
              type="text"
              placeholder="Username"
              aria-label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={20}
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all text-base"
            />
          </div>
          
          <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
             <div className="flex justify-between items-center mb-2">
                 <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">Avatar</label>
                 <button 
                    type="button" 
                    onClick={toggleCustomUrl}
                    className="text-xs text-blue-500 dark:text-blue-400 font-semibold hover:underline"
                 >
                     {useCustomUrl ? 'Use Generator' : 'Use Custom URL'}
                 </button>
             </div>

             {useCustomUrl ? (
                <input
                    type="text"
                    placeholder="Image URL (http://...)"
                    aria-label="Custom Avatar URL"
                    value={avatar}
                    onChange={(e) => setAvatar(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:border-blue-500 outline-none text-base"
                />
             ) : (
                <div className="flex items-center gap-3">
                    <img 
                        src={getDiceBearUrl(avatarStyle, avatarSeed)} 
                        alt="Avatar Preview" 
                        style={{ width: '64px', height: '64px' }}
                        className="w-16 h-16 rounded-full bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600"
                    />
                    <div className="flex-1 flex flex-col gap-2">
                        <select 
                            value={avatarStyle}
                            onChange={(e) => setAvatarStyle(e.target.value)}
                            aria-label="Avatar Style"
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm outline-none text-base"
                        >
                            {AVATAR_STYLES.map(style => (
                                <option key={style.id} value={style.id}>{style.label}</option>
                            ))}
                        </select>
                        <button 
                            type="button"
                            onClick={regenerateAvatar}
                            className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 py-1.5 rounded-lg font-semibold hover:bg-blue-200 dark:hover:bg-blue-900/50 transition"
                        >
                            🔀 Shuffle Look
                        </button>
                    </div>
                </div>
             )}
          </div>

          <div className="h-px bg-slate-200 dark:bg-slate-700 my-2"></div>

          <div>
             <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 ml-1 mb-1 block uppercase">Destination</label>
             
             <div className="relative" ref={historyRef}>
                <input
                    type="text"
                    placeholder="Room Name (e.g. secretbase)"
                    aria-label="Room Name"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    onFocus={() => setShowHistory(true)}
                    maxLength={30}
                    className="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all mb-4 text-base"
                />
                
                {showHistory && roomHistory.length > 0 && (
                    <div className="absolute top-[calc(100%-12px)] left-0 right-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-b-xl shadow-xl z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                         <div className="max-h-40 overflow-y-auto">
                             {roomHistory.map((room) => (
                                 <div 
                                    key={room}
                                    onClick={() => handleRoomSelect(room)}
                                    className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer group transition-colors"
                                 >
                                     <div className="flex items-center gap-3">
                                         <History size={14} className="text-slate-400" />
                                         <span className="text-sm text-slate-700 dark:text-slate-200 font-medium">{room}</span>
                                     </div>
                                     <button 
                                        onClick={(e) => deleteFromHistory(e, room)}
                                        className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-all opacity-0 group-hover:opacity-100"
                                        title="Remove from history"
                                     >
                                         <X size={14} />
                                     </button>
                                 </div>
                             ))}
                         </div>
                         <div className="border-t border-slate-100 dark:border-slate-700/50 p-1 bg-slate-50/50 dark:bg-slate-900/50">
                            <button 
                                onClick={clearHistory}
                                className="w-full py-1.5 text-xs text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 flex items-center justify-center gap-1 transition-colors"
                            >
                                <Trash2 size={12} />
                                Clear History
                            </button>
                         </div>
                    </div>
                )}
             </div>
            
            <div className="relative">
                <input
                  type={showPin ? "text" : "password"}
                  placeholder="Room PIN"
                  aria-label="Room PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  maxLength={12}
                  className="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all text-base pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                  aria-label={showPin ? "Hide PIN" : "Show PIN"}
                >
                  {showPin ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transform transition active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Enter Room'}
          </button>
        </form>

        <div className="mt-6 border border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl overflow-hidden">
            <button 
                type="button"
                onClick={() => setShowGuide(!showGuide)}
                className="w-full flex items-center justify-between p-3 text-blue-600 dark:text-blue-400 font-semibold text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 transition"
            >
                <div className="flex items-center gap-2">
                    <Info size={16} />
                    <span>Quick Start Guide</span>
                </div>
                {showGuide ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            
            {showGuide && (
                <div className="p-4 bg-white/50 dark:bg-slate-900/50 text-sm text-slate-600 dark:text-slate-300 space-y-2 border-t border-blue-100 dark:border-blue-900/30 animate-in slide-in-from-top-2">
                    <p className="flex gap-2"><span className="text-blue-500">👤</span> <strong>Username:</strong> Your display name.</p>
                    <p className="flex gap-2"><span className="text-blue-500">🔐</span> <strong>PIN:</strong> 4+ chars key.</p>
                    <p className="flex gap-2"><span className="text-blue-500">🏠</span> <strong>Room:</strong> 3+ Latin chars.</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 italic">Share the Room Name and invite others.</p>
                </div>
            )}
        </div>
      </main>
      
      <footer className="mt-8 text-center text-slate-400 dark:text-slate-500 text-xs pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        <p>
                   Incognito Chat © 2025 • Powered by{' '}
          <a 
            href="http://linkedin.com/in/konstantinos-kalliakoudis-902b90103" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-600 font-semibold hover:underline transition-colors"
          >
            KonsKall
          </a>
        </p>
      </footer>
    </div>
  );
};

export default LoginScreen;
