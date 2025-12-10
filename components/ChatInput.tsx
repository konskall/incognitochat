
import React, { useRef, useState, useEffect } from 'react';
import { Send, Paperclip, MapPin, Smile, Mic, Trash2, X, Image as ImageIcon, FileText, Edit2 } from 'lucide-react';
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

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

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
                `Image is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Compress to under 10MB?`
            );
            
            if (confirmCompress) {
                // Ideally, parent should handle "isUploading" state during compression too, 
                // but for UI simplicity we just await here.
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
            alert(`File is too large. Max size is 10MB.`);
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

  return (
      <footer className="bg-white dark:bg-slate-900 p-1.5 border-t border-slate-200 dark:border-slate-800 shadow-lg z-20 relative pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex flex-col items-center justify-center transition-colors">
         {typingUsers.length > 0 && (
             <div className="absolute -top-6 left-6 text-xs text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-900/80 backdrop-blur px-2 py-0.5 rounded-t-lg animate-pulse flex items-center gap-1">
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

         <div className="relative flex flex-col items-center w-full max-w-4xl mx-auto">
             {selectedFile && !editingMessageId && (
               <div className="flex items-center gap-3 p-2 bg-blue-50 dark:bg-slate-800 border border-blue-100 dark:border-slate-700 rounded-xl w-fit animate-in slide-in-from-bottom-2 mb-2 self-start">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-blue-500 dark:text-blue-400">
                    {selectedFile.type.startsWith('image/') ? <ImageIcon size={20}/> : <FileText size={20}/>}
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
                        className="w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition transform active:scale-95"
                        title="Send Voice Message"
                     >
                         <Send size={20} className="ml-0.5" />
                     </button>
                 </div>
            ) : (
                <div className="flex items-center gap-1.5 sm:gap-2 w-full">
                     {showEmoji && <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmoji(false)} />}
                     
                     <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                        accept="image/*,.pdf,.doc,.docx,.txt"
                     />
                     {!editingMessageId && (
                        <>
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition flex-shrink-0 ${selectedFile ? 'text-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-800'}`}
                                title="Attach File"
                            >
                                <Paperclip size={22} />
                            </button>
                            <button 
                                onClick={handleSendLocation}
                                disabled={isGettingLocation}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition flex-shrink-0 ${isGettingLocation ? 'animate-pulse text-red-400' : 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'}`}
                                title="Share Location"
                            >
                                <MapPin size={22} />
                            </button>
                        </>
                     )}

                     <button 
                        onClick={() => setShowEmoji(!showEmoji)}
                        className="w-10 h-10 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-full flex items-center justify-center transition flex-shrink-0"
                     >
                         <Smile size={22} />
                     </button>

                     <div className="flex-1 relative min-w-0 flex items-center">
                         <textarea
                            ref={textareaRef}
                            value={inputText}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            rows={1}
                            placeholder={selectedFile ? "Add caption..." : (editingMessageId ? "Edit..." : "Message...")}
                            className="w-full bg-slate-100 dark:bg-slate-800 border-0 rounded-2xl px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-slate-100 transition-all outline-none resize-none leading-6 text-base block"
                            style={{ minHeight: '44px' }}
                         />
                     </div>
                     
                     {(!inputText.trim() && !selectedFile && !editingMessageId) ? (
                        <button 
                             onClick={startRecording}
                             className="w-10 h-10 text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full flex items-center justify-center transition flex-shrink-0"
                             title="Record Voice Message"
                        >
                             <Mic size={22} />
                        </button>
                     ) : (
                         <button 
                            onClick={() => handleSend()}
                            disabled={isOffline || isUploading || !isRoomReady}
                            className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-full shadow-lg shadow-blue-500/30 transition-all transform active:scale-95 flex items-center justify-center flex-shrink-0"
                         >
                             {isUploading ? (
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
