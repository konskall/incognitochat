import React, { useRef, useEffect } from 'react';
import { Users, Settings, Vibrate, VibrateOff, Volume2, VolumeX, Bell, BellOff, Sun, Moon, LogOut, Timer, Hourglass } from 'lucide-react';
import { ChatConfig, Presence } from '../types';

interface ChatHeaderProps {
  config: ChatConfig;
  participants: Presence[];
  isRoomReady: boolean;
  showSettingsMenu: boolean;
  setShowSettingsMenu: (show: boolean) => void;
  canVibrate: boolean;
  vibrationEnabled: boolean;
  setVibrationEnabled: (enabled: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  notificationsEnabled: boolean;
  toggleNotifications: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  onExit: () => void;
  roomAvatarUrl?: string;
  messageTtlLabel?: string | null;
  roomFreeExpiryLabel?: string | null; // absolute auto-delete countdown (rooms.expires_at)
  // Tapping the room identity opens the consolidated Room Info hub.
  onOpenRoomInfo: () => void;
  // The members icon opens the participants/calls panel directly.
  onOpenParticipants: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  config,
  participants,
  isRoomReady,
  showSettingsMenu,
  setShowSettingsMenu,
  canVibrate,
  vibrationEnabled,
  setVibrationEnabled,
  soundEnabled,
  setSoundEnabled,
  notificationsEnabled,
  toggleNotifications,
  isDarkMode,
  toggleTheme,
  onExit,
  roomAvatarUrl,
  messageTtlLabel,
  roomFreeExpiryLabel,
  onOpenRoomInfo,
  onOpenParticipants,
}) => {
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showSettingsMenu) return;
    const handlePointerOutside = (event: Event) => {
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(event.target as Node) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(event.target as Node)
      ) {
        setShowSettingsMenu(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSettingsMenu(false);
        settingsButtonRef.current?.focus();
      }
    };
    // pointerdown covers touch + mouse (the old mousedown-only close was
    // unreliable on touch); keydown adds Escape-to-close with focus returned to
    // the trigger.
    document.addEventListener('pointerdown', handlePointerOutside);
    document.addEventListener('keydown', handleKey);
    // Move focus into the menu so keyboard users land on the first option.
    const t = window.setTimeout(() => settingsMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    return () => {
      document.removeEventListener('pointerdown', handlePointerOutside);
      document.removeEventListener('keydown', handleKey);
      clearTimeout(t);
    };
  }, [showSettingsMenu, setShowSettingsMenu]);

  // Close the menu AND return focus to the trigger, so keyboard users aren't
  // dropped onto <body> after toggling a preference.
  const closeMenu = () => {
    setShowSettingsMenu(false);
    settingsButtonRef.current?.focus();
  };

  const onlineCount = participants.filter((p) => p.status === 'active').length;

  return (
    <header className="glass-bar glass-bar-top px-4 py-3 flex items-center justify-between z-30 shadow-sm pt-[calc(0.75rem+env(safe-area-inset-top))]">
      {/* Room identity — only this block is tappable (opens the Room Info hub) */}
      <div className="flex items-center min-w-0 flex-1">
      <button
        onClick={onOpenRoomInfo}
        className="flex items-center gap-3 min-w-0 max-w-full text-left -m-1 p-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition active:scale-[0.99]"
        title="Room info"
      >
        {roomAvatarUrl ? (
          <img src={roomAvatarUrl} alt={config.roomName} className="w-10 h-10 rounded-full object-cover shadow-lg flex-shrink-0 bg-slate-200 dark:bg-slate-700 border border-white/40 dark:border-slate-700" />
        ) : (
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg flex-shrink-0">
            {config.roomName.substring(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex flex-col justify-center">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 leading-tight truncate text-sm md:text-base flex items-center gap-1.5">
            {config.roomName}
          </h2>
          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isRoomReady ? 'bg-green-400' : 'bg-yellow-400'} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isRoomReady ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap">
                {onlineCount} Online
              </span>
            </div>
            <span className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 truncate font-medium">
              <span className="hidden sm:inline text-slate-300 dark:text-slate-600 mr-1">|</span>
              <span className="sm:font-semibold sm:text-slate-700 dark:sm:text-slate-300">{config.username}</span>
            </span>
            {messageTtlLabel && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded-full" title={`Messages disappear after ${messageTtlLabel}`}>
                <Timer size={11} /> {messageTtlLabel}
              </span>
            )}
            {roomFreeExpiryLabel && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full" title={`This room auto-deletes — ${roomFreeExpiryLabel} left`}>
                <Hourglass size={11} /> {roomFreeExpiryLabel}
              </span>
            )}
          </div>
        </div>
      </button>
      </div>

      <div className="flex gap-1 sm:gap-2 flex-shrink-0 items-center relative ml-2">
        {/* Members icon opens the participants & calls panel directly */}
        <button
          onClick={onOpenParticipants}
          className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
          title="Participants & calls"
        >
          <Users size={20} />
        </button>

        <button
          ref={settingsButtonRef}
          onClick={() => setShowSettingsMenu(!showSettingsMenu)}
          className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
          title="Settings"
          aria-label="Settings"
          aria-haspopup="true"
          aria-expanded={showSettingsMenu}
        >
          <Settings size={20} />
        </button>

        <button
          onClick={onExit}
          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
          title="Exit Room"
        >
          <LogOut size={20} />
        </button>

        {showSettingsMenu && (
          <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-100 dark:border-slate-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col p-1.5" ref={settingsMenuRef} role="menu" aria-label="Preferences">
            <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Preferences</p>
            {canVibrate && (
              <button
                role="menuitemcheckbox"
                aria-checked={vibrationEnabled}
                onClick={() => { setVibrationEnabled(!vibrationEnabled); closeMenu(); }}
                className={`flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium transition ${vibrationEnabled ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
              >
                {vibrationEnabled ? <Vibrate size={18} /> : <VibrateOff size={18} />}
                <span>Vibration</span>
              </button>
            )}
            <button
              role="menuitemcheckbox"
              aria-checked={soundEnabled}
              onClick={() => { setSoundEnabled(!soundEnabled); closeMenu(); }}
              className={`flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium transition ${soundEnabled ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
              <span>Sound</span>
            </button>
            <button
              role="menuitemcheckbox"
              aria-checked={notificationsEnabled}
              onClick={() => { toggleNotifications(); closeMenu(); }}
              className={`flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium transition ${notificationsEnabled ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
            >
              {notificationsEnabled ? <Bell size={18} /> : <BellOff size={18} />}
              <span>Notifications</span>
            </button>
            <button
              role="menuitemcheckbox"
              aria-checked={isDarkMode}
              onClick={() => { toggleTheme(); closeMenu(); }}
              className="flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition"
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
              <span>Theme</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default React.memo(ChatHeader);
