import React, { useEffect, useRef } from 'react';
import { Phone, Video, Mic, MicOff, PhoneOff, X, User as UserIcon, Crown, AlertCircle, VideoOff, RotateCcw, Signal, Clock, Volume2, VolumeX, Wand2, Users as UsersIcon } from 'lucide-react';
import { User, ChatConfig, Presence } from '../types';
import { useWebRTC, RemotePeer, CallType } from '../hooks/useWebRTC';

interface CallManagerProps {
  user: User;
  config: ChatConfig;
  users: Presence[];
  onCloseParticipants: () => void;
  showParticipants: boolean;
  roomCreatorId?: string | null;
}

// A single video/audio tile (local or remote). Binds the MediaStream to its own
// <video> element; falls back to an avatar when there's no live video track.
const CallTile: React.FC<{
  stream: MediaStream | null;
  name: string;
  avatar: string;
  muted: boolean;     // mute the element's audio (always for local; speaker-mute for remote)
  mirror?: boolean;
  showVideo: boolean;
  reconnecting?: boolean;
}> = ({ stream, name, avatar, muted, mirror, showVideo, reconnecting }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);

  return (
    <div className="relative bg-slate-900 rounded-2xl overflow-hidden border border-white/10 shadow-lg w-full h-full min-h-0">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`w-full h-full object-cover ${mirror ? 'scale-x-[-1]' : ''} ${showVideo ? '' : 'opacity-0'}`}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={avatar} alt={name} className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover border-2 border-white/15 shadow-xl bg-slate-800" />
        </div>
      )}
      {reconnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <span className="text-white/80 text-xs font-medium animate-pulse">Reconnecting…</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/50 backdrop-blur-md rounded-full text-[11px] text-white/90 font-medium max-w-[80%] truncate">
        {name}
      </div>
    </div>
  );
};

// Tailwind-friendly grid columns for N tiles (incl. the local one).
function gridColsClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  return 'grid-cols-2 sm:grid-cols-3';
}

