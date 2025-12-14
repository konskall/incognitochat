
import React, { useRef, useState, useEffect } from 'react';
import { Send, Paperclip, MapPin, Smile, Mic, Trash2, X, Image as ImageIcon, FileText, Edit2, FileVideo, FileArchive } from 'lucide-react';
import EmojiPicker from './EmojiPicker';
import { compressImage } from '../utils/helpers';
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
  
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
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
}

const MAX_FILE_SIZE = 40 * 1024 * 1024; // 40MB

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
  selectedFile,
  setSelectedFile,
  isUploading,
  isGettingLocation,
  handleSendLocation,
  editingMessageId,
  cancelEdit,
  replyingTo,
  cancelReply,
  isOffline,
  isRoomReady,
  typingUsers
}) => {
  const [showEmoji, setShowEmoji] = useState(false);
  
  // Simple boolean state for stacking: False = Horizontal (Row), True = Vertical (Stack)
  const [isStacked, setIsStacked] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEmojiSelect = (emoji: string) => {
      setInputText(prev => prev + emoji);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      let file = e.target.files[0];
      
      if (file.size > MAX_FILE_SIZE) {
        if (file.type.startsWith('image/')) {
            const confirmCompress = window.confirm(
                `Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Compress to under 40MB?`
            );
            
            if (confirmCompress) {
                try {
                    const compressed = await compressImage(file);
                    if (compressed.size > MAX_FILE_SIZE) {
                         alert(`Still too large after compression (${(compressed.size/1024/1024).toFixed(1)}MB). Please choose a smaller image.`);
                         if (fileInputRef.current) fileInputRef.current.value = '';
                         return;
                    }
                    file = compressed;
                } catch (error) {
                    console.error("Compression failed:", error);
                    alert("Failed to compress image.");
                    if (fileInputRef.current) fileInputRef.current.value = '';
                    return;
                }
            } else {
                if (fileInputRef.current) fileInputRef.current.value = '';
                return;
            }
        } else {
            alert(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max size is 40MB.`);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }
      }
      setSelectedFile(file);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
     if (textareaRef.current && (editingMessageId || replyingTo)) {
         textareaRef.current.focus();
     }
  }, [editingMessageId, replyingTo]);

  // Layout Logic:
  // 1 line ~ 48px
  // 4 lines ~ 120px
  // 5 lines ~ 144px
  // We want to trigger vertical stack ONLY when we hit the 5th line.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto'; 
      
      const maxHeight = 200; 
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(scrollHeight, maxHeight);
      
      textarea.style.height = `${newHeight}px`;
      textarea.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';

      // Threshold set to 130px.
      // This ensures we stay horizontal for 1, 2, 3, 4 lines (<= 120px)
      // And switch to vertical only when we enter the 5th line (>= 144px)
      const threshold = 130;

      if (!isStacked) {
          if (newHeight > threshold) setIsStacked(true);
      } else {
          // Hysteresis: switch back to row only if we drop cleanly below the threshold
          if (newHeight < (threshold - 10)) setIsStacked(false);
      }
    }
  }, [inputText, isStacked]);

  const getFileIcon = (type: string) => {
      if (type.startsWith('image/')) return <ImageIcon size={20}/>;
      if (type.startsWith('video/')) return <FileVideo size={20}/>;
      if (type.includes('zip') || type.includes('rar') || type.includes('compressed') || type.includes('tar') || type.includes('7z')) return <FileArchive size={20}/>;
      return <FileText size={20}/>;
  };

  return (
      <footer className="bg-white dark:bg-slate-950 p-2 sm:p-3 border-t border-slate-200 dark:border-slate-800 shadow-lg z-20 relative pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex flex-col items-center justify-center transition-colors">
         {/* Typing Indicator */}
         {typingUsers.length > 0 && (
             <div className="absolute -top-7 left-6 text-xs text-slate-500 dark:text-slate-400 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-3 py-1 rounded-full shadow-sm animate-pulse flex items-center gap-1.5 border border-slate-100 dark:border-slate-800">
                 <span className="flex gap-0.5">
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span>
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
                 </span>
                 <span className="font-medium italic">
                    {typingUsers.length === 1 
                        ? `${typingUsers[0]} is typing...` 
                        : `${typingUsers.length} people are typing...`}
                 </span>
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

         <div className="relative flex flex-col items-center w-full max-w-5xl mx-auto gap-2">
             {/* File Preview Bubble */}
             {selectedFile && !editingMessageId && (
               <div className="flex items-center gap-3 p-2 bg-blue-50 dark:bg-slate-800 border border-blue-100 dark:border-slate-700 rounded-xl w-fit animate-in slide-in-from-bottom-2 self-start mb-1">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-blue-500 dark:text-blue-400">
                    {getFileIcon(selectedFile.type)}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 max-w-[150px] truncate">{selectedFile.name}</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button onClick={clearFile} className="p-1 hover:bg-blue-200 dark:hover:bg-slate-600 rounded-full text-slate-500 transition">
                    <X size={16} />
                  </button>
               </div>
             )}

            {isRecording ? (
                 // --- RECORDING STATE ---
                 <div className="flex items-center justify-between w-full px-2 py-2 gap-3 animate-in fade-in duration-200 bg-slate-100 dark:bg-slate-900 rounded-full">
                     <div className="flex items-center gap-3 flex-1 pl-2">
                        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
                        <span className="text-red-500 font-mono font-medium">{formatDuration(recordingDuration)}</span>
                        <span className="text-slate-400 text-xs hidden sm:inline">Recording audio...</span>
                     </div>
                     
                     <div className="flex items-center gap-2">
                         <button
                            onClick={cancelRecording}
                            className="p-2 text-slate-500 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition"
                            title="Cancel"
                         >
                             <Trash2 size={20} />
                         </button>
                         <button
                            onClick={stopRecording}
                            className="w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition transform active:scale-95"
                            title="Send"
                         >
                             <Send size={18} className="ml-0.5" />
                         </button>
                     </div>
                 </div>
            ) : (
                // --- DEFAULT INPUT STATE ---
                <div className="flex items-end gap-2 w-full">
                     {showEmoji && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />}
                     
                     <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar,.7z,.tar"
                     />

                     {/* The Input Bar Container */}
                     <div className="flex-1 relative flex items-end bg-slate-100 dark:bg-slate-800/80 rounded-[24px] border border-transparent focus-within:border-blue-500/30 focus-within:bg-white dark:focus-within:bg-slate-900 transition-all duration-200">
                         
                         <textarea
                            ref={textareaRef}
                            value={inputText}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            rows={1}
                            placeholder={selectedFile ? "Add caption..." : (editingMessageId ? "Edit message..." : "Message...")}
                            className={`w-full bg-transparent border-0 rounded-[24px] pl-4 py-3 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:ring-0 resize-none leading-6 text-base max-h-[200px] min-h-[48px] transition-[padding] duration-300 ease-out ${
                                editingMessageId ? 'pr-[44px]' : (isStacked ? 'pr-[44px]' : 'pr-[110px]')
                            }`}
                         />

                         {/* Icons Container */}
                         <div 
                            className={`absolute right-1 bottom-1 pb-1 transition-all duration-300 ease-out flex gap-0.5 ${
                                isStacked 
                                    ? 'flex-col-reverse w-[40px] items-center' 
                                    : 'flex-row-reverse w-[110px] items-end'
                            }`}
                         >
                             {/* 1. Emoji (Always Visible - Bottom/Right) */}
                             <button 
                                onClick={() => setShowEmoji(!showEmoji)}
                                className={`p-2 rounded-full transition-colors flex-shrink-0 ${showEmoji ? 'text-blue-500' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                             >
                                 <Smile size={20} />
                             </button>

                             {/* 2. & 3. Location & Attachment (Hidden when editing) */}
                             {!editingMessageId && (
                                <>
                                    <button 
                                        onClick={handleSendLocation}
                                        disabled={isGettingLocation}
                                        className={`p-2 rounded-full transition-colors flex-shrink-0 ${isGettingLocation ? 'animate-pulse text-red-400' : 'text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                        title="Location"
                                    >
                                        <MapPin size={20} />
                                    </button>

                                    <button 
                                        onClick={() => fileInputRef.current?.click()}
                                        className={`p-2 rounded-full transition-colors flex-shrink-0 ${selectedFile ? 'text-blue-500' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                        title="Attach File"
                                    >
                                        <Paperclip size={20} />
                                    </button>
                                </>
                             )}
                         </div>
                     </div>
                     
                     {/* Send/Mic Button Outside */}
                     <div className="flex-shrink-0 pb-0.5">
                         {(!inputText.trim() && !selectedFile && !editingMessageId && !isUploading) ? (
                            <button 
                                 onClick={startRecording}
                                 className="w-11 h-11 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full flex items-center justify-center transition-all"
                                 title="Record"
                            >
                                 <Mic size={24} />
                            </button>
                         ) : (
                             <button 
                                onClick={() => handleSend()}
                                disabled={isOffline || isUploading || !isRoomReady}
                                className="w-11 h-11 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-full shadow-lg shadow-blue-500/30 transition-all transform active:scale-95 flex items-center justify-center"
                             >
                                 {isUploading ? (
                                     <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                 ) : (
                                     <Send size={20} className="ml-0.5" />
                                 )}
                             </button>
                         )}
                     </div>
                </div>
            )}
         </div>
      </footer>
  );
};

export default ChatInput;
