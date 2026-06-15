import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, Lock, Loader2 } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import { usePrices, formatPrice } from '../hooks/usePrices';
import { Tier } from '../utils/entitlements';
import { startCheckout } from '../services/supabase';
import { flashToast } from './MessageActionMenu';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  requiredTier: 'basic' | 'ultra';
  currentTier: Tier;
  featureLabel: string; // e.g. "Video calls", "Inco AI", "Room appearance"
  reason?: string;      // optional extra sentence
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const UpgradeModal: React.FC<UpgradeModalProps> = ({ open, onClose, requiredTier, featureLabel, reason }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  useModalA11y(open, onClose, dialogRef);
  // Lock background scroll while the modal is open (prevents iOS rubber-band
  // scroll-through behind the overlay). Scoped to this modal.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  const { prices } = usePrices();
  const plan = requiredTier === 'ultra' ? prices?.ultra ?? null : prices?.basic ?? null;
  // " for €X/month" reads correctly for both singular and plural feature labels
  // ("Video calls — available on Ultra for €10/month."), and degrades gracefully
  // to just "available on Ultra." while prices are still loading.
  const priceSuffix = plan ? ` for ${formatPrice(plan)}/${plan.interval}` : '';
  if (!open) return null;

  const tierName = cap(requiredTier);
  const isUltra = requiredTier === 'ultra';

  const handleUpgrade = async () => {
    if (busy) return;
    setBusy(true);
    const res = await startCheckout(requiredTier);
    if (!res.ok) {
      setBusy(false);
      if (res.error === 'LOGIN_REQUIRED') flashToast('Please sign in with Google to upgrade.');
      else flashToast('Could not start checkout. Please try again.');
    }
    // On success the browser navigates to Stripe; keep busy=true.
  };

  return createPortal(
    <div className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Upgrade to ${tierName}`}
        className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className={`flex items-center justify-center w-11 h-11 rounded-full shrink-0 ${isUltra ? 'bg-purple-500/10 text-purple-500' : 'bg-blue-500/10 text-blue-500'}`}>
              {isUltra ? <Sparkles size={22} /> : <Lock size={22} />}
            </span>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Upgrade to {tierName}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 -mr-1 -mt-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400 mb-6">
          {featureLabel} — available on {tierName}{priceSuffix}.{reason ? ` ${reason}` : ''}
        </p>
        <button
          onClick={handleUpgrade}
          disabled={busy}
          className={`w-full py-2.5 rounded-xl text-sm font-bold text-white transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 ${isUltra ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {busy ? 'Redirecting…' : `Upgrade to ${tierName}`}
        </button>
        <button onClick={onClose} className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
          Maybe later
        </button>
      </div>
    </div>,
    document.body
  );
};

export default UpgradeModal;
