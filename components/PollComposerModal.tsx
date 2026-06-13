import React, { useState, useRef, useEffect } from 'react';
import { X, BarChart3, Plus, Trash2, Check, Loader2 } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';

interface PollComposerModalProps {
  show: boolean;
  onClose: () => void;
  onCreate: (question: string, options: string[], multi: boolean) => Promise<void>;
}

const MAX_OPTIONS = 6;

const PollComposerModal: React.FC<PollComposerModalProps> = ({ show, onClose, onCreate }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard async-after-close (see EphemeralModal): if the modal is dismissed
  // while onCreate is in flight, don't close()/setState afterwards.
  const openRef = useRef(show);
  useEffect(() => { openRef.current = show; }, [show]);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  if (!show) return null;

  const reset = () => {
    setQuestion('');
    setOptions(['', '']);
    setMulti(false);
    setError(null);
  };

  const close = () => { reset(); onClose(); };

  const setOption = (i: number, val: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? val : o)));

  const addOption = () => setOptions((prev) => (prev.length < MAX_OPTIONS ? [...prev, ''] : prev));
  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  const valid = question.trim().length > 0 && options.filter((o) => o.trim()).length >= 2;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(question, options, multi);
      if (!mountedRef.current || !openRef.current) return;
      close();
    } catch (e: any) {
      console.error(e);
      if (mountedRef.current && openRef.current) setError(e?.message || 'Failed to create poll');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Create poll" className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <BarChart3 size={22} className="text-blue-500" /> Create Poll
          </h3>
          <button onClick={close} aria-label="Close" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Question</label>
        <input
          autoFocus
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={200}
          placeholder="Ask something…"
          className="w-full mb-4 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Options</label>
        <div className="flex flex-col gap-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                maxLength={100}
                placeholder={`Option ${i + 1}`}
                className="flex-1 bg-slate-100 dark:bg-slate-800 border-0 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
              />
              {options.length > 2 && (
                <button onClick={() => removeOption(i)} aria-label="Remove option" className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        {options.length < MAX_OPTIONS && (
          <button onClick={addOption} className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
            <Plus size={16} /> Add option
          </button>
        )}

        <label className="flex items-center gap-3 mt-5 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={multi}
            onClick={() => setMulti((m) => !m)}
            className={`relative w-10 h-6 rounded-full transition-colors ${multi ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${multi ? 'translate-x-4' : ''}`} />
          </button>
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Allow multiple answers</span>
        </label>

        {error && <p className="mt-4 text-xs text-red-500 font-medium">{error}</p>}

        <div className="flex gap-2 mt-6">
          <button onClick={close} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
};

export default PollComposerModal;
