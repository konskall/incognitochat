import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Phone, Video, Mic, MicOff, PhoneOff, X, User as UserIcon, Crown, AlertCircle, VideoOff, RotateCcw, Signal, Clock, Volume2, VolumeX, Wand2, Users as UsersIcon, MonitorUp, MonitorX, Minus, Maximize2, Minimize2, Maximize, Minimize, PictureInPicture2, Lock } from 'lucide-react';
import { docPipSupported, openDocPip } from '../utils/documentPip';
import { getDisplayMediaSupported, safeAvatarUrl } from '../utils/helpers';
import { User, ChatConfig, Presence } from '../types';
import { useWebRTC, RemotePeer, CallType, CallNotice } from '../hooks/useWebRTC';
import PinchZoom from './PinchZoom';
import { useDragResize } from '../hooks/useDragResize';
import MinimizedCallBubble from './MinimizedCallBubble';

// Transient banner for call/media problems or info (no camera, blocked perms, …).
const NoticeToast: React.FC<{ notice: CallNotice; onClose: () => void }> = ({ notice, onClose }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [notice, onClose]);
  const isErr = notice.kind === 'error';
  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-[92%] sm:max-w-md animate-in fade-in slide-in-from-top-2 duration-200">
      <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-2xl border text-sm font-medium ${isErr ? 'bg-red-600 text-white border-red-500/60' : 'bg-slate-900 text-white border-white/10'}`}>
        {isErr ? <AlertCircle size={18} className="shrink-0" /> : <Mic size={18} className="shrink-0 text-blue-300" />}
        <span className="flex-1">{notice.text}</span>
        <button onClick={onClose} aria-label="Dismiss" className="p-1 rounded-full hover:bg-white/15 transition"><X size={16} /></button>
      </div>
    </div>,
    document.body
  );
};

interface CallManagerProps {
  user: User;
  config: ChatConfig;
  users: Presence[];
  onCloseParticipants: () => void;
  showParticipants: boolean;
  roomCreatorId?: string | null;
  // Tier plumbing (Phase 3): entitlements + upgrade prompt; gates
  // audio/video/screen-share by tier (see gateCall + canShareScreen).
  ent?: import('../utils/entitlements').TierEntitlements;
  entLoading?: boolean;
  onUpgrade?: (featureLabel: string, requiredTier: 'basic' | 'ultra', reason?: string) => void;
}

// A single video/audio tile (local or remote). Binds the MediaStream to its own
// <video> element; falls back to an avatar when there's no live video track.
type CallTileProps = {
  stream: MediaStream | null;
  name: string;
  avatar: string;
  muted: boolean;     // mute the element's audio (always for local; speaker-mute for remote)
  mirror?: boolean;
  showVideo: boolean;
  reconnecting?: boolean;
  connecting?: boolean;
  sharing?: boolean;
  objectFit?: 'cover' | 'contain'; // 'cover' fills (may crop); 'contain' fits (letterboxes)
};
const CallTile = React.memo(({ stream, name, avatar, muted, mirror, showVideo, reconnecting, connecting, sharing, objectFit = 'cover' }: CallTileProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    }
  }, [stream]);
  useEffect(() => {
    const el = videoRef.current;
    if (el && showVideo) el.play().catch(() => {});
  }, [showVideo]);

  return (
    <div className="relative bg-slate-900 rounded-2xl overflow-hidden border border-white/10 shadow-lg w-full h-full min-h-0">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`w-full h-full ${objectFit === 'contain' ? 'object-contain' : 'object-cover'} ${mirror ? 'scale-x-[-1]' : ''} ${showVideo ? '' : 'opacity-0'}`}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={avatar} alt={name} className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover border-2 border-white/15 shadow-xl bg-slate-800" />
        </div>
      )}
      {(reconnecting || connecting) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <span className="text-white/80 text-xs font-medium animate-pulse">{reconnecting ? 'Reconnecting…' : 'Connecting…'}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/50 backdrop-blur-md rounded-full text-[11px] text-white/90 font-medium max-w-[80%] truncate flex items-center gap-1">
        {sharing && <MonitorUp size={12} className="shrink-0 text-blue-300" />}
        {name}
      </div>
    </div>
  );
});

// Draggable self-view picture-in-picture (iPhone-style) for 1-on-1 video. Snaps
// to the nearest corner on release; works with mouse + touch.
const SelfViewPiP = React.memo(({ stream, mirror, showVideo, avatar, sharing }: { stream: MediaStream | null; mirror: boolean; showVideo: boolean; avatar: string; sharing: boolean }) => {
  // Free placement (no corner snap) — leave it wherever dropped — but kept clear of
  // the top bar (~72px) and controls bar (~150px) so it never hides behind them.
  const { box, setBox, startDrag } = useDragResize({ x: 0, y: 0, w: 130, h: 174 }, { minW: 96, minH: 128, bounds: { top: 72, right: 10, bottom: 150, left: 10 } });
  useEffect(() => {
    const w = Math.min(140, window.innerWidth * 0.32); const h = w * 1.34;
    setBox({ x: window.innerWidth - w - 14, y: window.innerHeight - h - 158, w, h });
  }, [setBox]);
  return (
    <div
      onPointerDown={startDrag}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      className="absolute z-40 rounded-2xl overflow-hidden border-2 border-white/25 shadow-2xl cursor-grab active:cursor-grabbing touch-none"
    >
      <CallTile stream={stream} name="You" avatar={avatar} muted mirror={mirror} showVideo={showVideo} sharing={sharing} />
    </div>
  );
});

// Tailwind-friendly grid columns for N tiles (incl. the local one).
function gridColsClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  return 'grid-cols-2 sm:grid-cols-3';
}

function useIsDesktop(): boolean {
  const [d, setD] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px) and (pointer: fine)').matches);
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const on = () => setD(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, []);
  return d;
}

// Hidden <audio> that plays a remote peer's audio regardless of which video tile
// (grid / spotlight / bubble / pip) is currently mounted. Video tiles are muted;
// ALL remote sound comes from these, so minimizing never drops audio.
const AudioSink = React.memo(({ stream, muted }: { stream: MediaStream; muted: boolean }) => {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    const onGesture = () => {
      el.play().then(() => {
        window.removeEventListener('pointerdown', onGesture);
        window.removeEventListener('touchstart', onGesture);
      }).catch(() => {});
    };
    el.play().catch(() => {
      // iOS Safari blocks unmuted autoplay until a user gesture — retry on the next one.
      window.addEventListener('pointerdown', onGesture);
      window.addEventListener('touchstart', onGesture, { passive: true });
    });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('touchstart', onGesture);
    };
  }, [stream]);
  return <audio ref={ref} autoPlay muted={muted} style={{ display: 'none' }} />;
});

// Compact call view rendered INTO the Document-PiP window. No drag wrapper (the OS
// window is the frame). Video is muted — audio plays from the main doc's AudioSinks.
const PipCallView: React.FC<{ stream: MediaStream | null; avatar: string; showVideo: boolean; mirror: boolean; sharing: boolean; isMuted: boolean; onToggleMute: () => void; onHangup: () => void }>
  = ({ stream, avatar, showVideo, mirror, sharing, isMuted, onToggleMute, onHangup }) => {
  const ref = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => { const el = ref.current; if (el && stream) { el.srcObject = stream; el.play().catch(() => {}); } }, [stream]);
  return (
    <div className="relative w-screen h-screen bg-slate-900 overflow-hidden">
      <video ref={ref} autoPlay playsInline muted className={`w-full h-full ${sharing ? 'object-contain' : 'object-cover'} ${mirror ? 'scale-x-[-1]' : ''} ${showVideo ? '' : 'opacity-0'}`} />
      {!showVideo && <div className="absolute inset-0 flex items-center justify-center"><img src={avatar} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-white/15 bg-slate-800" /></div>}
      <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-4 p-2 bg-gradient-to-t from-black/80 to-transparent">
        <button onClick={onToggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'} className={`p-2.5 rounded-full transition ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-700/80 text-white hover:bg-slate-600'}`}>{isMuted ? <MicOff size={18} /> : <Mic size={18} />}</button>
        <button onClick={onHangup} aria-label="Hang up" className="p-2.5 rounded-full bg-red-600 text-white hover:bg-red-700 transition"><PhoneOff size={18} fill="currentColor" /></button>
      </div>
    </div>
  );
};

// Desktop floating call window: draggable by a center strip on the top bar
// (leaving the left signal chip + right window buttons clickable) and resizable
// from the bottom-right corner. Clamped to the viewport.
const DraggableWindow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const init = { x: Math.max(12, (window.innerWidth - 760) / 2), y: 56, w: Math.min(760, window.innerWidth - 24), h: Math.min(560, window.innerHeight - 96) };
  const { box, startDrag, startResize } = useDragResize(init, { minW: 360, minH: 300 });
  return (
    <div style={{ left: box.x, top: box.y, width: box.w, height: box.h }} className="fixed z-[100] rounded-2xl overflow-hidden shadow-2xl border border-white/15 bg-slate-950">
      <div onPointerDown={startDrag} className="absolute top-0 left-20 right-28 h-14 z-40 cursor-grab active:cursor-grabbing touch-none" />
      <div className="w-full h-full">{children}</div>
      <div onPointerDown={startResize} className="absolute bottom-0 right-0 w-5 h-5 z-[60] cursor-nwse-resize" title="Resize" />
    </div>
  );
};

const CallManager: React.FC<CallManagerProps> = ({ user, config, users, onCloseParticipants, showParticipants, roomCreatorId, ent, entLoading, onUpgrade }) => {
  const {
    status, callType, incoming, peers, localStream,
    isMuted, isVideoOff, isSpeakerMuted, setIsSpeakerMuted, voiceFilter,
    networkQuality, callDuration, notice, dismissNotice,
    startCall, acceptCall, declineCall, hangup,
    toggleMute, toggleVideo, switchCamera, cycleVoiceFilter,
    isScreenSharing, startScreenShare, stopScreenShare,
    sharingUids, facingMode,
  } = useWebRTC(user, config);

  const isDesktop = useIsDesktop();
  const [windowMode, setWindowMode] = React.useState<'full' | 'window' | 'min'>('full');
  React.useEffect(() => { if (status !== 'incall') setWindowMode('full'); }, [status]);
  React.useEffect(() => { if (!isDesktop && windowMode === 'window') setWindowMode('full'); }, [isDesktop, windowMode]);

  const canPip = docPipSupported();
  const canShareScreen = getDisplayMediaSupported();
  const screenShareLocked = !entLoading && !ent?.canScreenShare; // Ultra-only
  const [pipWindow, setPipWindow] = React.useState<Window | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const openPip = async () => {
    const w = await openDocPip(360, 260);
    if (!w) { setWindowMode('min'); return; } // unsupported/blocked → fall back to bubble
    w.addEventListener('pagehide', () => { pipWindowRef.current = null; setPipWindow(null); });
    setPipWindow(w);
    pipWindowRef.current = w;
  };
  React.useEffect(() => { if (status !== 'incall' && pipWindow) { try { pipWindow.close(); } catch { /* noop */ } pipWindowRef.current = null; setPipWindow(null); } }, [status, pipWindow]);
  React.useEffect(() => () => { try { pipWindowRef.current?.close(); } catch { /* noop */ } }, []);

  // How the 1-on-1 spotlight fits the remote: 'contain' = fit (whole frame, no
  // crop — sensible for a shared screen), 'cover' = fill (uses all the space, may
  // crop — sensible for a camera). User can flip it; we reset to the sensible
  // default whenever the peer starts/stops sharing.
  const spotlightSharing = callType === 'video' && peers.length === 1 && sharingUids.has(peers[0].uid);
  const [remoteFit, setRemoteFit] = React.useState<'cover' | 'contain'>('cover');
  React.useEffect(() => { setRemoteFit(spotlightSharing ? 'contain' : 'cover'); }, [spotlightSharing]);

  const formatTime = (secs: number) => `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;

  // Calls have NO server backstop -> this is the enforcement. Returns true if
  // allowed; otherwise opens the upgrade prompt and returns false. When ent is
  // not yet resolved, allow (the screen's own auth gating still applies).
  const gateCall = (type: CallType): boolean => {
    if (entLoading) return true; // tier not resolved yet -> don't block
    if (type === 'audio' && !ent?.canAudioCall) { onUpgrade?.('Audio calls', 'basic'); return false; }
    if (type === 'video' && !ent?.canVideoCall) { onUpgrade?.('Video calls', 'ultra'); return false; }
    return true;
  };

  // targetUid set ⇒ ring just that person (1-on-1); omitted ⇒ ring the whole room.
  const beginCall = (type: CallType, targetUid?: string) => {
    if (!gateCall(type)) return;
    onCloseParticipants();
    startCall(type, targetUid);
  };

  const renderContent = (): React.ReactNode => {
  // --- Incoming (ringing) ---
  if (status === 'ringing' && incoming) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-300">
        <div className="flex flex-col items-center gap-8 w-full max-w-sm text-center">
          <div className="relative">
            <img src={safeAvatarUrl(incoming.fromAvatar)} alt="Caller" className="w-32 h-32 rounded-full object-cover border-4 border-blue-500 shadow-2xl bg-slate-200" />
            <div className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-30" />
          </div>
          <div>
            <h3 className="text-3xl font-bold text-white mb-2">{incoming.fromName}</h3>
            <p className="text-blue-200 font-medium animate-pulse text-lg">
              Incoming {incoming.direct ? '' : 'group '}{incoming.callType === 'video' ? 'video' : 'audio'} call…
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
    if (pipWindow) return null;
    const isVideo = callType === 'video';
    const hasLocalVideo = !!localStream && localStream.getVideoTracks().length > 0;
    // Local tile shows our CAMERA when in a video call. While sharing we show the
    // avatar + a "sharing" badge instead — never the screen capture — both to
    // avoid the hall-of-mirrors recursion (see startScreenShare) and so it's clear
    // we're sharing, not sending camera.
    const showLocalVideo = isVideo && !isVideoOff && hasLocalVideo && !isScreenSharing;
    const tileCount = peers.length + 1;
    const spotlight = isVideo && peers.length === 1;
    const surface = (
      <div className="relative w-full h-full bg-slate-950 flex flex-col overflow-hidden">
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
            <div className="flex items-center gap-2 pointer-events-auto relative z-50">
              <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
                <UsersIcon size={15} className="text-white/80" />
                <span className="text-xs text-white/90 font-medium">{tileCount}</span>
              </div>
              {isDesktop && (
                <button onClick={() => setWindowMode((m) => (m === 'window' ? 'full' : 'window'))} aria-label={windowMode === 'window' ? 'Fullscreen' : 'Windowed'} title={windowMode === 'window' ? 'Fullscreen' : 'Windowed'} className="p-2 rounded-full bg-black/40 backdrop-blur-md text-white/90 border border-white/10 shadow-lg hover:bg-black/60 transition">
                  {windowMode === 'window' ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
                </button>
              )}
              {canPip && (
                <button onClick={openPip} aria-label="Pop out" title="Pop out" className="p-2 rounded-full bg-black/40 backdrop-blur-md text-white/90 border border-white/10 shadow-lg hover:bg-black/60 transition">
                  <PictureInPicture2 size={15} />
                </button>
              )}
              <button onClick={() => setWindowMode('min')} aria-label="Minimize call" title="Minimize" className="p-2 rounded-full bg-black/40 backdrop-blur-md text-white/90 border border-white/10 shadow-lg hover:bg-black/60 transition">
                <Minus size={15} />
              </button>
            </div>
          </div>
          {voiceFilter !== 'normal' && (
            <div className="mt-2 flex items-center gap-2 bg-purple-500/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 w-fit">
              <Wand2 size={14} className="text-white" />
              <span className="text-xs text-white font-medium capitalize">{voiceFilter} Voice</span>
            </div>
          )}
        </div>

        {spotlight ? (
          <div className="flex-1 relative overflow-hidden pt-16 pb-36 sm:pb-28">
            {(() => {
              const p = peers[0];
              const hasVideo = p.stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);
              const dropped = p.state === 'disconnected' || p.state === 'failed';
              const connecting = !p.everConnected && (p.state === 'checking' || p.state === 'new');
              return (
                <PinchZoom className="absolute inset-2 sm:inset-3 rounded-2xl">
                  <CallTile stream={p.stream} name={p.name} avatar={safeAvatarUrl(p.avatar)} muted showVideo={hasVideo} reconnecting={dropped} connecting={connecting} sharing={sharingUids.has(p.uid)} objectFit={remoteFit} />
                </PinchZoom>
              );
            })()}
            {/* Fit ↔ Fill: adjust how the interlocutor fills the frame (uses the
                empty space when 'fill'; pinch-zoom still available for detail). */}
            <button
              onClick={() => setRemoteFit((f) => (f === 'contain' ? 'cover' : 'contain'))}
              aria-label={remoteFit === 'contain' ? 'Fill screen' : 'Fit screen'}
              title={remoteFit === 'contain' ? 'Fill' : 'Fit'}
              className="absolute top-[4.5rem] left-3 z-30 p-2 rounded-full bg-black/40 backdrop-blur-md text-white/90 border border-white/10 shadow-lg hover:bg-black/60 transition"
            >
              {remoteFit === 'contain' ? <Maximize size={16} /> : <Minimize size={16} />}
            </button>
            <SelfViewPiP stream={localStream} mirror={showLocalVideo && facingMode === 'user'} showVideo={showLocalVideo} avatar={config.avatarURL} sharing={isScreenSharing} />
          </div>
        ) : (
          /* Tile grid */
          <div className={`flex-1 grid ${gridColsClass(tileCount)} gap-2 p-2 pt-16 pb-36 sm:pb-28 auto-rows-fr overflow-hidden`}>
            {peers.map((p: RemotePeer) => {
              // `!t.muted` excludes the always-present video transceiver's
              // placeholder track (live but receiving no frames) in an audio call,
              // so a non-sharing peer shows their avatar, not a black tile.
              const hasVideo = p.stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted);
              const dropped = p.state === 'disconnected' || p.state === 'failed';
              const connecting = !p.everConnected && (p.state === 'checking' || p.state === 'new');
              const peerSharing = sharingUids.has(p.uid);
              return (
                <CallTile
                  key={p.uid}
                  stream={p.stream}
                  name={p.name}
                  avatar={safeAvatarUrl(p.avatar)}
                  muted
                  showVideo={hasVideo}
                  reconnecting={dropped}
                  connecting={connecting}
                  sharing={peerSharing}
                  objectFit={peerSharing ? 'contain' : 'cover'}
                />
              );
            })}
            <CallTile
              stream={localStream}
              name="You"
              avatar={config.avatarURL}
              muted
              mirror={showLocalVideo && facingMode === 'user'}
              showVideo={showLocalVideo}
              sharing={isScreenSharing}
            />
          </div>
        )}

        {peers.length === 0 && (
          <div className="absolute inset-x-0 top-[66%] flex justify-center px-4 pointer-events-none z-20">
            <p className="text-white/90 text-sm font-medium animate-pulse bg-black/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-lg">
              Waiting for others to join…
            </p>
          </div>
        )}

        {/* Controls — wrap to a second row on narrow phones so nothing clips off-screen */}
        <div className="absolute bottom-0 left-0 right-0 z-50 px-2 sm:px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-wrap items-center justify-center gap-2 sm:gap-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
          <button onClick={toggleMute} className={`p-3 sm:p-3.5 rounded-full transition-all shadow-lg ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}>
            {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
          {isVideo && hasLocalVideo && !isScreenSharing && (
            <button onClick={toggleVideo} className={`p-3 sm:p-3.5 rounded-full transition-all shadow-lg ${isVideoOff ? 'bg-white text-slate-900' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}>
              {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
            </button>
          )}
          {isVideo && hasLocalVideo && !isScreenSharing && (
            <button onClick={switchCamera} title="Switch camera" className="p-3 sm:p-3.5 rounded-full transition-all shadow-lg bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700">
              <RotateCcw size={24} />
            </button>
          )}
          {canShareScreen && (
            <button
              onClick={() => {
                if (screenShareLocked) { onUpgrade?.('Screen sharing', 'ultra'); return; }
                isScreenSharing ? stopScreenShare() : startScreenShare();
              }}
              title={screenShareLocked ? 'Screen sharing is an Ultra feature' : (isScreenSharing ? 'Stop sharing' : 'Share screen')}
              aria-label={screenShareLocked ? 'Screen sharing (Ultra)' : (isScreenSharing ? 'Stop sharing screen' : 'Share screen')}
              className={`relative p-3 sm:p-3.5 rounded-full transition-all shadow-lg ${isScreenSharing ? 'bg-blue-500 text-white' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'} ${screenShareLocked ? 'opacity-60' : ''}`}
            >
              {isScreenSharing ? <MonitorX size={24} /> : <MonitorUp size={24} />}
              {screenShareLocked && <Lock size={12} className="absolute -top-0.5 -right-0.5 bg-slate-900 rounded-full p-0.5" />}
            </button>
          )}
          <button onClick={hangup} className="p-4 sm:p-5 rounded-full bg-red-600 text-white hover:bg-red-700 transition-all shadow-xl shadow-red-600/30 transform hover:scale-110">
            <PhoneOff size={32} fill="currentColor" />
          </button>
          <button onClick={() => setIsSpeakerMuted(!isSpeakerMuted)} className={`p-3 sm:p-3.5 rounded-full transition-all shadow-lg ${isSpeakerMuted ? 'bg-white text-slate-900' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}>
            {isSpeakerMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
          </button>
          <button onClick={cycleVoiceFilter} title="Voice filters" className={`p-3 sm:p-3.5 rounded-full transition-all shadow-lg ${voiceFilter !== 'normal' ? 'bg-purple-500 text-white' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}>
            <Wand2 size={24} />
          </button>
        </div>
      </div>
    );
    if (windowMode === 'min') {
      const bp = peers[0];
      return (
        <MinimizedCallBubble
          stream={bp ? bp.stream : localStream}
          name={bp ? bp.name : 'You'}
          avatar={bp ? safeAvatarUrl(bp.avatar) : config.avatarURL}
          showVideo={bp ? bp.stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted) : showLocalVideo}
          mirror={!bp && facingMode === 'user'}
          sharing={bp ? sharingUids.has(bp.uid) : isScreenSharing}
          isMuted={isMuted}
          onToggleMute={toggleMute}
          onHangup={hangup}
          onRestore={() => setWindowMode('full')}
        />
      );
    }
    if (windowMode === 'window' && isDesktop) return <DraggableWindow>{surface}</DraggableWindow>;
    return <div className="fixed inset-0 z-[100] bg-slate-950">{surface}</div>;
  }

  // --- Participants panel (idle) ---
  if (showParticipants) {
    return (
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm flex items-start justify-end p-4 sm:p-6" onClick={onCloseParticipants}>
        <div className="bg-white dark:bg-slate-800 w-full max-w-[18rem] rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden animate-in slide-in-from-right-4 mt-14" onClick={(e) => e.stopPropagation()}>
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
              <button onClick={() => beginCall('audio')} title={!entLoading && !ent?.canAudioCall ? 'Audio calls are a Basic feature' : 'Audio call'} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 transition active:scale-95 ${!entLoading && !ent?.canAudioCall ? 'opacity-50' : ''}`}>
                <Phone size={14} /> Audio {!entLoading && !ent?.canAudioCall && <Lock size={12} className="ml-1" />}
              </button>
              <button onClick={() => beginCall('video')} title={!entLoading && !ent?.canVideoCall ? 'Video calls are an Ultra feature' : 'Video call'} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition active:scale-95 ${!entLoading && !ent?.canVideoCall ? 'opacity-50' : ''}`}>
                <Video size={14} /> Video {!entLoading && !ent?.canVideoCall && <Lock size={12} className="ml-1" />}
              </button>
            </div>
          </div>

          <div className="max-h-[55vh] overflow-y-auto p-2 space-y-1">
            {users.map((u) => {
              const isMe = u.uid === user.uid;
              const lastSeen = u.onlineAt ? new Date(u.onlineAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just now';
              return (
                <div key={u.uid} className="flex items-center justify-between gap-2 p-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition group">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="relative shrink-0">
                      <img src={safeAvatarUrl(u.avatar)} className="w-10 h-10 rounded-full bg-slate-200 object-cover border border-slate-100 dark:border-slate-600" alt={u.username} />
                      <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-2 border-white dark:border-slate-800 rounded-full ${u.status === 'active' ? 'bg-green-500' : 'bg-orange-400'}`} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1 text-sm">
                        {u.username} {isMe && '(You)'}
                        {roomCreatorId === u.uid && <Crown size={12} className="text-yellow-500 fill-yellow-500 shrink-0" />}
                      </span>
                      <span className="text-[10px] text-slate-400 truncate">{u.status === 'active' ? 'Online' : 'Idle'} • {lastSeen}</span>
                    </div>
                  </div>
                  {/* 1-on-1 call: ring just this person (audio or video). */}
                  {!isMe && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => beginCall('audio', u.uid)} title={!entLoading && !ent?.canAudioCall ? 'Audio calls are a Basic feature' : `Audio call ${u.username}`} className={`flex items-center p-1.5 rounded-full text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 transition active:scale-95 ${!entLoading && !ent?.canAudioCall ? 'opacity-50' : ''}`}>
                        <Phone size={17} /> {!entLoading && !ent?.canAudioCall && <Lock size={14} className="ml-0.5" />}
                      </button>
                      <button onClick={() => beginCall('video', u.uid)} title={!entLoading && !ent?.canVideoCall ? 'Video calls are an Ultra feature' : `Video call ${u.username}`} className={`flex items-center p-1.5 rounded-full text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition active:scale-95 ${!entLoading && !ent?.canVideoCall ? 'opacity-50' : ''}`}>
                        <Video size={17} /> {!entLoading && !ent?.canVideoCall && <Lock size={14} className="ml-0.5" />}
                      </button>
                    </div>
                  )}
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

  return (
    <>
      {notice && <NoticeToast notice={notice} onClose={dismissNotice} />}
      {status === 'incall' && peers.map((p) => <AudioSink key={p.uid} stream={p.stream} muted={isSpeakerMuted} />)}
      {status === 'incall' && pipWindow && createPortal(
        <PipCallView
          stream={peers[0] ? peers[0].stream : localStream}
          avatar={peers[0] ? safeAvatarUrl(peers[0].avatar) : config.avatarURL}
          showVideo={peers[0] ? peers[0].stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted) : (!!localStream && localStream.getVideoTracks().length > 0 && callType === 'video' && !isVideoOff && !isScreenSharing)}
          mirror={!peers[0] && facingMode === 'user'}
          sharing={peers[0] ? sharingUids.has(peers[0].uid) : isScreenSharing}
          isMuted={isMuted}
          onToggleMute={toggleMute}
          onHangup={hangup}
        />,
        pipWindow.document.body,
      )}
      {renderContent()}
    </>
  );
};

export default CallManager;