const CallManager: React.FC<CallManagerProps> = ({ user, config, users, onCloseParticipants, showParticipants, roomCreatorId }) => {
  const {
    status, callType, incoming, peers, localStream,
    isMuted, isVideoOff, isSpeakerMuted, setIsSpeakerMuted, voiceFilter,
    networkQuality, callDuration,
    startCall, acceptCall, declineCall, hangup,
    toggleMute, toggleVideo, switchCamera, cycleVoiceFilter,
  } = useWebRTC(user, config);

  const formatTime = (secs: number) => `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;

  const beginCall = (type: CallType) => {
    onCloseParticipants();
    startCall(type);
  };

  // --- Incoming (ringing) ---
  if (status === 'ringing' && incoming) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-300">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm text-center">
          <div className="relative">
            <img src={incoming.fromAvatar} alt="Caller" className="w-32 h-32 rounded-full object-cover border-4 border-blue-500 shadow-2xl bg-slate-200" />
            <div className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-30" />
          </div>
          <div>
            <h3 className="text-3xl font-bold text-white mb-2">{incoming.fromName}</h3>
            <p className="text-blue-200 font-medium animate-pulse text-lg">
              Incoming group {incoming.callType === 'video' ? 'video' : 'audio'} call…
            </p>
          </div>
          <div className="flex items-center justify-between w-full px-8 mt-4">
            <button onClick={declineCall} className="flex flex-col items-center gap-2 group">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center text-red-500 border-2 border-red-500/50 group-hover:bg-red-500 group-hover:text-white transition-all duration-300">
                <PhoneOff size={32} fill="currentColor" />
              </div>
              <span className="text-sm text-slate-400 font-medium">Decline</span>
            </button>
            <button onClick={acceptCall} className="flex flex-col items-center gap-2 group">
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-green-500/40 group-hover:scale-110 transition-transform duration-300 animate-bounce">
                {incoming.callType === 'video' ? <Video size={32} fill="currentColor" /> : <Phone size={32} fill="currentColor" />}
              </div>
              <span className="text-sm text-slate-400 font-medium">Join</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Active call (grid) ---
  if (status === 'incall') {
    const isVideo = callType === 'video';
    const tileCount = peers.length + 1;
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
        {/* Top bar: signal + timer */}
        <div className="absolute top-0 left-0 right-0 p-4 pt-[calc(1rem+env(safe-area-inset-top))] z-30 pointer-events-none">
          <div className="relative flex justify-between items-center">
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
              <Signal size={16} className={networkQuality === 'good' ? 'text-green-500' : networkQuality === 'poor' ? 'text-yellow-500' : 'text-red-500'} />
              <span className="text-xs text-white/90 font-medium capitalize hidden sm:inline">{networkQuality}</span>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/40 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 shadow-lg">
              <Clock size={16} className="text-white/80" />
              <span className="text-sm text-white font-mono font-medium">{formatTime(callDuration)}</span>
            </div>
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
              <UsersIcon size={15} className="text-white/80" />
              <span className="text-xs text-white/90 font-medium">{tileCount}</span>
            </div>
          </div>
          {voiceFilter !== 'normal' && (
            <div className="mt-2 flex items-center gap-2 bg-purple-500/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 w-fit">
              <Wand2 size={14} className="text-white" />
              <span className="text-xs text-white font-medium capitalize">{voiceFilter} Voice</span>
            </div>
          )}
        </div>

        {/* Tile grid */}
        <div className={`flex-1 grid ${gridColsClass(tileCount)} gap-2 p-2 pt-16 pb-28 auto-rows-fr overflow-hidden`}>
          {peers.map((p: RemotePeer) => {
            const hasVideo = p.stream.getVideoTracks().length > 0;
            const reconnecting = p.state === 'disconnected' || p.state === 'failed' || p.state === 'checking';
            return (
              <CallTile
                key={p.uid}
                stream={p.stream}
                name={p.name}
                avatar={p.avatar}
                muted={isSpeakerMuted}
                showVideo={isVideo && hasVideo}
                reconnecting={reconnecting}
              />
            );
          })}
          <CallTile
            stream={localStream}
            name="You"
            avatar={config.avatarURL}
            muted
            mirror
            showVideo={isVideo && !isVideoOff}
          />
        </div>

        {peers.length === 0 && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center pointer-events-none z-20">
            <p className="text-white/70 text-lg font-medium animate-pulse">Waiting for others to join…</p>
          </div>
        )}

        {/* Controls */}
        <div className="absolute bottom-0 left-0 right-0 z-50 px-4 pb-8 pt-6 flex items-center justify-evenly gap-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
          <button onClick={toggleMute} className={`p-3.5 rounded-full transition-all shadow-lg ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}>
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
          {isVideo && (
            <button onClick={toggleVideo} className={`p-3.5 rounded-full transition-all shadow-lg ${isVideoOff ? 'bg-white text-slate-900' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}>
              {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
            </button>
          )}
          {isVideo && (
            <button onClick={switchCamera} title="Switch camera" className="p-3.5 rounded-full transition-all shadow-lg bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700">
              <RotateCcw size={24} />
            </button>
          )}
          <button onClick={hangup} className="p-5 rounded-full bg-red-600 text-white hover:bg-red-700 transition-all shadow-xl shadow-red-600/30 transform hover:scale-110">
            <PhoneOff size={32} fill="currentColor" />
          </button>
          <button onClick={() => setIsSpeakerMuted(!isSpeakerMuted)} className={`p-3.5 rounded-full transition-all shadow-lg ${isSpeakerMuted ? 'bg-white text-slate-900' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}>
            {isSpeakerMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
          </button>
          <button onClick={cycleVoiceFilter} title="Voice filters" className={`p-3.5 rounded-full transition-all shadow-lg ${voiceFilter !== 'normal' ? 'bg-purple-500 text-white' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}>
            <Wand2 size={24} />
          </button>
        </div>
      </div>
    );
  }

  // --- Participants panel (idle) ---
  if (showParticipants) {
    return (
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm flex items-start justify-end p-4 sm:p-6" onClick={onCloseParticipants}>
        <div className="bg-white dark:bg-slate-800 w-full max-w-xs rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden animate-in slide-in-from-right-4 mt-14" onClick={(e) => e.stopPropagation()}>
          <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <UserIcon size={18} /> Participants ({users.length})
            </h3>
            <button onClick={onCloseParticipants} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition"><X size={20} /></button>
          </div>

          {/* Start a group call (rings everyone in the room) */}
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700">
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">Start group call</p>
            <div className="flex gap-1.5">
              <button onClick={() => beginCall('audio')} title="Audio call" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 transition active:scale-95">
                <Phone size={14} /> Audio
              </button>
              <button onClick={() => beginCall('video')} title="Video call" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition active:scale-95">
                <Video size={14} /> Video
              </button>
            </div>
          </div>

          <div className="max-h-[55vh] overflow-y-auto p-2 space-y-1">
            {users.map((u) => {
              const isMe = u.uid === user.uid;
              const lastSeen = u.onlineAt ? new Date(u.onlineAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';
              return (
                <div key={u.uid} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition group">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="relative">
                      <img src={u.avatar} className="w-10 h-10 rounded-full bg-slate-200 object-cover border border-slate-100 dark:border-slate-600" alt={u.username} />
                      <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-2 border-white dark:border-slate-800 rounded-full ${u.status === 'active' ? 'bg-green-500' : 'bg-orange-400'}`} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1 text-sm">
                        {u.username} {isMe && '(You)'}
                        {roomCreatorId === u.uid && <Crown size={12} className="text-yellow-500 fill-yellow-500" />}
                      </span>
                      <span className="text-[10px] text-slate-400">{u.status === 'active' ? 'Online' : 'Idle'} • {lastSeen}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {users.length === 0 && (
              <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm flex flex-col items-center gap-2">
                <AlertCircle size={24} className="opacity-50" />
                <p>No participants found.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default CallManager;
