import React, { useState, useRef } from 'react';
import { X, Trash2, Check, Loader2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import { useModalA11y } from '../hooks/useModalA11y';

export const ROOM_EXPIRY_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: 'Off', seconds: null },
  { label: '1 day', seconds: 86400 },
  { label: '3 days', seconds: 259200 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
];

interface RoomExpiryModalProps {
  show: boolean;
  onClose: () => void;
  roomKey: string;
  currentSeconds: number | null;
  onUpdate: (seconds: number | null) => void;
}

// "Auto-delete room": the room (and everything in it) is removed for everyone
// after the chosen period of inactivity. Same style as disappearing messages.
const RoomExpiryModal: React.FC<RoomExpiryModalProps> = ({ show, onClose, roomKey, currentSeconds, onUpdate }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);
  const [saving, setSaving] = useState<number | null | undefined>(undefined);

  if (!show) return null;

  const choose = async (seconds: number | null) => {
    if (seconds === currentSeconds) { onClose(); return; }
    setSaving(seconds);
    try {
      const { error } = await supabase.from('rooms').update({ auto_delete_seconds: seconds }).eq('room_key', roomKey);
      if (error) throw error;
      onUpdate(seconds);
      onClose();
    } catch (e) {
      console.error(e);
      alert('Failed to update auto-delete');
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Auto-delete room" className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Trash2 size={22} className="text-red-500" /> Auto-delete Room
          </h3>
          <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">When on, the whole room — every message and shared file — is permanently deleted for everyone after this period of inactivity.</p>

        <div className="flex flex-col gap-1.5">
          {ROOM_EXPIRY_OPTIONS.map((opt) => {
            const selected = (opt.seconds ?? null) === (currentSeconds ?? null);
            return (
              <button
                key={opt.label}
                onClick={() => choose(opt.seconds)}
                className={`flex items-center justify-between w-full px-4 py-3 rounded-xl text-sm font-semibold transition ${selected ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 ring-1 ring-red-300 dark:ring-red-800' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
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

export default RoomExpiryModal;
