import React, { useState, useRef } from 'react';
import { X, RefreshCw, Upload, Link as LinkIcon, Save, Loader2, Wand2 } from 'lucide-react';
import { supabase } from '../services/supabase';
import { compressImage } from '../utils/helpers';

interface AiAvatarModalProps {
  show: boolean;
  onClose: () => void;
  currentAvatarUrl: string;
  roomKey: string;
  onUpdate: (newUrl: string) => void;
}

const AiAvatarModal: React.FC<AiAvatarModalProps> = ({ show, onClose, currentAvatarUrl, roomKey, onUpdate }) => {
  const [tempUrl, setTempUrl] = useState(currentAvatarUrl);
  const [isSaving, setIsSaving] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!show) return null;

  const handleGenerateRandom = () => {
    const seed = Math.random().toString(36).substring(7);
    const url = `https://api.dicebear.com/9.x/bottts/svg?seed=${seed}&backgroundColor=6366f1`;
    setTempUrl(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    try {
      const compressed = await compressImage(file);
      const fileName = `ai_avatar_${Date.now()}.${compressed.name.split('.').pop()}`;
      const filePath = `${roomKey}/${fileName}`;

      const { error } = await supabase.storage.from('attachments').upload(filePath, compressed);
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from('attachments').getPublicUrl(filePath);
      setTempUrl(publicUrl);
    } catch (err) {
      console.error(err);
      alert("Failed to upload image");
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('rooms')
        .update({ ai_avatar_url: tempUrl })
        .eq('room_key', roomKey);

      if (error) throw error;
      onUpdate(tempUrl);
      onClose();
    } catch (err) {
      console.error(err);
      alert("Failed to update AI avatar");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Wand2 size={24} className="text-purple-500" /> Customize Inco
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-6">
          <div className="relative group">
            <img src={tempUrl} alt="Preview" className="w-32 h-32 rounded-3xl object-cover shadow-xl border-4 border-purple-500/20 bg-slate-100 dark:bg-slate-800" />
            <div className="absolute -bottom-2 -right-2 bg-purple-500 text-white p-1.5 rounded-lg shadow-lg">
              <Wand2 size={16} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 w-full">
            <button onClick={handleGenerateRandom} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition group">
              <RefreshCw size={20} className="text-purple-500 group-hover:rotate-180 transition-transform duration-500" />
              <span className="text-[10px] font-bold text-slate-500 uppercase">Shuffle</span>
            </button>
            <label className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition cursor-pointer group">
              <Upload size={20} className="text-blue-500 group-hover:-translate-y-1 transition-transform" />
              <span className="text-[10px] font-bold text-slate-500 uppercase">Upload</span>
              <input type="file" className="hidden" onChange={handleFileUpload} accept="image/*" />
            </label>
            <button onClick={() => setShowLinkInput(!showLinkInput)} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl hover:bg-orange-50 dark:hover:bg-orange-900/20 transition group">
              <LinkIcon size={20} className="text-orange-500 group-hover:scale-110 transition-transform" />
              <span className="text-[10px] font-bold text-slate-500 uppercase">Link</span>
            </button>
          </div>

          {showLinkInput && (
            <div className="w-full animate-in slide-in-from-top-2">
              <div className="relative">
                <input 
                  type="text" 
                  value={linkValue}
                  onChange={(e) => setLinkValue(e.target.value)}
                  placeholder="https://..."
                  className="w-full pl-3 pr-10 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-950 outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button 
                  onClick={() => { if(linkValue.startsWith('http')) setTempUrl(linkValue); setShowLinkInput(false); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-purple-500 text-white rounded-lg"
                >
                  <Save size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-3 w-full mt-2">
            <button onClick={onClose} className="flex-1 py-3 text-slate-500 font-bold text-sm hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition">Cancel</button>
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="flex-[2] py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-lg shadow-purple-500/30 transition flex items-center justify-center gap-2"
            >
              {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
              Apply Look
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiAvatarModal;