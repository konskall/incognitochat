import React, { useState, useRef } from 'react';
import { X, Timer, Check, Loader2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useModalA11y } from '../hooks/useModalA11y';

export const TTL_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: 'Off', seconds: null },
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
];

// Short label for the header badge ("1h", "24h", "7d").
export function formatTtl(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  return `${Math.round(seconds / 60)}m`;
}

interface EphemeralModalProps {
  show: boolean;
  onClose: () => void;
  roomKey: string;
  currentTtl: number | null;
  onUpdate: (ttl: number | null) => void;
}

const EphemeralModal: React.FC<EphemeralModalProps> = ({ show, onClose, roomKey, currentTtl, onUpdate }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);
  const [saving, setSaving] = useState<number | null | undefined>(undefined);

  if (!show) return null;

  const choose = async (seconds: number | null) => {
    if (seconds === currentTtl) { onClose(); return; }
    setSaving(seconds);
    try {
      const { error } = await supabase.from('rooms').update({ message_ttl_seconds: seconds }).eq('room_key', roomKey);
      if (error) throw error;
      onUpdate(seconds);
      onClose();
    } catch (e) {
      console.error(e);
      alert('Failed to update disappearing messages');
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Disappearing messages" className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Timer size={22} className="text-orange-500" /> Disappearing Messages
          </h3>
          <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">When on, messages in this room are automatically deleted for everyone after the chosen time.</p>

        <div className="flex flex-col gap-1.5">
          {TTL_OPTIONS.map((opt) => {
            const selected = (opt.seconds ?? null) === (currentTtl ?? null);
            return (
              <button
                key={opt.label}
                onClick={() => choose(opt.seconds)}
                className={`flex items-center justify-between w-full px-4 py-3 rounded-xl text-sm font-semibold transition ${selected ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 ring-1 ring-orange-300 dark:ring-orange-800' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                <span>{opt.label}</span>
                {saving === opt.seconds ? <Loader2 size={16} className="animate-spin" /> : selected && <Check size={16} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default EphemeralModal;
