import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Image as ImageIcon, Play, Link2, ExternalLink, Download,
  FileText, File, FileVideo, FileArchive, FileCode,
} from 'lucide-react';
import { useModalA11y } from '../hooks/useModalA11y';
import MediaPreviewModal, { MediaItem } from './MediaPreviewModal';

interface FileEntry { url: string; name: string; type: string; size: number; }
interface LinkEntry { url: string; username: string; createdAt: any; }

interface MediaGalleryModalProps {
  show: boolean;
  onClose: () => void;
  media: MediaItem[]; // image/video attachments, newest-first
  files: FileEntry[]; // every other attachment, newest-first
  links: LinkEntry[]; // http(s) URLs found in messages, newest-first
}

type Tab = 'media' | 'files' | 'links';

const fileIcon = (type: string) => {
  if (type.includes('pdf')) return <FileText size={20} />;
  if (type.includes('zip') || type.includes('rar') || type.includes('7z') || type.includes('tar') || type.includes('compressed')) return <FileArchive size={20} />;
  if (type.includes('code') || type.includes('json') || type.includes('xml')) return <FileCode size={20} />;
  if (type.startsWith('video/')) return <FileVideo size={20} />;
  return <File size={20} />;
};

const formatSize = (bytes: number) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const hostname = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

const MediaGalleryModal: React.FC<MediaGalleryModalProps> = ({ show, onClose, media, files, links }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(show, onClose, dialogRef);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('media');

  // On each open, land on the first tab that actually has content.
  useEffect(() => {
    if (!show) return;
    setTab(media.length ? 'media' : files.length ? 'files' : links.length ? 'links' : 'media');
  }, [show, media.length, files.length, links.length]);

  if (!show) return null;

  const TabButton: React.FC<{ id: Tab; label: string; count: number }> = ({ id, label, count }) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        tab === id
          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
          : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
      }`}
    >
      {label}
      <span className={`text-xs font-bold ${tab === id ? 'text-blue-500' : 'text-slate-300 dark:text-slate-600'}`}>{count}</span>
    </button>
  );

  const Empty: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
      <span className="mb-3 opacity-40">{icon}</span>
      <p className="text-sm">{text}</p>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Media, links and files" className="outline-none bg-white dark:bg-slate-900 rounded-3xl p-5 max-w-2xl w-full shadow-2xl border border-white/10 dark:border-slate-800 animate-in zoom-in-95 duration-200 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ImageIcon size={22} className="text-blue-500" /> Media, links &amp; files
          </h3>
          <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <div className="flex border-b border-slate-100 dark:border-slate-800 mb-3 shrink-0">
          <TabButton id="media" label="Media" count={media.length} />
          <TabButton id="files" label="Files" count={files.length} />
          <TabButton id="links" label="Links" count={links.length} />
        </div>

        <div className="overflow-y-auto -mr-1 pr-1">
          {tab === 'media' && (
            media.length === 0 ? (
              <Empty icon={<ImageIcon size={36} />} text="No photos or videos shared yet." />
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {media.map((item, i) => {
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
            )
          )}

          {tab === 'files' && (
            files.length === 0 ? (
              <Empty icon={<File size={36} />} text="No files shared yet." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {files.map((f, i) => (
                  <a
                    key={`${f.url}_${i}`}
                    href={f.url}
                    download={f.name}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group"
                  >
                    <span className="p-2.5 rounded-lg shrink-0 bg-blue-100 dark:bg-slate-700 text-blue-600 dark:text-blue-300">{fileIcon(f.type)}</span>
                    <span className="flex flex-col flex-1 min-w-0">
                      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{f.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">{formatSize(f.size)}</span>
                    </span>
                    <Download size={18} className="text-slate-400 group-hover:text-blue-500 shrink-0" />
                  </a>
                ))}
              </div>
            )
          )}

          {tab === 'links' && (
            links.length === 0 ? (
              <Empty icon={<Link2 size={36} />} text="No links shared yet." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {links.map((l, i) => (
                  <a
                    key={`${l.url}_${i}`}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition group"
                  >
                    <span className="p-2.5 rounded-lg shrink-0 bg-cyan-100 dark:bg-slate-700 text-cyan-600 dark:text-cyan-300"><Link2 size={20} /></span>
                    <span className="flex flex-col flex-1 min-w-0">
                      <span className="text-sm font-semibold text-blue-600 dark:text-blue-400 truncate group-hover:underline">{hostname(l.url)}</span>
                      <span className="text-xs text-slate-400 truncate">{l.url}</span>
                      <span className="text-[10px] text-slate-400 mt-0.5">shared by {l.username}</span>
                    </span>
                    <ExternalLink size={16} className="text-slate-400 group-hover:text-blue-500 shrink-0" />
                  </a>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {previewIndex !== null && (
        <MediaPreviewModal items={media} index={previewIndex} onNavigate={setPreviewIndex} onClose={() => setPreviewIndex(null)} />
      )}
    </div>,
    document.body
  );
};

export default MediaGalleryModal;
