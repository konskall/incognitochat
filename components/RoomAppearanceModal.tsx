import React, { useState, useRef, useEffect } from 'react';
import { X, Upload, Link as LinkIcon, RotateCcw, Save, Loader2, Image as ImageIcon, Check, Palette } from 'lucide-react';
import { supabase } from '../services/supabase';
import { compressImage } from '../utils/helpers';
import { ROOM_BG_PRESETS } from '../utils/roomBackgrounds';
import { useModalA11y } from '../hooks/useModalA11y';

interface RoomAppearanceModalProps {
  show: boolean;
  onClose: () => void;
  roomKey: string;
  roomName: string;
  isDarkMode: boolean;
  current: { avatarUrl: string; bgType: string; bgPreset: string; bgUrl: string };
  onUpdate: (next: { avatarUrl: string; bgType: string; bgPreset: string; bgUrl: string }) => void;
}

const RoomAppearanceModal: React.FC<RoomAppearanceModalProps> = ({ show, onClose, roomKey, roomName, isDarkMode, current, onUpdate }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);

  const [avatarUrl, setAvatarUrl] = useState(current.avatarUrl);
  const [bgType, setBgType] = useState(current.bgType || 'preset');
  const [bgPreset, setBgPreset] = useState(current.bgPreset || 'dots');
  const [bgUrl, setBgUrl] = useState(current.bgUrl);
  const [showLink, setShowLink] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [uploading, setUploading] = useState<null | 'avatar' | 'bg'>(null);

  // Re-sync the editor from the room's current appearance every time it opens.
  // The modal stays mounted (just renders null when closed), so without this the
  // internal state would keep its first-mount value (usually empty, before the
  // room loaded) and a later save would wipe the existing icon/wallpaper.
  // Depends only on `show` so it snapshots on open and never clobbers in-progress edits.
  useEffect(() => {
    if (show) {
      setAvatarUrl(current.avatarUrl);
      setBgType(current.bgType || 'preset');
      setBgPreset(current.bgPreset || 'dots');
      setBgUrl(current.bgUrl);
      setShowLink(false);
      setLinkValue('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  const upload = async (file: File, kind: 'avatar' | 'bg') => {
    setUploading(kind);
    try {
      const compressed = await compressImage(file);
      const fileName = `room_${kind}_${Date.now()}.${compressed.name.split('.').pop()}`;
      const filePath = `${roomKey}/${fileName}`;
      const { error } = await supabase.storage.from('attachments').upload(filePath, compressed);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(filePath);
      if (kind === 'avatar') setAvatarUrl(publicUrl);
      else { setBgUrl(publicUrl); setBgType('image'); }
    } catch (e) {
      console.error(e);
      alert('Failed to upload image');
    } finally {
      setUploading(null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('rooms')
        .update({
          avatar_url: avatarUrl || null,
          background_type: bgType,
          background_preset: bgType === 'preset' ? bgPreset : null,
          background_url: bgType === 'image' ? bgUrl : null,
        })
        .eq('room_key', roomKey);
      if (error) throw error;
      onUpdate({ avatarUrl, bgType, bgPreset, bgUrl });
      onClose();
    } catch (e) {
      console.error(e);
      alert('Failed to save room appearance');
    } finally {
      setIsSaving(false);
    }
  };

  const initials = roomName.substring(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Room appearance" className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-6 max-sm:p-4 max-w-md w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Palette size={22} className="text-blue-500" /> Room Appearance
          </h3>
          <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {/* Room avatar */}
        <div className="flex items-center gap-4 mb-6">
          {avatarUrl
            ? <img src={avatarUrl} alt="Room avatar" className="w-16 h-16 rounded-2xl object-cover shadow-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800" />
            : <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl shadow-md">{initials}</div>}
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Room Icon</p>
            <div className="flex gap-2">
              <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition text-xs font-semibold text-slate-600 dark:text-slate-300" title="Upload icon">
                {uploading === 'avatar' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0], 'avatar'); e.target.value = ''; }} />
              </label>
              <button onClick={() => { setShowLink((s) => !s); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition text-xs font-semibold text-slate-600 dark:text-slate-300"><LinkIcon size={14} /> Link</button>
              {avatarUrl && <button onClick={() => setAvatarUrl('')} aria-label="Reset icon" className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition text-xs font-semibold text-slate-600 dark:text-slate-300"><RotateCcw size={14} /></button>}
            </div>
            {showLink && (
              <div className="flex relative mt-2 animate-in slide-in-from-top-1">
                <input value={linkValue} onChange={(e) => setLinkValue(e.target.value)} placeholder="https://image-url.png" className="w-full pl-3 pr-9 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950 outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={() => {
                  // https only — saved room-wide into rooms.avatar_url for every member.
                  const v = linkValue.trim();
                  try {
                    if (new URL(v).protocol === 'https:') { setAvatarUrl(v); setShowLink(false); setLinkValue(''); }
                    else alert('Please use an https:// image URL.');
                  } catch { alert('Please enter a valid image URL.'); }
                }} aria-label="Use icon URL" className="absolute right-1 top-1/2 -translate-y-1/2 p-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded"><Check size={14} /></button>
              </div>
            )}
          </div>
        </div>

        {/* Wallpaper presets */}
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Wallpaper</p>
        <div className="grid grid-cols-3 gap-2.5">
          {ROOM_BG_PRESETS.map((p) => {
            const selected = bgType === 'preset' && bgPreset === p.key;
            return (
              <button
                key={p.key}
                onClick={() => { setBgType('preset'); setBgPreset(p.key); }}
                className={`relative h-20 rounded-xl overflow-hidden border-2 transition-all ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}
                style={p.style(isDarkMode)}
                title={p.name}
              >
                {selected && <span className="absolute top-1 right-1 bg-blue-500 text-white rounded-full p-0.5 shadow"><Check size={12} /></span>}
                <span className="absolute bottom-0 inset-x-0 text-[10px] font-bold text-center py-0.5 bg-black/30 text-white backdrop-blur-sm">{p.name}</span>
              </button>
            );
          })}

          {/* Custom image tile */}
          <label
            className={`relative h-20 rounded-xl overflow-hidden border-2 cursor-pointer transition-all flex flex-col items-center justify-center gap-1 ${bgType === 'image' ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-300'} bg-slate-50 dark:bg-slate-800`}
            style={bgType === 'image' && bgUrl ? { backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            title="Custom image"
          >
            {!(bgType === 'image' && bgUrl) && (uploading === 'bg' ? <Loader2 size={18} className="animate-spin text-slate-400" /> : <ImageIcon size={18} className="text-slate-400" />)}
            {!(bgType === 'image' && bgUrl) && <span className="text-[10px] font-bold text-slate-400">Custom</span>}
            {bgType === 'image' && bgUrl && <span className="absolute top-1 right-1 bg-blue-500 text-white rounded-full p-0.5 shadow"><Check size={12} /></span>}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0], 'bg'); e.target.value = ''; }} />
          </label>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-3 text-slate-500 font-bold text-sm hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition">Cancel</button>
          <button onClick={handleSave} disabled={isSaving} className="flex-[2] py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transition flex items-center justify-center gap-2 disabled:opacity-50">
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default RoomAppearanceModal;
