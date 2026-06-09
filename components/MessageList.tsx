
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Message } from '../types';
import { getYouTubeId } from '../utils/helpers';
import { supabase } from '../services/supabase';
import MediaPreviewModal, { MediaItem } from './MediaPreviewModal';
import PollMessage from './PollMessage';
import {
  FileText, Download,
  File, FileVideo, FileCode, FileArchive, Reply, ExternalLink, MapPin, Trash2, Eye, Play, Pause, AlertCircle, Wand2, Search, CheckCheck
} from 'lucide-react';
import MessageActionMenu from './MessageActionMenu';
import { useModalA11y } from '../hooks/useModalA11y';

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface MessageListProps {
  messages: Message[];
  currentUserUid: string;
  onEdit: (msg: Message) => void;
  onDelete: (msgId: string) => void;
  onReact: (msg: Message, emoji: string) => void;
  onReply: (msg: Message) => void;
  onUserClick?: (uid: string, username: string, avatar: string) => void;
  hasMoreOlder?: boolean;
  onLoadEarlier?: () => void | Promise<void>;
  searchQuery?: string;
  seenMessageId?: string | null;
  messageTtlSeconds?: number | null;
  roomOwnerUid?: string;
  isOwner?: boolean;
  pinnedMessageId?: string | null;
  onPin?: (msg: Message) => void;
  onUnpin?: () => void;
  onVotePoll?: (msg: Message, optionId: string) => void;
  onToggleClosedPoll?: (msg: Message, closed: boolean) => void;
}

const INCO_BOT_UUID = '00000000-0000-0000-0000-000000000000';

const DeleteToast: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
    // Destructive, no-undo confirmation: make it a real dialog so screen readers
    // announce it, focus moves to it (lands on Cancel), and Escape cancels.
    const dialogRef = useRef<HTMLDivElement>(null);
    useModalA11y(true, onCancel, dialogRef);
    return createPortal(
        <div className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-auto z-[100] animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div
                ref={dialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="del-msg-title"
                aria-describedby="del-msg-desc"
                tabIndex={-1}
                className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-6 p-4 bg-slate-900/95 dark:bg-white/10 backdrop-blur-2xl border border-white/10 shadow-2xl rounded-2xl text-white ring-1 ring-black/5 outline-none"
            >
                <div className="flex flex-col items-center sm:items-start text-center sm:text-left w-full sm:w-auto">
                    <span id="del-msg-title" className="text-sm font-bold flex items-center justify-center sm:justify-start gap-2 text-white">
                        <AlertCircle size={18} className="text-red-400 shrink-0" />
                        <span>Delete message;</span>
                    </span>
                    <span id="del-msg-desc" className="text-[11px] text-white/60 mt-0.5">This action cannot be undone.</span>
                </div>
                <div className="hidden sm:block h-8 w-px bg-white/10"></div>
                <div className="flex gap-3 w-full sm:w-auto">
                    <button onClick={onCancel} className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 text-white rounded-xl transition-colors text-center border border-white/5">Cancel</button>
                    <button onClick={onConfirm} className="flex-1 sm:flex-none px-4 py-2.5 sm:py-1.5 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded-xl shadow-lg shadow-red-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"><Trash2 size={14} /><span>Delete</span></button>
                </div>
            </div>
        </div>,
        document.body
    );
};

