import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Image as ImageIcon, Play } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import MediaPreviewModal, { MediaItem } from './MediaPreviewModal';

interface MediaGalleryModalProps {
  show: boolean;
  onClose: () => void;
  items: MediaItem[]; // newest-first; all image/video attachments in the room
}

const MediaGalleryModal: React.FC<MediaGalleryModalProps> = ({ show, onClose, items }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  if (!show) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Media gallery" className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-5 max-w-2xl w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ImageIcon size={22} className="text-blue-500" /> Media
            {items.length > 0 && <span className="text-sm font-medium text-slate-400">({items.length})</span>}
          </h3>
          <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
            <ImageIcon size={36} className="mb-3 opacity-40" />
            <p className="text-sm">No photos or videos shared yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 overflow-y-auto -mr-1 pr-1">
            {items.map((item, i) => {
              const isVideo = item.type.startsWith('video/');
              return (
                <button
                  key={`${item.url}_${i}`}
                  onClick={() => setPreviewIndex(i)}
                  className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 group focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {isVideo ? (
                    <>
                      <video src={`${item.url}#t=0.001`} className="w-full h-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Play size={22} className="text-white drop-shadow" fill="currentColor" />
                      </span>
                    </>
                  ) : (
                    <img src={item.url} alt={item.name} loading="lazy" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {previewIndex !== null && (
        <MediaPreviewModal items={items} index={previewIndex} onNavigate={setPreviewIndex} onClose={() => setPreviewIndex(null)} />
      )}
    </div>,
    document.body
  );
};

export default MediaGalleryModal;
