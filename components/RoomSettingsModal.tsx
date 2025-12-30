
import React, { useState, useRef } from 'react';
import { X, Upload, RotateCcw, Image as ImageIcon, Layout, Calendar, User, Save, Loader2, Sparkles, Shield } from 'lucide-react';
import { supabase } from '../services/supabase';
import { Room } from '../types';
import { compressImage } from '../utils/helpers';

interface RoomSettingsModalProps {
  room: Room;
  creatorName: string;
  onClose: () => void;
  onUpdate: (updates: Partial<Room>) => void;
}

const PRESETS = [
  { id: 'none', label: 'Default', url: '' },
  { id: 'prism', label: 'Prism', url: 'https://www.transparenttextures.com/patterns/cubes.png' },
  { id: 'grid', label: 'Cyber Grid', url: 'https://www.transparenttextures.com/patterns/stardust.png' },
  { id: 'circuit', label: 'Circuit', url: 'https://www.transparenttextures.com/patterns/circuit-board.png' },
  { id: 'waves', label: 'Soft Waves', url: 'https://www.transparenttextures.com/patterns/double-lined-grid.png' },
  { id: 'polygons', label: 'Geometric', url: 'https://www.transparenttextures.com/patterns/diagonal-striped-brick.png' }
];

const RoomSettingsModal: React.FC<RoomSettingsModalProps> = ({ room, creatorName, onClose, onUpdate }) => {
  const [activeTab, setActiveTab] = useState<'look' | 'info'>('look');
  const [isSaving, setIsSaving] = useState(false);
  const [tempAvatar, setTempAvatar] = useState(room.avatar_url || '');
  const [tempBg, setTempBg] = useState(room.background_url || '');
  const [tempBgType, setTempBgType] = useState(room.background_type || 'preset');
  const [tempBgPreset, setTempBgPreset] = useState(room.background_preset || 'none');
  
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    try {
      const file = await compressImage(e.target.files[0]);
      const path = `room_avatars/${room.room_key}/${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('attachments').upload(path, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(path);
      setTempAvatar(publicUrl);
    } catch (err) { alert("Η μεταφόρτωση απέτυχε"); }
  };

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    try {
      const file = await compressImage(e.target.files[0]);
      const path = `room_backgrounds/${room.room_key}/${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('attachments').upload(path, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(path);
      setTempBg(publicUrl);
      setTempBgType('image');
    } catch (err) { alert("Η μεταφόρτωση απέτυχε"); }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    const updates = {
      avatar_url: tempAvatar,
      background_url: tempBg,
      background_type: tempBgType,
      background_preset: tempBgPreset
    };
    try {
      const { error } = await supabase.from('rooms').update(updates).eq('room_key', room.room_key);
      if (error) throw error;
      onUpdate(updates);
      onClose();
    } catch (err) { alert("Η αποθήκευση απέτυχε"); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl border border-white/20 dark:border-slate-800 flex flex-col" onClick={e => e.stopPropagation()}>
        
        <div className="p-6 bg-gradient-to-br from-blue-600 to-indigo-700 text-white relative">
          <button onClick={onClose} className="absolute top-4 right-4 p-1.5 bg-white/10 hover:bg-white/20 rounded-full transition-colors"><X size={18}/></button>
          <h2 className="text-xl font-bold flex items-center gap-2"><Layout size={22}/> Ρυθμίσεις Δωματίου</h2>
          <div className="flex gap-4 mt-6">
            <button onClick={() => setActiveTab('look')} className={`text-xs font-bold uppercase tracking-widest pb-2 border-b-2 transition-all ${activeTab === 'look' ? 'border-white opacity-100' : 'border-transparent opacity-50'}`}>Εμφάνιση</button>
            <button onClick={() => setActiveTab('info')} className={`text-xs font-bold uppercase tracking-widest pb-2 border-b-2 transition-all ${activeTab === 'info' ? 'border-white opacity-100' : 'border-transparent opacity-50'}`}>Πληροφορίες</button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[65vh]">
          {activeTab === 'look' ? (
            <div className="space-y-6 animate-in slide-in-from-right-4">
              <section>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Εικονίδιο Δωματίου</label>
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center overflow-hidden border-2 border-dashed border-slate-200 dark:border-slate-700 shadow-inner">
                    {tempAvatar ? <img src={tempAvatar} className="w-full h-full object-cover" /> : <span className="text-xl font-bold text-blue-500">{room.room_name.substring(0,2).toUpperCase()}</span>}
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    <button onClick={() => avatarInputRef.current?.click()} className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-[10px] font-bold rounded-xl hover:bg-blue-700 transition uppercase shadow-sm"><Upload size={12}/> Ανέβασμα</button>
                    <button onClick={() => setTempAvatar('')} className="flex items-center justify-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold rounded-xl hover:bg-slate-200 transition uppercase"><RotateCcw size={12}/> Επαναφορά</button>
                    <input type="file" ref={avatarInputRef} className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                  </div>
                </div>
              </section>

              <section>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 block">Premium Φόντο</label>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {PRESETS.map(p => (
                    <button 
                      key={p.id} 
                      onClick={() => { setTempBgPreset(p.id); setTempBgType('preset'); }}
                      className={`h-12 rounded-xl border-2 transition-all overflow-hidden relative flex items-center justify-center ${tempBgPreset === p.id && tempBgType === 'preset' ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-100 dark:border-slate-800'}`}
                    >
                      <div className="absolute inset-0 bg-slate-50 dark:bg-slate-800"></div>
                      {p.url && <div className="absolute inset-0 opacity-30 invert dark:invert-0" style={{backgroundImage: `url(${p.url})`, backgroundSize: '40px'}}></div>}
                      <span className="relative z-10 text-[9px] font-bold dark:text-white text-slate-800">{p.label}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => bgInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-500 hover:text-blue-500 hover:border-blue-500 transition group bg-slate-50 dark:bg-slate-800/30">
                  {tempBgType === 'image' ? <Sparkles size={16} className="text-blue-500 animate-pulse"/> : <ImageIcon size={16}/>}
                  <span className="text-[10px] font-bold uppercase">{tempBgType === 'image' ? 'Προσαρμοσμένο Φόντο' : 'Δικό σας Φόντο'}</span>
                  <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={handleBgUpload} />
                </button>
              </section>
            </div>
          ) : (
            <div className="space-y-4 animate-in slide-in-from-left-4">
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center gap-4">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl flex items-center justify-center"><User size={20}/></div>
                <div>
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Δημιουργός</span>
                   <span className="text-sm font-bold">{creatorName}</span>
                </div>
              </div>
              <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center gap-4">
                <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl flex items-center justify-center"><Calendar size={20}/></div>
                <div>
                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Ημερομηνία Δημιουργίας</span>
                   <span className="text-sm font-bold">{new Date(room.created_at).toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
              </div>
              <div className="p-5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/50">
                <h4 className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase flex items-center gap-2 mb-2"><Shield size={12}/> Host Privilege</h4>
                <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">Ως ιδιοκτήτης, μπορείτε να αλλάξετε την εμφάνιση του δωματίου για όλους τους χρήστες. Οι αλλαγές αποθηκεύονται άμεσα στη βάση δεδομένων.</p>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 pt-2 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 text-xs font-bold text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl transition">Άκυρο</button>
          <button 
            onClick={saveSettings} 
            disabled={isSaving}
            className="flex-[2] py-3 bg-blue-600 text-white text-xs font-bold rounded-xl shadow-lg hover:bg-blue-700 transition flex items-center justify-center gap-2"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>} Αποθήκευση
          </button>
        </div>
      </div>
    </div>
  );
};

export default RoomSettingsModal;