const AudioPlayer: React.FC<{ src: string; isMe: boolean }> = ({ src, isMe }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const waveformRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const bars = useMemo(() => Array.from({ length: 26 }, () => Math.floor(Math.random() * 50) + 25), []);
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const setAudioData = () => { if(audio.duration !== Infinity) setDuration(audio.duration); };
        const setAudioTime = () => setCurrentTime(audio.currentTime);
        const handleEnded = () => { setIsPlaying(false); setCurrentTime(0); };
        audio.addEventListener('loadedmetadata', setAudioData);
        audio.addEventListener('timeupdate', setAudioTime);
        audio.addEventListener('ended', handleEnded);
        return () => {
            audio.removeEventListener('loadedmetadata', setAudioData);
            audio.removeEventListener('timeupdate', setAudioTime);
            audio.removeEventListener('ended', handleEnded);
        };
    }, []);
    const togglePlay = () => {
        const audio = audioRef.current;
        if (!audio) return;
        if (isPlaying) audio.pause(); else audio.play();
        setIsPlaying(!isPlaying);
    };
    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        const container = waveformRef.current;
        if (!audio || !container) return;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.min(Math.max(0, x / rect.width), 1);
        const newTime = percentage * (duration || 0);
        if (isFinite(newTime)) { audio.currentTime = newTime; setCurrentTime(newTime); }
    };
    // Keyboard seeking so the scrubber isn't pointer-only (it advertises
    // role="slider" below).
    const handleSeekKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const audio = audioRef.current;
        if (!audio || !duration) return;
        let t = currentTime;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = Math.min(duration, currentTime + 5);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = Math.max(0, currentTime - 5);
        else if (e.key === 'Home') t = 0;
        else if (e.key === 'End') t = duration;
        else return;
        e.preventDefault();
        audio.currentTime = t;
        setCurrentTime(t);
    };
    const formatTime = (time: number) => {
        if (isNaN(time) || !isFinite(time)) return "0:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    return (
        <div className={`flex items-center gap-3 p-2.5 rounded-xl w-full sm:w-[260px] max-w-full select-none ${isMe ? 'text-white' : 'text-slate-800 dark:text-slate-200'}`}>
            <audio ref={audioRef} src={src} preload="metadata" />
            <button onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all shadow-sm ${isMe ? 'bg-white text-blue-600 hover:bg-blue-50' : 'bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500'}`}>{isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5"/>}</button>
            <div className="flex-1 flex flex-col justify-center gap-1.5 min-w-0">
                <div
                    ref={waveformRef}
                    role="slider"
                    tabIndex={0}
                    aria-label="Seek voice message"
                    aria-valuemin={0}
                    aria-valuemax={Math.round(duration) || 0}
                    aria-valuenow={Math.round(currentTime)}
                    aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                    onKeyDown={handleSeekKey}
                    className="flex items-center justify-between h-8 cursor-pointer w-full pr-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    onClick={handleSeek}
                >
                    {bars.map((height, index) => {
                        const barPercent = (index / bars.length) * 100;
                        const isActive = barPercent < progressPercent;
                        return (<div key={index} className={`w-1 sm:w-1.5 rounded-full transition-colors duration-100 ease-in-out ${isActive ? (isMe ? 'bg-white/90' : 'bg-blue-500 dark:bg-blue-400') : (isMe ? 'bg-white/30' : 'bg-slate-300 dark:bg-slate-600')}`} style={{ height: `${height}%` }}/>);
                    })}
                </div>
                <div className={`flex justify-between text-[10px] font-medium opacity-80 select-none px-0.5`}><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
            </div>
        </div>
    );
};

// In-memory cache so the same URL isn't re-fetched across messages/re-renders.
const linkPreviewCache = new Map<string, { title?: string; description?: string; image?: string; publisher?: string } | null>();

const LinkPreview: React.FC<{ url: string }> = ({ url }) => {
    const [data, setData] = useState(() => linkPreviewCache.get(url) ?? null);
    const [loading, setLoading] = useState(() => !linkPreviewCache.has(url));
    useEffect(() => {
        if (linkPreviewCache.has(url)) { setData(linkPreviewCache.get(url) ?? null); setLoading(false); return; }
        let isActive = true;
        // Server-side Open Graph fetch (Edge Function) — no third-party client call.
        supabase.functions.invoke('link-preview', { body: { url } })
            .then(({ data: res }) => {
                const preview = res?.data ?? null;
                linkPreviewCache.set(url, preview);
                if (isActive) { setData(preview); setLoading(false); }
            })
            .catch(() => { if (isActive) setLoading(false); });
        return () => { isActive = false; };
    }, [url]);
    if (loading || !data || !data.title || data.title === url) return null;
    return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-stretch mt-2 bg-white/95 dark:bg-slate-800/95 border border-black/10 dark:border-white/10 rounded-lg overflow-hidden hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors w-[260px] sm:w-[320px] md:w-[360px] max-w-full min-h-[80px] shadow-sm text-slate-800 dark:text-slate-100 no-underline group/card">
            {data.image ? <div className="w-24 flex-shrink-0 bg-cover bg-center bg-no-repeat bg-slate-100 dark:bg-slate-700 border-r border-slate-100 dark:border-slate-700" style={{backgroundImage: `url(${data.image})`}} /> : <div className="w-20 flex-shrink-0 flex items-center justify-center bg-slate-100 dark:bg-slate-700 text-slate-400 border-r border-slate-100 dark:border-slate-700"><ExternalLink size={24} /></div>}
            <div className="flex-1 p-2.5 flex flex-col justify-center min-w-0">
                <h3 className="font-bold text-xs truncate leading-tight group-hover/card:text-blue-600 dark:group-hover/card:text-blue-400 transition-colors">{data.title}</h3>
                {data.description && <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1 leading-snug">{data.description}</p>}
                <div className="flex items-center gap-1.5 mt-2 pt-0.5"><span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider truncate">{data.publisher || new URL(url).hostname}</span></div>
            </div>
        </a>
    );
};

const MessageItem = React.memo(({ msg, isMe, currentUid, roomOwnerUid, onEdit, onRequestDelete, onReact, onReply, onPreview, onUserClick, searchQuery, showSeen, isOwner, isPinned, onPin, onUnpin, onVotePoll, onToggleClosedPoll, isFirstOfGroup = true, isLastOfGroup = true }: {
    msg: Message; isMe: boolean; currentUid: string; roomOwnerUid?: string; onEdit: (msg: Message) => void; onRequestDelete: (msgId: string) => void; onReact: (msg: Message, emoji: string) => void; onReply: (msg: Message) => void; onPreview: (url: string, name: string, type: string) => void; onUserClick?: (uid: string, username: string, avatar: string) => void; searchQuery?: string; showSeen?: boolean; isOwner?: boolean; isPinned?: boolean; onPin?: (msg: Message) => void; onUnpin?: () => void; onVotePoll?: (msg: Message, optionId: string) => void; onToggleClosedPoll?: (msg: Message, closed: boolean) => void; isFirstOfGroup?: boolean; isLastOfGroup?: boolean;
}) => {
  // Long-press / right-click opens the action menu (replaces the inline button column).
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ rect: DOMRect; html: string; cls: string } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressFired = useRef(false);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  const openActionMenu = () => {
    const el = bubbleRef.current;
    if (!el) return;
    setMenu({ rect: el.getBoundingClientRect(), html: el.innerHTML, cls: el.className });
  };
  const startPress = (x: number, y: number) => {
    pressOrigin.current = { x, y };
    pressFired.current = false;
    pressTimer.current = window.setTimeout(() => {
      pressFired.current = true;
      if (navigator.vibrate) navigator.vibrate(15);
      openActionMenu();
      window.setTimeout(() => { pressFired.current = false; }, 600);
    }, 450);
  };
  const movePress = (x: number, y: number) => {
    if (pressTimer.current && pressOrigin.current &&
        (Math.abs(x - pressOrigin.current.x) > 10 || Math.abs(y - pressOrigin.current.y) > 10)) {
      clearTimeout(pressTimer.current); pressTimer.current = null;
    }
  };
  const endPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };

  // Keyboard activation helper for the non-button affordances (avatar / name /
  // reply quote): Enter or Space runs the action.
  const onActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
  };

  // Swipe-to-reply (mobile): drag a bubble horizontally past a threshold to reply.
  const [swipeX, setSwipeX] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    swiping.current = false;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    if (!swiping.current) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) swiping.current = true;
      else return;
    }
    setSwipeX(Math.max(-90, Math.min(90, dx)));
  };
  const onTouchEnd = () => {
    if (Math.abs(swipeX) > 55) onReply(msg);
    setSwipeX(0);
    touchStart.current = null;
    swiping.current = false;
  };

  const highlight = (str: string): React.ReactNode => {
    const q = searchQuery?.trim();
    if (!q) return str;
    const parts = str.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'));
    return parts.map((p, i) =>
      p.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="bg-yellow-300/80 text-black rounded px-0.5">{p}</mark>
        : p
    );
  };
  const formatTime = (timestamp: any) => {
    if (!timestamp) return '...';
    try {
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) { return ''; }
  };
  const timeString = formatTime(msg.createdAt);
  const isBot = msg.uid === INCO_BOT_UUID;

  if (msg.type === 'system') {
      return (
          <div className="flex justify-center w-full my-4 opacity-70">
              <div className="bg-slate-200/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 text-xs py-1 px-3 rounded-full flex items-center gap-2 border border-slate-200/50 dark:border-slate-700/50 shadow-sm backdrop-blur-sm">
                  <span className="font-semibold">{msg.text}</span>
                  <span className="text-[10px] opacity-60">• {timeString}</span>
              </div>
          </div>
      );
  }

  const renderContent = (text: string) => {
    if (!text) return null;
    const ytId = getYouTubeId(text);
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    const matches = text.match(urlRegex);
    let previewUrl = (matches && !ytId) ? matches[0] : null;
    return (
        <div className="flex flex-col gap-2 w-full min-w-0">
            <span className="leading-relaxed whitespace-pre-wrap break-words">
                {parts.map((part, i) => part.match(urlRegex) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline text-inherit opacity-90 break-all hover:opacity-100">{part}</a> : <React.Fragment key={i}>{highlight(part)}</React.Fragment>)}
            </span>
            {ytId && <div className="relative w-[260px] sm:w-[320px] md:w-[400px] max-w-full aspect-video rounded-lg overflow-hidden shadow-md bg-black/5 mt-1"><iframe className="absolute inset-0 w-full h-full" src={`https://www.youtube.com/embed/${ytId}`} allowFullScreen loading="lazy"></iframe></div>}
            {previewUrl && <LinkPreview url={previewUrl} />}
        </div>
    );
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) return <FileText size={20} />;
    if (mimeType.includes('zip')) return <FileArchive size={20} />;
    if (mimeType.includes('code')) return <FileCode size={20} />;
    if (mimeType.includes('video/')) return <FileVideo size={20} />;
    return <File size={20} />;
  };

  const renderAttachment = () => {
    if (!msg.attachment) return null;
    const { url, name, type, size } = msg.attachment;
    if (type.startsWith('image/') || type.startsWith('video/')) {
        return (
            <div className="mt-2 mb-1 group relative inline-block">
                <div className={`relative overflow-hidden rounded-xl border border-white/10 ${type.startsWith('video/') ? 'bg-black' : 'bg-black/5'} cursor-pointer`} onClick={() => onPreview(url, name, type)}>
                    {type.startsWith('image/') ? <img src={url} alt={name} className="max-w-full max-h-[300px] w-auto object-contain block" /> : <video src={`${url}#t=0.001`} className="max-w-full max-h-[300px] w-auto object-contain block" />}
                    <div className="absolute inset-0 flex items-center justify-center transition-all duration-200 opacity-100 md:opacity-0 md:group-hover:opacity-100 bg-black/10">
                        <div className="flex items-center gap-2 p-2 bg-black/60 backdrop-blur-md rounded-full shadow-xl border border-white/20 transform scale-100 hover:scale-105 transition-transform" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => onPreview(url, name, type)} aria-label="Open preview" className="p-2 text-white hover:bg-white/20 rounded-full transition-colors">{type.startsWith('image/') ? <Eye size={20} /> : <Play size={20} fill="currentColor" />}</button>
                            <div className="w-px h-5 bg-white/30"></div>
                            <button onClick={(e) => { e.stopPropagation(); window.open(url, '_blank'); }} aria-label="Download" className="p-2 text-white hover:bg-white/20 rounded-full transition-colors"><Download size={20} /></button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    if (type.startsWith('audio/')) return <div className="mt-2 mb-1 w-full max-w-full"><div className={`rounded-xl p-1 ${isMe ? 'bg-white/10 border border-white/20' : 'bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600'}`}><AudioPlayer src={url} isMe={isMe} /></div></div>;
    return (
        <a href={url} download={name} className={`flex items-center gap-3 p-3 mt-2 rounded-xl border transition-all group ${isMe ? 'bg-white/10 border border-white/20 hover:bg-white/20 text-white' : 'bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 text-slate-700 dark:text-slate-200'}`}>
            <div className={`p-2.5 rounded-lg flex-shrink-0 ${isMe ? 'bg-white/20 text-blue-100' : 'bg-blue-100 dark:bg-slate-600 text-blue-600 dark:text-blue-300'}`}>{getFileIcon(type)}</div>
            <div className="flex flex-col flex-1 min-w-0"><span className="text-sm font-semibold truncate leading-tight">{name}</span><span className={`text-[10px] uppercase tracking-wider mt-0.5 ${isMe ? 'text-blue-100/70' : 'text-slate-400'}`}>{(size / 1024).toFixed(1)} KB</span></div>
            <div className="p-1.5 rounded-full opacity-70 group-hover:opacity-100"><Download size={18} /></div>
        </a>
    );
  };

  const renderLocation = () => {
      if (!msg.location) return null;
      const { lat, lng } = msg.location;
      return (
          <a href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noopener noreferrer" className={`flex flex-col gap-2 p-1.5 rounded-xl border mt-2 transition-all hover:shadow-md w-full sm:w-auto max-w-full ${isMe ? 'bg-white/10 border border-white/20 hover:bg-white/20' : 'bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-700'}`}>
              <div className="relative w-full sm:w-[240px] h-[100px] bg-slate-200 dark:bg-slate-700 rounded-lg overflow-hidden flex items-center justify-center"><div className="absolute inset-0 opacity-20" style={{backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '10px 10px'}}></div><div className="z-10 bg-red-500 text-white p-2 rounded-full shadow-lg transform -translate-y-2"><MapPin size={24} fill="currentColor" /></div></div>
              <div className="flex items-center justify-between px-1 pb-1"><div><span className={`text-xs font-bold ${isMe ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>Current Location</span></div><ExternalLink size={14} className={isMe ? 'text-white/70' : 'text-slate-400'} /></div>
          </a>
      );
  };

  return (
    <div id={`msg-${msg.id}`} className={`relative flex w-full ${isLastOfGroup ? 'mb-3' : 'mb-0.5'} animate-in slide-in-from-bottom-2 duration-300 group ${isMe ? 'justify-end' : 'justify-start'}`}>
      {swipeX !== 0 && (
        <div
          className={`absolute top-1/2 -translate-y-1/2 ${swipeX > 0 ? 'left-2' : 'right-2'} text-blue-500 pointer-events-none`}
          style={{ opacity: Math.min(1, Math.abs(swipeX) / 55) }}
        >
          <Reply size={20} />
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: swipeX ? `translateX(${swipeX}px)` : undefined, transition: swipeX ? 'none' : 'transform 0.2s ease' }}
        className={`flex max-w-[90%] md:max-w-[70%] touch-pan-y ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 relative`}
      >
        {/* Viber-style sender avatar: incoming messages only, top-aligned, shown
            once per consecutive sender group (a spacer keeps following bubbles
            aligned). Own messages show no avatar. */}
        {!isMe && (
          isFirstOfGroup ? (
            <img
              src={msg.avatarURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.username)}&background=64748b&color=fff&rounded=true`}
              alt={msg.username}
              onClick={() => !isBot && onUserClick?.(msg.uid, msg.username, msg.avatarURL)}
              role={!isBot ? 'button' : undefined}
              tabIndex={!isBot ? 0 : undefined}
              aria-label={!isBot ? `View ${msg.username}'s profile` : undefined}
              onKeyDown={!isBot ? onActivate(() => onUserClick?.(msg.uid, msg.username, msg.avatarURL)) : undefined}
              className={`w-8 h-8 rounded-full shadow-sm object-cover border-2 border-white dark:border-slate-700 select-none bg-slate-200 dark:bg-slate-700 self-start focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${!isBot ? 'cursor-pointer hover:scale-110 transition-transform active:scale-95' : ''}`}
            />
          ) : (
            <div className="w-8 shrink-0" aria-hidden="true" />
          )
        )}
        <div
          ref={bubbleRef}
          onTouchStart={(e) => startPress(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchMove={(e) => movePress(e.touches[0].clientX, e.touches[0].clientY)}
          onTouchEnd={(e) => { if (pressFired.current) e.preventDefault(); endPress(); }}
          onMouseDown={(e) => { if (e.button === 0) startPress(e.clientX, e.clientY); }}
          onMouseMove={(e) => movePress(e.clientX, e.clientY)}
          onMouseUp={endPress}
          onMouseLeave={endPress}
          onContextMenu={(e) => { e.preventDefault(); openActionMenu(); }}
          onClickCapture={(e) => { if (pressFired.current) { e.preventDefault(); e.stopPropagation(); pressFired.current = false; } }}
          tabIndex={0}
          aria-haspopup="menu"
          aria-keyshortcuts="Enter Space"
          onKeyDown={(e) => {
            // Only when the bubble itself is focused — let focused child links /
            // buttons handle their own Enter/Space.
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu') {
              e.preventDefault();
              openActionMenu();
            }
          }}
          style={{ WebkitTouchCallout: 'none' }}
          className={`chat-bubble relative px-4 py-2.5 rounded-2xl shadow-sm text-sm md:text-base min-w-0 transition-all select-none cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 ${isMe ? 'bg-blue-600 text-white rounded-br-none shadow-blue-500/20' : isBot ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-900 dark:text-indigo-100 rounded-bl-none shadow-indigo-500/10 border border-indigo-200 dark:border-indigo-800 ring-1 ring-indigo-400/20' : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-none shadow-slate-200 dark:shadow-none border border-slate-100 dark:border-slate-700'}`}>
                {!isMe && isFirstOfGroup && <p className={`text-[10px] font-bold text-slate-400 mb-0.5 tracking-wide select-none flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded ${!isBot ? 'cursor-pointer hover:text-blue-500 transition-colors' : ''}`} onClick={() => !isBot && onUserClick?.(msg.uid, msg.username, msg.avatarURL)} role={!isBot ? 'button' : undefined} tabIndex={!isBot ? 0 : undefined} aria-label={!isBot ? `View ${msg.username}'s profile` : undefined} onKeyDown={!isBot ? onActivate(() => onUserClick?.(msg.uid, msg.username, msg.avatarURL)) : undefined}>{msg.username} {isBot && <Wand2 size={10} className="text-indigo-400 animate-pulse" />}</p>}
                {msg.replyTo && <div onClick={() => {const el = document.getElementById(`msg-${msg.replyTo!.id}`); if(el) el.scrollIntoView({behavior:'smooth',block:'center'});}} role="button" tabIndex={0} aria-label={`Go to message replied to from ${msg.replyTo.username}`} onKeyDown={onActivate(() => {const el = document.getElementById(`msg-${msg.replyTo!.id}`); if(el) el.scrollIntoView({behavior:'smooth',block:'center'});})} className={`mb-2 p-2 rounded cursor-pointer opacity-90 hover:opacity-100 transition border-l-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${isMe ? 'bg-black/10 border-white/40' : 'bg-slate-100 dark:bg-slate-700 border-blue-400'}`}><span className={`text-xs font-bold block mb-0.5 ${isMe ? 'text-blue-100' : 'text-blue-600 dark:text-blue-400'}`}>{msg.replyTo.username}</span><p className="text-xs truncate max-w-[200px] opacity-80">{msg.replyTo.isAttachment ? '📎 Attachment' : msg.replyTo.text}</p></div>}
                {renderAttachment()}
                {renderLocation()}
                {msg.poll && (
                    <PollMessage
                        poll={msg.poll}
                        currentUid={currentUid}
                        isMe={isMe}
                        canManage={isMe || (!!roomOwnerUid && currentUid === roomOwnerUid)}
                        onVote={(optionId) => onVotePoll?.(msg, optionId)}
                        onToggleClosed={(closed) => onToggleClosedPoll?.(msg, closed)}
                    />
                )}
                {msg.text && <div className={`leading-relaxed whitespace-pre-wrap break-words ${(msg.attachment || msg.location) ? 'mt-2 pt-2 border-t ' + (isMe ? 'border-white/20' : 'border-slate-100 dark:border-slate-700') : ''}`}>{renderContent(msg.text)}</div>}
                
                {/* Grounding Sources UI */}
                {msg.groundingMetadata && msg.groundingMetadata.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-indigo-100 dark:border-indigo-900/30">
                    <div className="flex items-center gap-1.5 mb-2 text-indigo-500 dark:text-indigo-400">
                      <Search size={12} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Search Sources</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.groundingMetadata.map((source, idx) => (
                        <a 
                          key={idx} 
                          href={source.uri} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2 py-1 bg-white/50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg text-[10px] font-medium text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/40 transition-colors max-w-[200px]"
                        >
                          <span className="truncate">{source.title || 'Link'}</span>
                          <ExternalLink size={8} className="shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className={`flex items-center justify-end gap-1 mt-1 select-none ${isMe ? 'text-blue-200' : isBot ? 'text-indigo-400' : 'text-slate-400'}`}>{msg.isEdited && <span className="text-[9px] italic opacity-80">(edited)</span>}<span className="text-[10px] font-medium">{timeString}</span>{isMe && showSeen && <span className="flex items-center gap-0.5 text-[9px] font-semibold" title="Seen"><CheckCheck size={12} /></span>}</div>
            </div>
            {msg.reactions && Object.keys(msg.reactions).length > 0 && <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>{Object.entries(msg.reactions).map(([emoji, uids]) => { if (uids.length === 0) return null; const iReacted = uids.includes(currentUid); return (<button key={emoji} onClick={() => onReact(msg, emoji)} className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs shadow-sm border transition-all hover:scale-105 ${iReacted ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-slate-800 dark:text-blue-100' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}><span>{emoji}</span><span className={`font-semibold text-[10px] ${iReacted ? 'text-blue-600 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}>{uids.length}</span></button>);})}</div>}
        </div>
        {menu && (
          <MessageActionMenu
            anchorRect={menu.rect}
            bubbleHTML={menu.html}
            bubbleClass={menu.cls}
            isMe={isMe}
            canEdit={isMe && !msg.poll}
            canDelete={isMe || isBot}
            canPin={!!isOwner}
            isPinned={!!isPinned}
            canCopy={!!(msg.text && msg.text.trim())}
            onClose={() => setMenu(null)}
            onReact={(e) => onReact(msg, e)}
            onReply={() => onReply(msg)}
            onCopy={() => { try { navigator.clipboard?.writeText(msg.text || ''); } catch { /* clipboard unavailable */ } }}
            onEdit={() => onEdit(msg)}
            onPin={() => (isPinned ? onUnpin?.() : onPin?.(msg))}
            onDelete={() => onRequestDelete(msg.id)}
          />
        )}
      </div>
  );
});

const MessageList: React.FC<MessageListProps> = ({ messages, currentUserUid, onEdit, onDelete, onReact, onReply, onUserClick, hasMoreOlder, onLoadEarlier, searchQuery, seenMessageId, messageTtlSeconds, roomOwnerUid, isOwner, pinnedMessageId, onPin, onUnpin, onVotePoll, onToggleClosedPoll }) => {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);
  // Ticks while disappearing-messages is on, so expired messages drop from view
  // promptly (the cron is the authoritative deleter, this is for precision).
  const [, setTtlTick] = useState(0);
  useEffect(() => {
    if (!messageTtlSeconds || messageTtlSeconds <= 0) return;
    const id = setInterval(() => setTtlTick((t) => t + 1), 20000);
    return () => clearInterval(id);
  }, [messageTtlSeconds]);

  // All viewable media in order, for swipe navigation in the lightbox.
  const mediaItems = useMemo<MediaItem[]>(
    () => messages
      .filter((m) => m.attachment && (m.attachment.type.startsWith('image/') || m.attachment.type.startsWith('video/')))
      .map((m) => ({ url: m.attachment!.url, name: m.attachment!.name, type: m.attachment!.type })),
    [messages]
  );
  // Read via ref so the preview opener stays referentially stable (memo-friendly).
  const mediaItemsRef = useRef(mediaItems);
  useEffect(() => { mediaItemsRef.current = mediaItems; }, [mediaItems]);

  const handleMediaPreview = useCallback((url: string) => {
    const idx = mediaItemsRef.current.findIndex((it) => it.url === url);
    setPreviewIndex(idx >= 0 ? idx : null);
  }, []);
  // Stable identity so React.memo on MessageItem isn't defeated every render.
  const handleRequestDelete = useCallback((id: string) => setDeletingMsgId(id), []);

  const listRef = useRef<HTMLDivElement>(null);
  // Distance-from-bottom captured before older messages are prepended, so we can
  // restore the scroll position afterwards and avoid a jarring jump.
  const restoreScrollRef = useRef<number | null>(null);

  const loadEarlier = useCallback(() => {
    const scroller = listRef.current?.parentElement;
    restoreScrollRef.current = scroller ? scroller.scrollHeight - scroller.scrollTop : null;
    onLoadEarlier?.();
  }, [onLoadEarlier]);

  // Runs after the prepended page lands (messages prop grows). Guarded so it's a
  // no-op for ordinary new-message-at-bottom renders, where restoreScrollRef is null.
  useLayoutEffect(() => {
    if (restoreScrollRef.current == null) return;
    const scroller = listRef.current?.parentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight - restoreScrollRef.current;
    restoreScrollRef.current = null;
  }, [messages]);

  // Hide messages already past the room's disappearing-messages TTL (the cron
  // deletes them server-side; this keeps the view precise between runs).
  const ttlCutoff = messageTtlSeconds && messageTtlSeconds > 0 ? Date.now() - messageTtlSeconds * 1000 : 0;
  const liveMessages = ttlCutoff
    ? messages.filter((m) => new Date(m.createdAt as any).getTime() >= ttlCutoff)
    : messages;

  // Search filters the (loaded) messages client-side — message text is encrypted
  // so it can only be matched after decryption on the client.
  const q = searchQuery?.trim().toLowerCase() || '';
  const visibleMessages = q
    ? liveMessages.filter((m) => m.type !== 'system' && (((m.text || '').toLowerCase().includes(q)) || (m.username || '').toLowerCase().includes(q)))
    : liveMessages;

  // Viber-style grouping: consecutive non-system messages from the same sender
  // (within 5 min) form a group — the avatar + name show once on the first
  // message and spacing tightens between the rest.
  const sameGroup = (a?: Message, b?: Message) =>
    !!a && !!b && a.uid === b.uid && a.type !== 'system' && b.type !== 'system' &&
    Math.abs(new Date(a.createdAt as any).getTime() - new Date(b.createdAt as any).getTime()) < 5 * 60 * 1000;

  return (
    <>
        {previewIndex !== null && <MediaPreviewModal items={mediaItems} index={previewIndex} onNavigate={setPreviewIndex} onClose={() => setPreviewIndex(null)} />}
        {deletingMsgId && <DeleteToast onConfirm={() => { onDelete(deletingMsgId); setDeletingMsgId(null); }} onCancel={() => setDeletingMsgId(null)} />}
        <div ref={listRef} className="flex flex-col justify-end min-h-full pb-2">
        {q ? (
          visibleMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 dark:text-slate-500 opacity-60"><Search size={28} className="mb-2 opacity-50" /><p>No matches for “{searchQuery}”.</p></div>
          ) : (
            <>
              <div className="flex justify-center py-3"><span className="text-xs font-semibold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1">{visibleMessages.length} result{visibleMessages.length === 1 ? '' : 's'}</span></div>
              {visibleMessages.map((msg, i, arr) => (
                <MessageItem key={msg.id} msg={msg} isMe={msg.uid === currentUserUid} currentUid={currentUserUid} roomOwnerUid={roomOwnerUid} onEdit={onEdit} onRequestDelete={handleRequestDelete} onReact={onReact} onReply={onReply} onPreview={handleMediaPreview} onUserClick={onUserClick} searchQuery={searchQuery} isOwner={isOwner} isPinned={msg.id === pinnedMessageId} onPin={onPin} onUnpin={onUnpin} onVotePoll={onVotePoll} onToggleClosedPoll={onToggleClosedPoll} isFirstOfGroup={!sameGroup(arr[i - 1], msg)} isLastOfGroup={!sameGroup(msg, arr[i + 1])} />
              ))}
            </>
          )
        ) : liveMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 dark:text-slate-500 opacity-60"><p>No messages yet.</p><p className="text-xs">Say hello! 👋</p></div>
        ) : (
          <>
            {hasMoreOlder && (
              <div className="flex justify-center py-3">
                <button
                  onClick={loadEarlier}
                  className="px-4 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-sm backdrop-blur-sm transition-colors active:scale-95"
                >
                  Load earlier messages
                </button>
              </div>
            )}
            {liveMessages.map((msg, i, arr) => (
              <MessageItem key={msg.id} msg={msg} isMe={msg.uid === currentUserUid} currentUid={currentUserUid} roomOwnerUid={roomOwnerUid} onEdit={onEdit} onRequestDelete={handleRequestDelete} onReact={onReact} onReply={onReply} onPreview={handleMediaPreview} onUserClick={onUserClick} showSeen={msg.id === seenMessageId} isOwner={isOwner} isPinned={msg.id === pinnedMessageId} onPin={onPin} onUnpin={onUnpin} onVotePoll={onVotePoll} onToggleClosedPoll={onToggleClosedPoll} isFirstOfGroup={!sameGroup(arr[i - 1], msg)} isLastOfGroup={!sameGroup(msg, arr[i + 1])} />
            ))}
          </>
        )}
        </div>
    </>
  );
};

// Memoized: the parent (ChatScreen) re-renders on every keystroke/presence/typing
// change. With stable callbacks + a stable `messages` reference, this skips the
// whole list (map + reconciliation) on those renders entirely.
export default React.memo(MessageList);
