
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Message } from '../types';
import { getYouTubeId } from '../utils/helpers';
import { 
  FileText, Download, Edit2, 
  File, FileVideo, FileCode, FileArchive, SmilePlus, Reply, ExternalLink, MapPin, X, Trash2, Eye, Play, Pause, AlertCircle, Check
} from 'lucide-react';

interface MessageListProps {
  messages: Message[];
  currentUserUid: string;
  onEdit: (msg: Message) => void;
  onDelete: (msgId: string) => void; 
  onReact: (msg: Message, emoji: string) => void;
  onReply: (msg: Message) => void;
}

// -- Custom Delete Toast Component (Glassmorphism) --
const DeleteToast: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
    return createPortal(
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] w-auto max-w-[90vw] animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="flex items-center gap-4 px-6 py-4 bg-slate-900/90 dark:bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-2xl text-white">
                <div className="flex flex-col">
                    <span className="text-sm font-bold flex items-center gap-2">
                        <AlertCircle size={16} className="text-red-400" />
                        Διαγραφή μηνύματος;
                    </span>
                    <span className="text-[10px] text-white/60">Η ενέργεια δεν αναιρείται.</span>
                </div>

                <div className="h-8 w-px bg-white/10 mx-1"></div>

                <div className="flex gap-2">
                    <button 
                        onClick={onCancel}
                        className="px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                        Ακύρωση
                    </button>
                    <button 
                        onClick={onConfirm}
                        className="px-4 py-1.5 text-xs font-bold bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-lg shadow-red-500/20 transition-all active:scale-95 flex items-center gap-1.5"
                    >
                        <Trash2 size={14} />
                        Διαγραφή
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

// -- Custom Audio Player Component (Waveform Style) --
const AudioPlayer: React.FC<{ src: string; isMe: boolean }> = ({ src, isMe }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const waveformRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    // Optimized bar count for mobile screens (approx 24-28 fits well in a chat bubble)
    const bars = useMemo(() => {
        return Array.from({ length: 26 }, () => Math.floor(Math.random() * 50) + 25);
    }, []);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const setAudioData = () => {
            if(audio.duration !== Infinity) setDuration(audio.duration);
        };

        const setAudioTime = () => {
            setCurrentTime(audio.currentTime);
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setCurrentTime(0);
        };

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

        if (isPlaying) {
            audio.pause();
        } else {
            audio.play();
        }
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
        if (isFinite(newTime)) {
             audio.currentTime = newTime;
             setCurrentTime(newTime);
        }
    };

    const formatTime = (time: number) => {
        if (isNaN(time) || !isFinite(time)) return "0:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    // Calculate percentage for progress
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className={`flex items-center gap-3 p-2.5 rounded-xl w-full sm:w-[260px] max-w-full select-none ${isMe ? 'text-white' : 'text-slate-800 dark:text-slate-200'}`}>
            <audio ref={audioRef} src={src} preload="metadata" />
            
            <button 
                onClick={togglePlay}
                className={`flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all shadow-sm
                    ${isMe 
                        ? 'bg-white text-blue-600 hover:bg-blue-50' 
                        : 'bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500'}`}
            >
                {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5"/>}
            </button>

            {/* Flex-1 and min-w-0 ensures this container shrinks if needed and doesn't overflow */}
            <div className="flex-1 flex flex-col justify-center gap-1.5 min-w-0">
                
                {/* Waveform Visualizer */}
                <div 
                    ref={waveformRef}
                    className="flex items-center justify-between h-8 cursor-pointer w-full pr-1"
                    onClick={handleSeek}
                >
                    {bars.map((height, index) => {
                        const barPercent = (index / bars.length) * 100;
                        const isActive = barPercent < progressPercent;
                        
                        return (
                            <div 
                                key={index}
                                className={`w-1 sm:w-1.5 rounded-full transition-colors duration-100 ease-in-out
                                    ${isActive 
                                        ? (isMe ? 'bg-white/90' : 'bg-blue-500 dark:bg-blue-400') 
                                        : (isMe ? 'bg-white/30' : 'bg-slate-300 dark:bg-slate-600')
                                    }`}
                                style={{ height: `${height}%` }}
                            />
                        );
                    })}
                </div>

                <div className={`flex justify-between text-[10px] font-medium opacity-80 select-none px-0.5`}>
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                </div>
            </div>
        </div>
    );
};

