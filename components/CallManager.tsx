
import React, { useEffect, useRef, useState } from 'react';
import { Phone, Video, Mic, MicOff, PhoneOff, X, User as UserIcon, Crown, VideoOff, RotateCcw, Signal, Clock, Volume2, VolumeX, Wand2 } from 'lucide-react';
import { User, ChatConfig, Presence } from '../types';
import { useWebRTC } from '../hooks/useWebRTC';
import { VoiceFilterType } from '../hooks/useVoiceFilter';

interface CallManagerProps {
  user: User;
  config: ChatConfig;
  users: Presence[]; 
  onCloseParticipants: () => void;
  showParticipants: boolean;
  roomCreatorId?: string | null;
}

const CallManager: React.FC<CallManagerProps> = ({ user, config, users, onCloseParticipants, showParticipants, roomCreatorId }) => {
  
  const {
      status,
      callType,
      incomingCall,
      remoteDetails,
      localStream,
      remoteStream,
      isMuted,
      isVideoOff,
      networkQuality,
      voiceFilter,
      startCall,
      answerCall,
      endCall,
      handleReject,
      toggleMute,
      toggleVideo,
      switchCamera,
      setVoiceFilter
  } = useWebRTC(user, config);

  const [callDuration, setCallDuration] = useState(0);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [pipPosition, setPipPosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLDivElement>(null);

  // --- Duration Timer ---
  useEffect(() => {
    let timer: any;
    if (status === 'connected') {
        setCallDuration(0);
        timer = setInterval(() => setCallDuration(p => p + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [status]);

  // --- Video Binding ---
  useEffect(() => {
     if (localVideoRef.current && localStream) {
         localVideoRef.current.srcObject = localStream;
     }
     if (remoteVideoRef.current && remoteStream) {
         remoteVideoRef.current.srcObject = remoteStream;
         remoteVideoRef.current.muted = isSpeakerMuted;
     }
  }, [localStream, remoteStream, status, isSpeakerMuted]);
  
  // Set initial PiP position
  useEffect(() => {
    if (window.innerWidth) setPipPosition({ x: window.innerWidth - 130, y: 80 });
  }, []);


  // --- Helper Functions ---
  const formatTime = (secs: number) => {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const cycleVoiceFilter = () => {
      const next: VoiceFilterType = voiceFilter === 'normal' ? 'deep' : voiceFilter === 'deep' ? 'robot' : 'normal';
      setVoiceFilter(next);
  };

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!pipRef.current) return;
    const cx = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const rect = pipRef.current.getBoundingClientRect();
    dragOffset.current = { x: cx - rect.left, y: cy - rect.top };
    isDragging.current = true;
  };

  const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const cx = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const cy = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    let nx = cx - dragOffset.current.x;
    let ny = cy - dragOffset.current.y;
    
    // Bounds
    nx = Math.max(0, Math.min(nx, window.innerWidth - 100));
    ny = Math.max(0, Math.min(ny, window.innerHeight - 150));
    
    setPipPosition({ x: nx, y: ny });
  };


  // --- Render Incoming Call Modal ---
  if (incomingCall && status === 'incoming') {
      return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-300">
              <div className="flex flex-col items-center gap-8 w-full max-w-sm text-center">
                  <div className="relative">
                      <img src={incomingCall.fromAvatar} alt="Caller" className="w-32 h-32 rounded-full object-cover border-4 border-blue-500 shadow-2xl bg-slate-200"/>
                      <div className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-30"></div>
                  </div>
                  <div>
                      <h3 className="text-3xl font-bold text-white mb-2">{incomingCall.fromName}</h3>
                      <p className="text-blue-200 font-medium animate-pulse text-lg">
                          Incoming {incomingCall.callType === 'video' ? 'Video' : 'Audio'} Call...
                      </p>
                  </div>
                  <div className="flex items-center justify-between w-full px-8 mt-4">
                      <button onClick={handleReject} className="flex flex-col items-center gap-2 group">
                          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center text-red-500 border-2 border-red-500/50 group-hover:bg-red-500 group-hover:text-white transition-all">
                              <PhoneOff size={32} />
                          </div>
                          <span className="text-sm text-slate-400 font-medium">Decline</span>
                      </button>
                      <button onClick={answerCall} className="flex flex-col items-center gap-2 group">
                          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-green-500/40 group-hover:scale-110 transition-transform animate-bounce">
                              {incomingCall.callType === 'video' ? <Video size={32} /> : <Phone size={32} />}
                          </div>
                          <span className="text-sm text-slate-400 font-medium">Answer</span>
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  // --- Render Active Call Interface ---
  if (status !== 'idle' && status !== 'incoming') {
      const showRemoteVideo = callType === 'video' && status === 'connected';

      return (
          <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col"
              onMouseMove={handleDragMove} onMouseUp={() => isDragging.current = false}
              onTouchMove={handleDragMove} onTouchEnd={() => isDragging.current = false}
          >
              <div className="flex-1 relative overflow-hidden bg-black">
                  {/* Remote Video */}
                  <video ref={remoteVideoRef} autoPlay playsInline className={`absolute inset-0 w-full h-full object-cover bg-black ${showRemoteVideo ? '' : 'hidden'}`} />

                  {/* Top Info Bar */}
                  <div className="absolute top-0 left-0 right-0 p-4 pt-[calc(1rem+env(safe-area-inset-top))] pointer-events-none z-30 flex justify-between items-center">
                       <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
                           <Signal size={16} className={networkQuality === 'good' ? 'text-green-500' : networkQuality === 'poor' ? 'text-yellow-500' : 'text-red-500'} />
                           <span className="text-xs text-white/90 font-medium hidden sm:inline capitalize">{networkQuality}</span>
                       </div>

                       {status === 'connected' && (
                           <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 shadow-lg">
                               <Clock size={16} className="text-white/80" />
                               <span className="text-sm text-white font-mono">{formatTime(callDuration)}</span>
                           </div>
                       )}

                       {callType === 'video' && (
                           <div className="pointer-events-auto">
                               <button onClick={switchCamera} className="sm:hidden p-2.5 bg-black/40 backdrop-blur-md rounded-full text-white border border-white/20">
                                   <RotateCcw size={20} />
                               </button>
                           </div>
                       )}
                  </div>

                  {/* Remote Avatar Overlay (Audio Only or Connecting) */}
                  {!showRemoteVideo && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center pointer-events-none">
                           <div className="relative mb-6">
                                <img src={remoteDetails.avatar} className="w-32 h-32 rounded-full border-4 border-white/10 shadow-2xl bg-slate-800 object-cover mb-6" />
                                {status !== 'connected' && <div className="absolute inset-0 rounded-full border-4 border-white/20 animate-ping opacity-30"></div>}
                           </div>
                           <h3 className="text-3xl font-bold text-white mb-2">{remoteDetails.name}</h3>
                           <p className="text-white/60 text-lg font-medium animate-pulse capitalize">{status}...</p>
                      </div>
                  )}

                  {/* Local Video PiP */}
                  {callType === 'video' && (
                      <div ref={pipRef} onMouseDown={handleDragStart} onTouchStart={handleDragStart}
                        className="absolute w-28 sm:w-40 aspect-[3/4] bg-slate-900 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 z-40 cursor-move"
                        style={{ left: pipPosition.x, top: pipPosition.y, touchAction: 'none' }}
                      >
                          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1] pointer-events-none" />
                      </div>
                  )}
              </div>

              {/* Controls */}
              <div className="absolute bottom-0 left-0 right-0 z-50 px-4 pb-8 pt-6 flex items-center justify-evenly gap-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                  <button onClick={toggleMute} className={`p-3.5 rounded-full transition-all shadow-lg ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-800/80 text-white border border-white/20'}`}>
                      {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>

                  {callType === 'video' && (
                      <button onClick={toggleVideo} className={`p-3.5 rounded-full transition-all shadow-lg ${isVideoOff ? 'bg-white text-slate-900' : 'bg-slate-800/80 text-white border border-white/20'}`}>
                          {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                      </button>
                  )}

                  {callType === 'video' && (
                       <button onClick={switchCamera} className="hidden sm:block p-3.5 rounded-full shadow-lg bg-slate-800/80 text-white border border-white/20">
                           <RotateCcw size={24} />
                       </button>
                  )}

                  <button onClick={() => endCall()} className="p-5 rounded-full bg-red-600 text-white hover:bg-red-700 shadow-xl transform hover:scale-110">
                      <PhoneOff size={32} />
                  </button>

                  <button onClick={() => setIsSpeakerMuted(!isSpeakerMuted)} className={`p-3.5 rounded-full transition-all shadow-lg ${isSpeakerMuted ? 'bg-white text-slate-900' : 'bg-slate-800/80 text-white border border-white/20'}`}>
                      {isSpeakerMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
                  </button>

                  <button onClick={cycleVoiceFilter} className={`p-3.5 rounded-full transition-all shadow-lg ${voiceFilter !== 'normal' ? 'bg-purple-500 text-white' : 'bg-slate-800/80 text-white border border-white/20'}`}>
                      <Wand2 size={24} />
                  </button>
              </div>
          </div>
      );
  }

  // --- Render Participants List ---
  if (showParticipants) {
      return (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm flex items-start justify-end p-4 sm:p-6" onClick={onCloseParticipants}>
            <div className="bg-white dark:bg-slate-800 w-full max-w-xs rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden animate-in slide-in-from-right-4 mt-14" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <UserIcon size={18} /> Participants ({users.length})
                    </h3>
                    <button onClick={onCloseParticipants} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition"><X size={20} /></button>
                </div>
                
                <div className="max-h-[60vh] overflow-y-auto p-2 space-y-1">
                    {users.map((u) => {
                        const isMe = u.uid === user.uid;
                        const lastSeen = u.onlineAt ? new Date(u.onlineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
                        
                        return (
                            <div key={u.uid} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition group">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="relative">
                                        <img src={u.avatar} className="w-10 h-10 rounded-full bg-slate-200 object-cover border border-slate-100 dark:border-slate-600" alt={u.username} />
                                        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-2 border-white dark:border-slate-800 rounded-full ${u.status === 'active' ? 'bg-green-500' : 'bg-orange-400'}`}></span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1 text-sm">
                                            {u.username} {isMe && "(You)"}
                                            {roomCreatorId === u.uid && <Crown size={12} className="text-yellow-500 fill-yellow-500" />}
                                        </span>
                                        <span className="text-[10px] text-slate-400">{u.status === 'active' ? 'Online' : 'Idle'} • {lastSeen}</span>
                                    </div>
                                </div>
                                {!isMe && (
                                    <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => startCall(u.uid, u.username, u.avatar, 'audio')} className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition" title="Audio Call"><Phone size={18} /></button>
                                        <button onClick={() => startCall(u.uid, u.username, u.avatar, 'video')} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition" title="Video Call"><Video size={18} /></button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
      );
  }

  return null;
};

export default CallManager;
