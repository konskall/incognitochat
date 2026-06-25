
import React, { useRef, useState, useEffect } from 'react';
import { Send, Paperclip, MapPin, Smile, Mic, Trash2, X, Image as ImageIcon, FileText, Edit2, FileVideo, FileArchive, BarChart3, Plus } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import AttachmentSheet, { SheetAction } from './AttachmentSheet';
import { compressImage } from '../utils/helpers';
import { MAX_FILES_PER_SEND } from '../utils/entitlements';
import { flashToast } from '../utils/toast';
import { Message } from '../types';

interface ChatInputProps {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  handleSend: (e?: React.FormEvent) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  
  isRecording: boolean;
  recordingDuration: number;
  startRecording: () => void;
  stopRecording: () => void;
  cancelRecording: () => void;
  
  selectedFiles: File[];
  setSelectedFiles: (files: File[]) => void;
  canMultiUpload: boolean;
  uploadProgress?: { current: number; total: number } | null;
  isUploading: boolean;
  
  isGettingLocation: boolean;
  handleSendLocation: () => void;
  
  editingMessageId: string | null;
  cancelEdit: () => void;
  
  replyingTo: Message | null;
  cancelReply: () => void;
  
  isOffline: boolean;
  isRoomReady: boolean;

  typingUsers: string[];

  onOpenPoll: () => void;

  // Tier-derived upload cap (bytes); enforced in handleFileSelect.
  maxFileBytes?: number;

  // Remaining sends today in this room (display-only). null = unlimited / unknown.
  quotaLeft?: number | null;
}

