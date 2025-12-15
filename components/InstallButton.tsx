import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

const InstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if device is iOS (since iOS doesn't support beforeinstallprompt)
    const isIosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIosDevice);

    const handler = (e: any) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      setDeferredPrompt(null);
    }
  };

  // Do not render anything if the prompt isn't ready (or app is already installed)
  if (!deferredPrompt) return null;

  return (
    <button
      onClick={handleInstallClick}
      className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-slate-800 text-white dark:bg-white dark:text-slate-900 font-bold rounded-xl shadow-lg hover:bg-slate-700 dark:hover:bg-slate-100 transition-all transform active:scale-95 mb-4 animate-in fade-in slide-in-from-bottom-2"
    >
      <Download size={20} />
      <span>Install App</span>
    </button>
  );
};

export default InstallButton;