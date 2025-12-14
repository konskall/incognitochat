
import React, { useRef, useEffect } from 'react';
import { Share2, Users, Settings, Vibrate, VibrateOff, Volume2, VolumeX, Bell, BellOff, Mail, Sun, Moon, Trash2, LogOut } from 'lucide-react';
import { ChatConfig, Presence } from '../types';
import { toast } from 'sonner';

interface ChatHeaderProps {
  config: ChatConfig;
  participants: Presence[];
  isRoomReady: boolean;
  showParticipantsList: boolean;
  setShowParticipantsList: (show: boolean) => void;
  showSettingsMenu: boolean;
  setShowSettingsMenu: (show: boolean) => void;
  canVibrate: boolean;
  vibrationEnabled: boolean;
  setVibrationEnabled: (enabled: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  notificationsEnabled: boolean;
  toggleNotifications: () => void;
  emailAlertsEnabled: boolean;
  setShowEmailModal: (show: boolean) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  setShowDeleteModal: (show: boolean) => void;
  onExit: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  config,
  participants,
  isRoomReady,
  showParticipantsList,
  setShowParticipantsList,
  showSettingsMenu,
  setShowSettingsMenu,
  canVibrate,
  vibrationEnabled,
  setVibrationEnabled,
  soundEnabled,
  setSoundEnabled,
  notificationsEnabled,
  toggleNotifications,
  emailAlertsEnabled,
  setShowEmailModal,
  isDarkMode,
  toggleTheme,
  setShowDeleteModal,
  onExit
}) => {
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  // Close settings menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (
            showSettingsMenu &&
            settingsMenuRef.current &&
            !settingsMenuRef.current.contains(event.target as Node) &&
            settingsButtonRef.current &&
            !settingsButtonRef.current.contains(event.target as Node)
        ) {
            setShowSettingsMenu(false);
        }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
        document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettingsMenu, setShowSettingsMenu]);

  const handleShare = async () => {
    const baseUrl = window.location.href.split('?')[0]; 
    const shareUrl = new URL(baseUrl);
    shareUrl.searchParams.set('room', config.roomName);
    shareUrl.searchParams.set('pin', config.pin);
    const inviteUrl = shareUrl.toString();

    const shareText = `🔒 Join my secure room on Incognito Chat!\n\n🏠 Room: ${config.roomName}\n🔑 PIN: ${config.pin}`;

    try {
        if (navigator.share) {
            await navigator.share({
                title: 'Incognito Chat Invite',
                text: shareText,
                url: inviteUrl
            });
        } else {
            await navigator.clipboard.writeText(`${shareText}\n\n${inviteUrl}`);
            toast.success('Room details copied to clipboard!');
        }
    } catch (err) {
        console.error('Error sharing:', err);
    }
  };

  return (
    <header className="glass-panel px-4 py-3 flex items-center justify-between z-10 sticky top-0 shadow-sm pt-[calc(0.75rem+env(safe-area-inset-top))]">
        {/* Room Info Section - Static Div */}
        <div className="flex items-center gap-3 overflow-hidden">
             <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg flex-shrink-0">
                {config.roomName.substring(0,2).toUpperCase()}
             </div>
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
                            {participants.length} Online
                        </span>
                     </div>
                     <span className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 truncate font-medium">
                        <span className="hidden sm:inline text-slate-300 dark:text-slate-600 mr-1">|</span>
                        <span className="sm:font-semibold sm:text-slate-700 dark:sm:text-slate-300">{config.username}</span>
                     </span>
                 </div>
             </div>
        </div>

        <div className="flex gap-1 sm:gap-2 flex-shrink-0 items-center relative">
            <button
                onClick={handleShare}
                className="p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                title="Share Room Invite"
            >
                <Share2 size={20} />
            </button>

            <button 
                onClick={() => setShowParticipantsList(true)}
                className={`p-2 rounded-lg transition ${showParticipantsList ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                title="View Participants & Call"
            >
                <Users size={20} />
            </button>

            <button
                ref={settingsButtonRef}
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="sm:hidden p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
            >
                <Settings size={20} />
            </button>

            {canVibrate && (
                <button 
                    onClick={() => setVibrationEnabled(!vibrationEnabled)}
                    className={`hidden sm:block p-2 rounded-lg transition ${vibrationEnabled ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-100 dark:hover:bg-slate-100'}`}
                    title={vibrationEnabled ? "Vibration Enabled" : "Enable Vibration"}
                >
                    {vibrationEnabled ? <Vibrate size={20} /> : <VibrateOff size={20} />}
                </button>
            )}
            <button 
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`hidden sm:block p-2 rounded-lg transition ${soundEnabled ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-100 dark:hover:bg-slate-100'}`}
                title={soundEnabled ? "Mute Sounds" : "Enable Sounds"}
            >
                {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button 
                onClick={toggleNotifications}
                className={`hidden sm:block p-2 rounded-lg transition ${notificationsEnabled ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-100 dark:hover:bg-slate-100'}`}
                title={notificationsEnabled ? "Notifications Active" : "Enable Notifications"}
            >
                {notificationsEnabled ? <Bell size={20} /> : <BellOff size={20} />}
            </button>
            
            <button 
                onClick={() => setShowEmailModal(true)}
                className={`hidden sm:block p-2 rounded-lg transition ${emailAlertsEnabled ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-100'}`}
                title="Email Alerts"
            >
                <Mail size={20} />
            </button>

            <button 
                onClick={toggleTheme}
                className="hidden sm:block p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
                title="Toggle Theme"
            >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            {showSettingsMenu && (
                <>
                    <div className="absolute top-full right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-100 dark:border-slate-700 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col p-1.5 sm:hidden" ref={settingsMenuRef}>
                        {canVibrate && (
                             <button 
                                onClick={() => { setVibrationEnabled(!vibrationEnabled); setShowSettingsMenu(false); }}
                                className={`flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium transition ${vibrationEnabled ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                            >
                                {vibrationEnabled ? <Vibrate size={18} /> : <VibrateOff size={18} />}
                                <span>Vibration</span>
                            </button>
                        )}
                        <button 
                            onClick={() => { setSoundEnabled(!soundEnabled); setShowSettingsMenu(false); }}
                            className={`flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium transition ${soundEnabled ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                        >
                            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                            <span>Sound</span>
                        </button>
                        <button 
                            onClick={toggleNotifications}
                            className={`flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium transition ${notificationsEnabled ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                        >
                            {notificationsEnabled ? <Bell size={18} /> : <BellOff size={18} />}
                            <span>Notifications</span>
                        </button>
                        <button 
                            onClick={toggleTheme}
                            className="flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition"
                        >
                            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
                            <span>Theme</span>
                        </button>

                        <div className="h-px bg-slate-100 dark:bg-slate-700/50 my-1" />

                        <div className="p-2">
                             <button 
                                onClick={() => { setShowEmailModal(true); setShowSettingsMenu(false); }}
                                className={`flex items-center gap-3 w-full rounded-lg text-sm font-medium transition ${emailAlertsEnabled ? 'text-blue-600 dark:text-blue-400 mb-2' : 'text-slate-600 dark:text-slate-300 hover:text-blue-500'}`}
                             >
                                <Mail size={18} />
                                <span>Email Alerts</span>
                                {emailAlertsEnabled && <span className="ml-auto text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">ON</span>}
                             </button>
                        </div>

                        <div className="h-px bg-slate-100 dark:bg-slate-700/50 my-1" />

                        <button 
                            onClick={() => { setShowDeleteModal(true); setShowSettingsMenu(false); }}
                            className="flex items-center gap-3 w-full p-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                        >
                            <Trash2 size={18} />
                            <span>Delete Chat</span>
                        </button>
                    </div>
                </>
            )}

            <button 
                onClick={() => setShowDeleteModal(true)}
                className="hidden sm:block p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                title="Delete Chat"
            >
                <Trash2 size={20} />
            </button>
            <button 
                onClick={onExit}
                className="p-2 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition"
                title="Exit"
            >
                <LogOut size={20} />
            </button>
        </div>
    </header>
  );
};

export default ChatHeader;