// -- Universal Media Preview Modal Component (Images & Video) --
const MediaPreviewModal: React.FC<{ 
    src: string; 
    alt: string; 
    type: string;
    onClose: () => void; 
}> = ({ src, alt, type, onClose }) => {
    
    // Lock body scroll when modal is open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, []);

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = alt || 'media';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (e) {
            console.error("Download failed", e);
            // Fallback
            window.open(src, '_blank');
        }
    };

    const isVideo = type.startsWith('video/');

    const modalContent = (
        <div className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center animate-in fade-in duration-200 backdrop-blur-sm" onClick={onClose}>
            
            {/* Controls Layer - Fixed Top Bar */}
            <div className="absolute top-0 left-0 right-0 z-[10000] flex justify-between items-center p-4 pt-[max(1rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                 
                 {/* Download Button */}
                 <button 
                    onClick={handleDownload}
                    className="pointer-events-auto p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md border border-white/10 shadow-lg transition-all active:scale-90"
                    aria-label="Download Media"
                    title="Download Original"
                 >
                    <Download size={24} />
                 </button>

                 {/* Close Button */}
                 <button 
                    onClick={onClose} 
                    className="pointer-events-auto p-3 bg-black/50 hover:bg-black/70 text-white rounded-full backdrop-blur-md border border-white/10 shadow-lg transition-all active:scale-90"
                    aria-label="Close Preview"
                    title="Close"
                 >
                    <X size={24} />
                 </button>
            </div>
                 
            {/* Media Area */}
            <div className="w-full h-full flex items-center justify-center p-4 overflow-hidden">
                {isVideo ? (
                    <video 
                        src={src} 
                        controls 
                        autoPlay 
                        playsInline
                        className="max-w-full max-h-full shadow-2xl rounded-lg outline-none"
                        onClick={(e) => e.stopPropagation()} 
                    />
                ) : (
                    <img 
                        src={src} 
                        alt={alt} 
                        className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
                        onClick={(e) => e.stopPropagation()} 
                    />
                )}
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
};

