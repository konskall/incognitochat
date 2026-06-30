import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';

export type MediaItem = { url: string; name: string; type: string };

// Full-screen lightbox with swipe/arrow navigation across a list of media items.
const MediaPreviewModal: React.FC<{ items: MediaItem[]; index: number; onClose: () => void; onNavigate: (i: number) => void; }> = ({ items, index, onClose, onNavigate }) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const touchStartX = useRef<number | null>(null);
    useModalA11y(true, onClose, dialogRef);
    useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = 'unset'; }; }, []);

    const item = items[index];
    const hasPrev = index > 0;
    const hasNext = index < items.length - 1;
    const go = useCallback((delta: number) => {
        const next = index + delta;
        if (next >= 0 && next < items.length) onNavigate(next);
    }, [index, items.length, onNavigate]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') go(-1);
            else if (e.key === 'ArrowRight') go(1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go]);

    // Warm the immediate neighbours so a swipe/arrow to the next image paints
    // instantly instead of pausing on a cold fetch. Images only — videos are too
    // heavy to preload eagerly (they keep preload='metadata' on demand).
    useEffect(() => {
        [index - 1, index + 1].forEach((i) => {
            const it = items[i];
            if (it && it.type.startsWith('image/')) { const img = new Image(); img.src = it.url; }
        });
    }, [index, items]);

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!item) return;
        // iOS Safari/WebKit ignores the <a download> attribute on a programmatic
        // click (incl. blob: URLs) AND fetch/click resolve without throwing, so the
        // catch fallback never fires → the button is a silent no-op. Open the URL
        // directly so the user can long-press → Save. (Matches MessageList's path.)
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
        if (isIOS) { window.open(item.url, '_blank'); return; }
        try {
            const response = await fetch(item.url);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl; link.download = item.name || 'media';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (e) { window.open(item.url, '_blank'); }
    };

    if (!item) return null;
    const isVideo = item.type.startsWith('video/');
    return createPortal(
        <div
          ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Media preview"
          className="outline-none fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center animate-in fade-in duration-200 backdrop-blur-sm"
          onClick={onClose}
          onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
              if (touchStartX.current == null) return;
              const dx = e.changedTouches[0].clientX - touchStartX.current;
              if (dx > 50) go(-1); else if (dx < -50) go(1);
              touchStartX.current = null;
          }}
        >
            <div className="absolute top-0 left-0 right-0 z-[10000] flex justify-between items-center p-4 pt-[max(1rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                 <button onClick={handleDownload} aria-label="Download" className="pointer-events-auto p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md border border-white/10 shadow-lg transition-all active:scale-90"><Download size={24} /></button>
                 {items.length > 1 && <span className="pointer-events-none text-white/80 text-sm font-medium bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">{index + 1} / {items.length}</span>}
                 <button onClick={onClose} aria-label="Close preview" className="pointer-events-auto p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md border border-white/10 shadow-lg transition-all active:scale-90"><X size={24} /></button>
            </div>

            {hasPrev && <button onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Previous" className="hidden sm:flex absolute left-3 z-[10000] p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md border border-white/10 shadow-lg transition-all active:scale-90"><ChevronLeft size={28} /></button>}
            {hasNext && <button onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Next" className="hidden sm:flex absolute right-3 z-[10000] p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md border border-white/10 shadow-lg transition-all active:scale-90"><ChevronRight size={28} /></button>}

            <div className="w-full h-full flex items-center justify-center p-4 overflow-hidden">
                {isVideo ? <video key={item.url} src={item.url} controls autoPlay playsInline className="max-w-full max-h-full shadow-2xl rounded-lg outline-none" onClick={(e) => e.stopPropagation()} /> : <img key={item.url} src={item.url} alt={item.name} className="max-w-full max-h-full object-contain shadow-2xl rounded-lg" onClick={(e) => e.stopPropagation()} />}
            </div>
        </div>,
        document.body
    );
};

export default MediaPreviewModal;
