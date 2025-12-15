
import React, { useEffect, useState } from 'react';
import { Download, Share, PlusSquare, X, MonitorDown } from 'lucide-react';

const InstallButton: React.FC = () => {
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // 1. Check if iOS
    const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIosDevice);

    // 2. Check if already installed (standalone mode)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    
    if (isStandalone) {
        setIsInstallable(false);
        return;
    }

    // 3. If iOS and NOT installed, show button (it will trigger instructions)
    if (isIosDevice) {
        setIsInstallable(true);
    }

    // 4. Check for Android/Desktop "beforeinstallprompt"
    // Check if event already fired before component mounted
    if (window.deferredPrompt) {
        setIsInstallable(true);
    }

    // Listen for the event if it happens later
    const handlePWAReady = () => {
        setIsInstallable(true);
    };

    window.addEventListener('pwa-ready', handlePWAReady);

    return () => {
      window.removeEventListener('pwa-ready', handlePWAReady);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
        // Show iOS specific instructions
        setShowIOSInstructions(true);
    } else {
        // Android / Desktop Flow
        const promptEvent = window.deferredPrompt;
        if (!promptEvent) return;

        promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        
        if (outcome === 'accepted') {
            setIsInstallable(false);
            window.deferredPrompt = null;
        }
    }
  };

  if (!isInstallable) return null;

  return (
    <>
        <button
            onClick={handleInstallClick}
            className="p-2 rounded-full text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-400 dark:hover:text-blue-400 dark:hover:bg-slate-800 transition-colors animate-in fade-in zoom-in duration-300"
            title="Install App"
            aria-label="Install App"
        >
            <MonitorDown size={20} />
        </button>

        {/* iOS Instructions Modal */}
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
                            <p className="text-sm text-slate-600 dark:text-slate-300">1. Tap the <strong>Share</strong> button in your browser menu.</p>
                        </div>
                        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 ml-5"></div>
                        <div className="flex items-center gap-4">
                            <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-lg text-slate-900 dark:text-white">
                                <PlusSquare size={24} />
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-300">2. Select <strong>Add to Home Screen</strong>.</p>
                        </div>
                    </div>

                    <div className="mt-6 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-800">
                        <p className="text-xs text-center text-blue-700 dark:text-blue-300 font-medium">
                            This adds the app icon to your home screen for quick access.
                        </p>
                    </div>
                </div>
            </div>
        )}
    </>
  );
};

export default InstallButton;