const ChatInput: React.FC<ChatInputProps> = ({
  inputText,
  setInputText,
  handleSend,
  handleInputChange,
  handleKeyDown,
  isRecording,
  recordingDuration,
  startRecording,
  stopRecording,
  cancelRecording,
  selectedFiles,
  setSelectedFiles,
  canMultiUpload,
  uploadProgress,
  isUploading,
  isGettingLocation,
  handleSendLocation,
  editingMessageId,
  cancelEdit,
  replyingTo,
  cancelReply,
  isOffline,
  isRoomReady,
  typingUsers,
  onOpenPoll,
  maxFileBytes,
  quotaLeft,
}) => {
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Actions inside the Viber-style "+" sheet.
  const attachActions: SheetAction[] = [
    {
      key: 'file',
      label: 'File',
      icon: <Paperclip size={24} />,
      onClick: () => fileInputRef.current?.click(),
      tileClass: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    },
    {
      key: 'location',
      label: 'Location',
      icon: <MapPin size={24} />,
      onClick: handleSendLocation,
      disabled: isGettingLocation,
      tileClass: 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400',
    },
    {
      key: 'poll',
      label: 'Poll',
      icon: <BarChart3 size={24} />,
      onClick: onOpenPoll,
      tileClass: 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
    },
  ];

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEmojiSelect = (emoji: string) => {
      setInputText(prev => prev + emoji);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Reset NOW so re-picking the same file(s) fires change again. iOS names
    // every camera/library capture "image.jpg", so without this the 2nd pick
    // silently no-ops.
    e.target.value = '';
    if (picked.length === 0) return;

    const limitBytes = maxFileBytes ?? 40 * 1024 * 1024;
    const limitMb = Math.round(limitBytes / (1024 * 1024));
    const accepted: File[] = [];
    const tooBig: string[] = [];

    for (let f of picked) {
      // Always downscale/compress images (GIFs skipped so animation survives).
      if (f.type.startsWith('image/') && f.type !== 'image/gif') {
        try { f = await compressImage(f); } catch (err) { console.error('Compression failed, sending original:', err); }
      }
      if (f.size > limitBytes) { tooBig.push(f.name); continue; }
      accepted.push(f);
    }

    // Accumulate across picks, then clamp to the per-send ceiling.
    const merged = [...selectedFiles, ...accepted];
    const clamped = merged.slice(0, MAX_FILES_PER_SEND);
    const droppedForCap = merged.length - clamped.length;

    setSelectedFiles(clamped);

    if (tooBig.length || droppedForCap > 0) {
      const parts: string[] = [];
      if (tooBig.length) parts.push(`${tooBig.length} file(s) over ${limitMb}MB were skipped.`);
      if (droppedForCap > 0) parts.push(`You can attach up to ${MAX_FILES_PER_SEND} files at once.`);
      flashToast(parts.join(' '));
    }
  };

  const removeFileAt = (idx: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== idx));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Focus textarea when editing/replying
  useEffect(() => {
     if (textareaRef.current && (editingMessageId || replyingTo)) {
         textareaRef.current.focus();
     }
  }, [editingMessageId, replyingTo]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // We reset the height to 'auto' to correctly calculate the new scrollHeight
      // This allows the textarea to shrink when text is deleted
      textarea.style.height = 'auto'; 
      
      const maxHeight = 300; // Allow up to 300px height (approx 15 lines) before scrolling
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      
      textarea.style.height = `${newHeight}px`;
      
      // Show scrollbar only if we hit the max height
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }, [inputText]);

  const getFileIcon = (type: string) => {
      if (type.startsWith('image/')) return <ImageIcon size={20}/>;
      if (type.startsWith('video/')) return <FileVideo size={20}/>;
      if (type.includes('zip') || type.includes('rar') || type.includes('compressed') || type.includes('tar') || type.includes('7z')) return <FileArchive size={20}/>;
      return <FileText size={20}/>;
  };

  // Show the Inco bot distinctly ("thinking…") instead of as a human typer, and
  // don't count it toward the "N people are typing" total.
  const humanTypers = typingUsers.filter((u) => u !== 'inco');
  const botTyping = humanTypers.length !== typingUsers.length;
  let typingLabel = '';
  if (humanTypers.length >= 2) typingLabel = `${humanTypers.length} people are typing…`;
  else if (humanTypers.length === 1) typingLabel = `${humanTypers[0]} is typing…`;
  if (botTyping) typingLabel = typingLabel ? `${typingLabel} · Inco is thinking…` : 'Inco is thinking…';

  // Composer actions that ultimately write to the server must be disabled while
  // offline / before the room is ready, matching the Send button — otherwise an
  // attach/record/poll started offline fails silently.
  const actionsDisabled = isOffline || !isRoomReady;

  return (
      <footer className="bg-white dark:bg-slate-900 p-1.5 border-t border-slate-200 dark:border-slate-800 shadow-lg z-20 relative pb-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-col items-center justify-center transition-colors">
         {typingLabel && (
             <div className="absolute -top-6 left-6 text-xs text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-900/80 backdrop-blur px-2 py-0.5 rounded-t-lg animate-pulse flex items-center gap-1">
                 <span className="flex gap-0.5">
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span>
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
                 </span>
                 <span className="font-medium italic">{typingLabel}</span>
             </div>
         )}

         {!typingLabel && quotaLeft != null && quotaLeft <= 5 && (
           <div className={`absolute -top-6 right-6 text-xs px-2 py-0.5 rounded-t-lg backdrop-blur bg-white/80 dark:bg-slate-900/80 ${quotaLeft === 0 ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
             {quotaLeft === 0 ? 'Daily limit reached' : `${quotaLeft} message${quotaLeft === 1 ? '' : 's'} left today`}
           </div>
         )}

         {/* Edit Banner */}
         {editingMessageId && (
            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-t-xl border-t border-l border-r border-blue-100 dark:border-blue-800 mb-2 animate-in slide-in-from-bottom-2 w-full max-w-4xl">
                <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <Edit2 size={16} />
                    <span className="text-sm font-semibold">Editing message</span>
                </div>
                <button onClick={cancelEdit} className="p-1 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-full text-slate-500 dark:text-slate-400">
                    <X size={16} />
                </button>
            </div>
         )}

         {/* Reply Banner */}
         {replyingTo && (
            <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800 px-4 py-2 rounded-t-xl border-t border-l border-r border-slate-200 dark:border-slate-700 mb-2 animate-in slide-in-from-bottom-2 w-full max-w-4xl">
                <div className="flex flex-col border-l-4 border-blue-500 pl-2">
                    <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Replying to {replyingTo.username}</span>
                    <span className="text-sm text-slate-600 dark:text-slate-300 truncate max-w-[200px]">
                        {replyingTo.attachment ? '📎 Attachment' : replyingTo.text}
                    </span>
                </div>
                <button onClick={cancelReply} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-500 dark:text-slate-400">
                    <X size={16} />
                </button>
            </div>
         )}

         <div className="relative flex flex-col items-center w-full max-w-4xl mx-auto">
             {selectedFiles.length > 0 && !editingMessageId && (
               <div className="flex items-center gap-2 mb-2 w-full overflow-x-auto pb-1 self-start">
                  {selectedFiles.map((file, idx) => (
                    <div key={`${file.name}-${file.size}-${idx}`} className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-slate-800 border border-blue-100 dark:border-slate-700 rounded-xl shrink-0 animate-in slide-in-from-bottom-2">
                       <div className="w-9 h-9 bg-blue-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-blue-500 dark:text-blue-400">
                         {getFileIcon(file.type)}
                       </div>
                       <div className="flex flex-col">
                         <span className="text-xs font-bold text-slate-700 dark:text-slate-200 max-w-[120px] truncate">{file.name}</span>
                         <span className="text-[10px] text-slate-500 dark:text-slate-400">{(file.size / 1024).toFixed(1)} KB</span>
                       </div>
                       <button onClick={() => removeFileAt(idx)} className="p-1 hover:bg-blue-200 dark:hover:bg-slate-600 rounded-full text-slate-500 transition" aria-label={`Remove ${file.name}`}>
                         <X size={16} />
                       </button>
                    </div>
                  ))}
               </div>
             )}

            {isRecording ? (
                 <div className="flex items-center justify-between w-full px-2 py-1 gap-2 animate-in fade-in duration-200">
                     <button
                        onClick={cancelRecording}
                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition"
                        title="Cancel Recording"
                     >
                         <Trash2 size={24} />
                     </button>
                     
                     <div className="flex items-center gap-2 text-red-500 font-mono text-sm bg-red-50 dark:bg-red-900/20 px-4 py-2 rounded-full animate-pulse">
                         <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                         <span>{formatDuration(recordingDuration)}</span>
                     </div>

                     <button
                        onClick={stopRecording}
                        disabled={isOffline || !isRoomReady}
                        className="w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500"
                        title={isOffline ? "Can’t send while offline — keep recording or cancel" : 'Send Voice Message'}
                     >
                         <Send size={20} className="ml-0.5" />
                     </button>
                 </div>
            ) : (
                <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                     {showEmoji && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />}
                     <AttachmentSheet show={showAttach} onClose={() => setShowAttach(false)} actions={attachActions} />
                     
                     <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        multiple={canMultiUpload}
                        className="hidden"
                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar,.7z,.tar"
                     />
                     {!editingMessageId && (
                        <button
                            onClick={() => setShowAttach(true)}
                            disabled={actionsDisabled}
                            aria-label="Add attachment"
                            aria-expanded={showAttach}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${selectedFiles.length > 0 || showAttach ? 'text-blue-500 bg-blue-50 dark:bg-slate-800' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-800'}`}
                            title={actionsDisabled ? 'Unavailable offline' : 'Attach'}
                        >
                            <Plus size={24} className={`transition-transform duration-200 ${showAttach ? 'rotate-45' : ''}`} />
                        </button>
                     )}

                     <div className="flex-1 relative min-w-0 flex items-end">
                         <textarea
                            ref={textareaRef}
                            value={inputText}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            rows={1}
                            placeholder={selectedFiles.length > 0 ? "Add caption..." : (editingMessageId ? "Edit..." : "Message...")}
                            className="w-full bg-slate-100 dark:bg-slate-800 border-0 rounded-2xl pl-4 pr-11 py-2.5 focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-slate-100 transition-all outline-none resize-none leading-6 text-base block"
                            style={{ minHeight: '44px' }}
                         />
                         <button
                            onClick={() => setShowEmoji(!showEmoji)}
                            aria-label="Emoji picker"
                            aria-expanded={showEmoji}
                            className="absolute right-1.5 bottom-[5px] w-9 h-9 text-slate-400 hover:text-blue-500 rounded-full flex items-center justify-center transition flex-shrink-0"
                         >
                             <Smile size={22} />
                         </button>
                     </div>
                     
                     {(!inputText.trim() && selectedFiles.length === 0 && !editingMessageId && !isUploading) ? (
                        <button
                             onClick={startRecording}
                             disabled={actionsDisabled}
                             className="w-10 h-10 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full flex items-center justify-center transition flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-500"
                             title={actionsDisabled ? 'Unavailable offline' : 'Record Voice Message'}
                        >
                             <Mic size={22} />
                        </button>
                     ) : (
                         <button
                            onClick={() => handleSend()}
                            disabled={isOffline || isUploading || !isRoomReady || !!uploadProgress || (quotaLeft === 0 && !editingMessageId)}
                            aria-label="Send message"
                            className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-full shadow-lg shadow-blue-500/30 transition-all transform active:scale-95 flex items-center justify-center flex-shrink-0"
                         >
                             {uploadProgress ? (
                                 <span className="text-[11px] font-bold tabular-nums">{uploadProgress.current}/{uploadProgress.total}</span>
                             ) : isUploading ? (
                                 <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                             ) : (
                                 <Send size={20} className="ml-0.5" />
                             )}
                         </button>
                     )}
                 </div>
            )}
         </div>
      </footer>
  );
};

export default ChatInput;