// -- Link Preview Component --
const LinkPreview: React.FC<{ url: string }> = ({ url }) => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let isActive = true; 
        setLoading(true);
        setError(false);
        
        // Using microlink.io free API to fetch Open Graph data
        fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`)
            .then(res => res.json())
            .then(json => {
                if (isActive) {
                    if (json.status === 'success') {
                        setData(json.data);
                    } else {
                        setError(true);
                    }
                    setLoading(false);
                }
            })
            .catch(() => {
                if (isActive) {
                    setError(true);
                    setLoading(false);
                }
            });
            
        return () => { isActive = false; };
    }, [url]);

    if (loading) return null;
    if (error || !data) return null;

    // Don't show preview if title is missing or it's just the url
    if (!data.title || data.title === url) return null;

    return (
        <a 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-stretch mt-2 bg-white/95 dark:bg-slate-800/95 border border-black/10 dark:border-white/10 rounded-lg overflow-hidden hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors w-[260px] sm:w-[320px] md:w-[360px] max-w-full min-h-[80px] shadow-sm text-slate-800 dark:text-slate-100 no-underline group/card"
        >
            {/* Image Section - Fixed width on left, covers height */}
            {data.image?.url ? (
                <div 
                    className="w-24 flex-shrink-0 bg-cover bg-center bg-no-repeat bg-slate-100 dark:bg-slate-700 border-r border-slate-100 dark:border-slate-700" 
                    style={{backgroundImage: `url(${data.image.url})`}} 
                />
            ) : (
                <div className="w-20 flex-shrink-0 flex items-center justify-center bg-slate-100 dark:bg-slate-700 text-slate-400 border-r border-slate-100 dark:border-slate-700">
                    <ExternalLink size={24} />
                </div>
            )}
            
            {/* Content Section */}
            <div className="flex-1 p-2.5 flex flex-col justify-center min-w-0">
                <h3 className="font-bold text-xs truncate leading-tight group-hover/card:text-blue-600 dark:group-hover/card:text-blue-400 transition-colors">
                    {data.title}
                </h3>
                {data.description && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-1 leading-snug">
                        {data.description}
                    </p>
                )}
                <div className="flex items-center gap-1.5 mt-2 pt-0.5">
                    {data.logo?.url && (
                        <img src={data.logo.url} loading="lazy" className="w-3.5 h-3.5 rounded-sm object-contain" alt="" />
                    )}
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider truncate">
                        {data.publisher || new URL(url).hostname}
                    </span>
                </div>
            </div>
        </a>
    );
};

// Memoized Message Item to prevent re-renders of the whole list
const MessageItem = React.memo(({ msg, isMe, currentUid, onEdit, onRequestDelete, onReact, onReply, onPreview }: { 
    msg: Message; 
    isMe: boolean; 
    currentUid: string; 
    onEdit: (msg: Message) => void; 
    onRequestDelete: (msgId: string) => void;
    onReact: (msg: Message, emoji: string) => void; 
    onReply: (msg: Message) => void;
    onPreview: (url: string, name: string, type: string) => void;
}) => {
  const [showReactions, setShowReactions] = useState(false);

  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

  const formatTime = (timestamp: any) => {
    if (!timestamp) return '...'; // Pending
    try {
        // Handle Firestore Timestamp (has .toDate()) or standard JS Date
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        if (isNaN(date.getTime())) return '';
        
        return date.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: false 
        });
    } catch (e) {
        return '';
    }
  };

  const timeString = formatTime(msg.createdAt);

  // System Message Rendering
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

  const scrollToMessage = (id: string) => {
      const el = document.getElementById(`msg-${id}`);
      if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Highlight effect
          const bubble = el.querySelector('.chat-bubble');
          if (bubble) {
              bubble.classList.add('ring-2', 'ring-offset-2', 'ring-blue-400');
              setTimeout(() => {
                  bubble.classList.remove('ring-2', 'ring-offset-2', 'ring-blue-400');
              }, 1500);
          }
      }
  };

  const handleFileDownload = async (e: React.MouseEvent, url: string, filename: string) => {
    e.stopPropagation();
    e.preventDefault();
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
        console.error('Download failed', error);
        window.open(url, '_blank');
    }
  };

  const renderContent = (text: string) => {
    if (!text) return null;

    const ytId = getYouTubeId(text);
    // Regex for parsing URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    // Identify the first non-YouTube URL to show a preview card for
    const matches = text.match(urlRegex);
    let previewUrl: string | null = null;
    
    if (matches && !ytId) {
        // Use the first link found for preview
        previewUrl = matches[0];
    }

    return (
        <div className="flex flex-col gap-2 w-full min-w-0">
            {/* Render text with clickable links */}
            <span className="leading-relaxed whitespace-pre-wrap break-words break-all">
                {parts.map((part, i) => {
                    if (part.match(urlRegex)) {
                        return (
                            <a 
                                key={i} 
                                href={part} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="underline text-inherit opacity-90 break-all hover:opacity-100"
                            >
                                {part}
                            </a>
                        );
                    }
                    return part;
                })}
            </span>

            {/* YouTube Embed - Responsive Width */}
            {ytId && (
               <div className="relative w-[260px] sm:w-[320px] md:w-[400px] max-w-full aspect-video rounded-lg overflow-hidden shadow-md bg-black/5 mt-1">
                    <iframe
                        className="absolute inset-0 w-full h-full"
                        src={`https://www.youtube.com/embed/${ytId}`}
                        title="YouTube video player"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                    ></iframe>
               </div>
            )}

            {/* General Link Preview (OG Data) */}
            {previewUrl && <LinkPreview url={previewUrl} />}
        </div>
    );
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) return <FileText size={20} />;
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('7z') || mimeType.includes('compressed')) return <FileArchive size={20} />;
    if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('html') || mimeType.includes('css') || mimeType.includes('xml')) return <FileCode size={20} />;
    if (mimeType.includes('text/')) return <FileText size={20} />;
    if (mimeType.includes('video/')) return <FileVideo size={20} />;
    return <File size={20} />;
  };

  const renderAttachment = () => {
    if (!msg.attachment) return null;

    const { url, name, type, size } = msg.attachment;
    const sizeKB = (size / 1024).toFixed(1);

    // 1. Image Handler
    if (type.startsWith('image/')) {
        return (
            <div className="mt-2 mb-1 group/image relative inline-block">
                <div 
                    className="relative overflow-hidden rounded-xl border border-white/10 bg-black/5 dark:bg-white/5 cursor-pointer"
                    onClick={() => onPreview(url, name, type)}
                >
                    <img 
                        src={url} 
                        alt={name} 
                        loading="lazy"
                        className="max-w-full max-h-[300px] w-auto object-contain block" 
                    />
                    
                    {/* Centered Glassmorphism Control Pill */}
                    <div className="absolute inset-0 flex items-center justify-center transition-all duration-200 opacity-100 md:opacity-0 md:group-hover/image:opacity-100 bg-black/0 md:group-hover/image:bg-black/10">
                        <div 
                            className="flex items-center gap-2 p-2 bg-black/60 backdrop-blur-md rounded-full shadow-xl border border-white/20 transform scale-100 hover:scale-105 transition-transform"
                            onClick={(e) => e.stopPropagation()} 
                        >
                            <button 
                                onClick={() => onPreview(url, name, type)}
                                className="p-2 text-white hover:bg-white/20 rounded-full transition-colors active:scale-95"
                                title="Preview"
                            >
                                <Eye size={20} />
                            </button>
                            
                            <div className="w-px h-5 bg-white/30"></div>

                            <button 
                                onClick={(e) => handleFileDownload(e, url, name)}
                                className="p-2 text-white hover:bg-white/20 rounded-full transition-colors active:scale-95"
                                title="Download"
                            >
                                <Download size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // 2. Video Handler - Similar to Image but with Video features
    if (type.startsWith('video/')) {
        return (
            <div className="mt-2 mb-1 group/video relative inline-block">
                <div 
                    className="relative overflow-hidden rounded-xl border border-white/10 bg-black dark:bg-black/90 cursor-pointer"
                    onClick={() => onPreview(url, name, type)}
                >
                    <video 
                        src={`${url}#t=0.001`} 
                        preload="metadata"
                        playsInline
                        muted
                        className="max-w-full max-h-[300px] w-auto object-contain block pointer-events-none" 
                    />
                    
                    {/* Centered Glassmorphism Control Pill */}
                    <div className="absolute inset-0 flex items-center justify-center transition-all duration-200 bg-black/10">
                        <div 
                            className="flex items-center gap-2 p-2 bg-black/60 backdrop-blur-md rounded-full shadow-xl border border-white/20 transform scale-100 hover:scale-105 transition-transform opacity-100 md:opacity-0 md:group-hover/video:opacity-100"
                            onClick={(e) => e.stopPropagation()} 
                        >
                            <button 
                                onClick={() => onPreview(url, name, type)}
                                className="p-2 text-white hover:bg-white/20 rounded-full transition-colors active:scale-95"
                                title="Play Video"
                            >
                                <Play size={20} fill="currentColor" />
                            </button>
                            
                            <div className="w-px h-5 bg-white/30"></div>

                            <button 
                                onClick={(e) => handleFileDownload(e, url, name)}
                                className="p-2 text-white hover:bg-white/20 rounded-full transition-colors active:scale-95"
                                title="Download"
                            >
                                <Download size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // 3. Audio/Voice Message Handler
    if (type.startsWith('audio/')) {
        return (
            <div className="mt-2 mb-1 w-full max-w-full">
                <div className={`rounded-xl p-1 ${isMe ? 'bg-white/10 border border-white/20' : 'bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600'}`}>
                    <AudioPlayer src={url} isMe={isMe} />
                </div>
            </div>
        );
    }

    // 4. Generic File Handler
    return (
        <a 
            href={url} 
            download={name}
            className={`flex items-center gap-3 p-3 mt-2 rounded-xl border transition-all group/file
            ${isMe 
                ? 'bg-white/10 border-white/20 hover:bg-white/20 text-white' 
                : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'}`}
        >
            <div className={`p-2.5 rounded-lg flex-shrink-0 transition-colors
                ${isMe ? 'bg-white/20 text-blue-100' : 'bg-blue-100 dark:bg-slate-600 text-blue-600 dark:text-blue-300'}`}>
                {getFileIcon(type)}
            </div>
            
            <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-semibold truncate leading-tight">{name}</span>
                <span className={`text-[10px] uppercase tracking-wider mt-0.5 ${isMe ? 'text-blue-100/70' : 'text-slate-400 dark:text-slate-400'}`}>
                    {sizeKB} KB • {type.split('/')[1]?.split(';')[0].toUpperCase() || 'FILE'}
                </span>
            </div>
            
            <div className={`p-1.5 rounded-full transition-opacity opacity-70 group-hover/file:opacity-100
                ${isMe ? 'hover:bg-white/20' : 'hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                <Download size={18} />
            </div>
        </a>
    );
  };

  const renderLocation = () => {
      if (!msg.location) return null;
      
      const { lat, lng } = msg.location;
      const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
      
      return (
          <a 
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-col gap-2 p-1.5 rounded-xl border mt-2 transition-all group/location hover:shadow-md w-full sm:w-auto max-w-full
                ${isMe 
                    ? 'bg-white/10 border-white/20 hover:bg-white/20' 
                    : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 hover:bg-white dark:hover:bg-slate-700'}`}
          >
              <div className="relative w-full sm:w-[240px] h-[100px] sm:h-[120px] bg-slate-200 dark:bg-slate-700 rounded-lg overflow-hidden flex items-center justify-center">
                   {/* Fallback pattern since we don't have Static Maps API Key */}
                   <div className="absolute inset-0 opacity-20" style={{backgroundImage: 'radial-gradient(circle, #000 1px, transparent 1px)', backgroundSize: '10px 10px'}}></div>
                   <div className="z-10 bg-red-500 text-white p-2 rounded-full shadow-lg transform -translate-y-2">
                       <MapPin size={24} fill="currentColor" />
                   </div>
                   <div className="absolute bottom-2 left-0 right-0 text-center">
                        <span className="text-[10px] font-bold text-slate-500 bg-white/80 dark:bg-slate-900/80 dark:text-slate-300 px-2 py-0.5 rounded-full shadow-sm">
                            {lat.toFixed(4)}, {lng.toFixed(4)}
                        </span>
                   </div>
              </div>
              
              <div className={`flex items-center justify-between px-1 pb-1`}>
                  <div className="flex flex-col">
                      <span className={`text-xs font-bold ${isMe ? 'text-white' : 'text-slate-700 dark:text-slate-200'}`}>Current Location</span>
                      <span className={`text-[10px] ${isMe ? 'text-blue-100' : 'text-slate-400'}`}>Tap to view on maps</span>
                  </div>
                  <ExternalLink size={14} className={isMe ? 'text-white/70' : 'text-slate-400'} />
              </div>
          </a>
      );
  };

  return (
    <div id={`msg-${msg.id}`} className={`flex w-full mb-4 animate-in slide-in-from-bottom-2 duration-300 group ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[90%] md:max-w-[70%] ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 relative`}>
        
        {/* Avatar */}
        <img 
            src={msg.avatarURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.username)}&background=${isMe ? '3b82f6' : '64748b'}&color=fff&rounded=true`}
            alt={msg.username}
            loading="lazy"
            className="w-8 h-8 rounded-full shadow-sm object-cover border-2 border-white dark:border-slate-700 select-none bg-slate-200 dark:bg-slate-700"
        />

        {/* Vertical Actions Stack (Reply, React, Edit, Delete) */}
        <div className={`flex flex-col gap-1 items-center self-end mb-1 ${isMe ? 'mr-0.5' : 'ml-0.5'}`}>
             
             {/* Reply Button - Always visible on mobile, hover only on desktop */}
             <button
                onClick={() => onReply(msg)}
                className={`p-1 text-slate-400 hover:text-blue-500 rounded-full transition-all ${showReactions ? 'opacity-0 pointer-events-none' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}
                title="Reply"
             >
                <Reply size={16} />
             </button>

             {/* Reaction Button - Always visible on mobile, hover only on desktop */}
             <div className="relative">
                 <button 
                    onClick={() => setShowReactions(!showReactions)}
                    className={`p-1 text-slate-400 hover:text-orange-500 rounded-full transition-all ${showReactions ? 'opacity-100 text-orange-500 bg-orange-50' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}
                    title="React"
                 >
                    <SmilePlus size={16} />
                 </button>
                 
                 {/* Backdrop */}
                 {showReactions && (
                    <div className="fixed inset-0 z-40" onClick={() => setShowReactions(false)} />
                 )}
                 
                 {/* Reaction Popover */}
                 {showReactions && (
                    <div className={`absolute bottom-0 ${isMe ? 'right-8' : 'left-8'} flex gap-1 bg-white dark:bg-slate-800 p-1.5 rounded-full shadow-xl border border-slate-100 dark:border-slate-700 z-50 animate-in zoom-in-95 duration-200 w-max`}>
                        {QUICK_REACTIONS.map(emoji => (
                            <button
                                key={emoji}
                                onClick={() => { onReact(msg, emoji); setShowReactions(false); }}
                                className="w-8 h-8 flex items-center justify-center text-lg hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition hover:scale-125"
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>
                 )}
             </div>

             {/* Edit Button (Directly exposed for 'Me') */}
             {isMe && (
                <button 
                    onClick={() => onEdit(msg)}
                    className={`p-1 text-slate-400 hover:text-blue-500 rounded-full transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100`}
                    title="Edit"
                >
                    <Edit2 size={16} />
                </button>
             )}

             {/* Delete Button (Directly exposed for 'Me') */}
             {isMe && (
                <button 
                    onClick={() => onRequestDelete(msg.id)}
                    className={`p-1 text-slate-400 hover:text-red-500 rounded-full transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100`}
                    title="Delete"
                >
                    <Trash2 size={16} />
                </button>
             )}
        </div>

        {/* Bubble */}
        <div className={`chat-bubble
                relative px-4 py-2.5 rounded-2xl shadow-sm text-sm md:text-base min-w-0 transition-all
                ${isMe 
                    ? 'bg-blue-600 text-white rounded-br-none shadow-blue-500/20' 
                    : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-none shadow-slate-200 dark:shadow-none border border-slate-100 dark:border-slate-700'}
            `}>
                {!isMe && <p className="text-[10px] font-bold text-slate-400 mb-0.5 tracking-wide select-none">{msg.username}</p>}
                
                {/* Reply Context */}
                {msg.replyTo && (
                    <div 
                        onClick={() => scrollToMessage(msg.replyTo!.id)}
                        className={`mb-2 p-2 rounded cursor-pointer opacity-90 hover:opacity-100 transition border-l-[3px]
                            ${isMe ? 'bg-black/10 border-white/40' : 'bg-slate-100 dark:bg-slate-700 border-blue-400'}`}
                    >
                        <span className={`text-xs font-bold block mb-0.5 ${isMe ? 'text-blue-100' : 'text-blue-600 dark:text-blue-400'}`}>
                            {msg.replyTo.username}
                        </span>
                        <p className={`text-xs truncate max-w-[200px] opacity-80 ${isMe ? 'text-white' : 'text-slate-600 dark:text-slate-300'}`}>
                            {msg.replyTo.isAttachment ? '📎 Attachment' : msg.replyTo.text}
                        </p>
                    </div>
                )}

                {/* Attachment Display */}
                {renderAttachment()}

                {/* Location Display */}
                {renderLocation()}

                {/* Text Display */}
                {msg.text && (
                    <div className={`leading-relaxed whitespace-pre-wrap break-words break-all ${(msg.attachment || msg.location) ? 'mt-2 pt-2 border-t ' + (isMe ? 'border-white/20' : 'border-slate-100 dark:border-slate-700') : ''}`}>
                        {renderContent(msg.text)}
                    </div>
                )}

                {/* Timestamp & Edit Indicator */}
                <div className={`flex items-center justify-end gap-1 mt-1 select-none ${isMe ? 'text-blue-200' : 'text-slate-400 dark:text-slate-500'}`}>
                    {msg.isEdited && <span className="text-[9px] italic opacity-80">(edited)</span>}
                    <span className="text-[10px] font-medium">{timeString}</span>
                </div>
            </div>

            {/* Reactions Display */}
            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                    {Object.entries(msg.reactions).map(([emoji, uids]) => {
                        if (uids.length === 0) return null;
                        const iReacted = uids.includes(currentUid);
                        return (
                            <button 
                                key={emoji}
                                onClick={() => onReact(msg, emoji)}
                                className={`
                                    flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs shadow-sm border transition-all hover:scale-105
                                    ${iReacted 
                                        ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-slate-800 dark:text-blue-100' 
                                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'}
                                `}
                            >
                                <span>{emoji}</span>
                                <span className={`font-semibold text-[10px] ${iReacted ? 'text-blue-600 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}>{uids.length}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
      </div>
  );
}, (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    
    // Check basic primitives
    if (prevProps.isMe !== nextProps.isMe ||
        prevProps.msg.id !== nextProps.msg.id ||
        prevProps.msg.text !== nextProps.msg.text ||
        prevProps.msg.isEdited !== nextProps.msg.isEdited) {
        return false;
    }

    // Check attachment changes
    if (prevProps.msg.attachment !== nextProps.msg.attachment) {
         if (prevProps.msg.attachment?.url !== nextProps.msg.attachment?.url ||
             prevProps.msg.attachment?.name !== nextProps.msg.attachment?.name) {
             return false;
         }
    }

    // Check location changes
    if (prevProps.msg.location !== nextProps.msg.location) {
        if (prevProps.msg.location?.lat !== nextProps.msg.location?.lat ||
            prevProps.msg.location?.lng !== nextProps.msg.location?.lng) {
            return false;
        }
    }

    // Check reactions
    if (JSON.stringify(prevProps.msg.reactions) !== JSON.stringify(nextProps.msg.reactions)) {
        return false;
    }

    // Check replyTo changes (rare but possible if we wanted to support editing replies, but simple ref check is enough usually)
    if (prevProps.msg.replyTo !== nextProps.msg.replyTo) {
        return false;
    }

    // Check timestamp
    const getSeconds = (ts: any) => {
        if (!ts) return 0;
        if (ts.seconds) return ts.seconds;
        if (ts.toMillis) return ts.toMillis();
        return 0; 
    };

    const prevSeconds = getSeconds(prevProps.msg.createdAt);
    const nextSeconds = getSeconds(nextProps.msg.createdAt);
    
    if (prevSeconds !== nextSeconds) {
        return false;
    }

    return true;
});

const MessageList: React.FC<MessageListProps> = ({ messages, currentUserUid, onEdit, onDelete, onReact, onReply }) => {
  const [previewMedia, setPreviewMedia] = useState<{url: string; name: string; type: string} | null>(null);
  const [deletingMsgId, setDeletingMsgId] = useState<string | null>(null);

  const handleMediaPreview = useCallback((url: string, name: string, type: string) => {
      setPreviewMedia({ url, name, type });
  }, []);

  const closePreview = () => setPreviewMedia(null);

  // New delete request handler
  const handleRequestDelete = useCallback((msgId: string) => {
      setDeletingMsgId(msgId);
  }, []);

  return (
    <>
        {previewMedia && (
            <MediaPreviewModal 
                src={previewMedia.url} 
                alt={previewMedia.name} 
                type={previewMedia.type}
                onClose={closePreview} 
            />
        )}
        
        {deletingMsgId && (
            <DeleteToast
                onConfirm={() => {
                    onDelete(deletingMsgId);
                    setDeletingMsgId(null);
                }}
                onCancel={() => setDeletingMsgId(null)}
            />
        )}

        <div className="flex flex-col justify-end min-h-full pb-2">
        {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 dark:text-slate-500 opacity-60">
                <p>No messages yet.</p>
                <p className="text-xs">Say hello! 👋</p>
            </div>
        ) : (
            messages.map((msg) => (
            <MessageItem 
                key={msg.id} 
                msg={msg} 
                isMe={msg.uid === currentUserUid}
                currentUid={currentUserUid}
                onEdit={onEdit}
                onRequestDelete={handleRequestDelete} // New prop for toast trigger
                onReact={onReact}
                onReply={onReply}
                onPreview={handleMediaPreview}
            />
            ))
        )}
        </div>
    </>
  );
};

export default MessageList;
