
import React, { useEffect, useState } from 'react';
import { Share, PlusSquare, X, MonitorDown, Trash2, Smartphone, Monitor } from 'lucide-react';

type AppState = 'hidden' | 'installable' | 'installed';

const InstallButton: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('hidden');
  const [isIOS, setIsIOS] = useState(false);
  
  // Modals
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [showUninstallInstructions, setShowUninstallInstructions] = useState(false);

  useEffect(() => {
    const checkState = () => {
        // 1. Check if iOS
        const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
        setIsIOS(isIosDevice);

        // 2. Check if already installed (Running in standalone mode)
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
        
        if (isStandalone) {
            setAppState('installed');
            return;
        }

        // 3. If iOS and NOT installed
        if (isIosDevice) {
            setAppState('installable');
            return;
        }

        // 4. Check for Android/Desktop "beforeinstallprompt"
        if (window.deferredPrompt) {
            setAppState('installable');
        }
    };

    checkState();

    // Listen for the event if it happens later (Android/Desktop)
    const handlePWAReady = () => {
        // Only set to installable if we aren't already running in standalone
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
        if (!isStandalone) {
            setAppState('installable');
        }
    };

    window.addEventListener('pwa-ready', handlePWAReady);
    return () => window.removeEventListener('pwa-ready', handlePWAReady);
  }, []);

  const handleClick = async () => {
    if (appState === 'installed') {
        setShowUninstallInstructions(true);
        return;
    }

    // Install Flow
    if (isIOS) {
        setShowIOSInstructions(true);
    } else {
        const promptEvent = window.deferredPrompt;
        if (!promptEvent) return;

        promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        
        if (outcome === 'accepted') {
            setAppState('installed'); // Assume success leads to installation
            window.deferredPrompt = null;
        }
    }
  };

  if (appState === 'hidden') return null;

  return (
    <>
        <button
            onClick={handleClick}
            className={`p-2 rounded-full transition-all duration-300 animate-in fade-in zoom-in 
                ${appState === 'installed' 
                    ? 'text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20' 
                    : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800'
                }`}
            title={appState === 'installed' ? "Uninstall App" : "Install App"}
            aria-label={appState === 'installed' ? "Uninstall App" : "Install App"}
        >
            {appState === 'installed' ? <Trash2 size={20} /> : <MonitorDown size={20} />}
        </button>

        {/* iOS Install Instructions Modal */}
        {showIOSInstructions && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowIOSInstructions(false)}>
                <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative animate-in slide-in-from-bottom-10 duration-300 border border-white/10 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                    <button 
                        onClick={() => setShowIOSInstructions(false)}
                        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                        <X size={20} />
                    </button>
                    
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Install on iPhone</h3>
                    
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-lg text-blue-600">
                                <Share size={24} />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-300">1. Tap the <strong>Share</strong> button.</p>
                        </div>
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 ml-5"></div>
                        <div className="flex items-center gap-4">
                            <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-lg text-slate-900 dark:text-white">
                                <PlusSquare size={24} />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-300">2. Select <strong>Add to Home Screen</strong>.</p>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Uninstall Instructions Modal */}
        {showUninstallInstructions && (
            <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowUninstallInstructions(false)}>
                <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative animate-in slide-in-from-bottom-10 duration-300 border border-white/10 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                    <button 
                        onClick={() => setShowUninstallInstructions(false)}
                        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                        <X size={20} />
                    </button>
                    
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                        <Trash2 size={20} className="text-red-500" /> 
                        Uninstall App
                    </h3>
                    
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                        To remove this app, you must use your device's system menu.
                    </p>

                    <div className="space-y-4">
                        <div className="flex items-start gap-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                            <div className="bg-slate-200 dark:bg-slate-700 p-2 rounded-lg text-slate-700 dark:text-slate-200 shrink-0">
                                <Smartphone size={20} />
                            </div>
                            <div>
                                <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Mobile</span>
                                <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                                    Long-press the app icon on your home screen and tap <strong>Remove App</strong>.
                                </p>
                            </div>
                        </div>
                        
                        <div className="flex items-start gap-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                            <div className="bg-slate-200 dark:bg-slate-700 p-2 rounded-lg text-slate-700 dark:text-slate-200 shrink-0">
                                <Monitor size={20} />
                            </div>
                            <div>
                                <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Desktop</span>
                                <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                                    Click the three dots (⋮) in the window title bar and select <strong>Uninstall Incognito Chat</strong>.
                                </p>
                            </div>
                        </div>
                    </div>

                    <button 
                        onClick={() => setShowUninstallInstructions(false)}
                        className="w-full mt-6 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl transition-colors"
                    >
                        Got it
                    </button>
                </div>
            </div>
        )}
    </>
  );
};

export default InstallButton;
