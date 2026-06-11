import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, PhoneOff, Maximize2, MonitorUp } from 'lucide-react';
import { useDragResize } from '../hooks/useDragResize';

// Small muted <video> for the bubble/pip; audio plays from the always-mounted
// RemoteAudioSinks in CallManager, so this never carries audio (no double sound).
const BubbleVideo: React.FC<{ stream: MediaStream | null; avatar: string; showVideo: boolean; mirror: boolean }>
  = ({ stream, avatar, showVideo, mirror }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && stream) { el.srcObject = stream; el.play().catch(() => {}); }
  }, [stream]);
  return (
    <>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover ${mirror ? 'scale-x-[-1]' : ''} ${showVideo ? '' : 'opacity-0'}`}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={avatar} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white/15 bg-slate-800" />
        </div>
      )}
    </>
  );
};

export interface MinimizedCallBubbleProps {
  stream: MediaStream | null;
  avatar: string;
  name: string;
  showVideo: boolean;
  mirror: boolean;
  sharing: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  onHangup: () => void;
  onRestore: () => void;
}

// Floating, draggable mini call window (portal to <body>). The call keeps running
// while the rest of the app is usable. Drag the card; buttons stop propagation so
// they don't start a drag. Tapping the video area restores the full call.
const MinimizedCallBubble: React.FC<MinimizedCallBubbleProps> = ({
  stream, avatar, name, showVideo, mirror, sharing, isMuted, onToggleMute, onHangup, onRestore,
}) => {
  const { box, setBox, startDrag } = useDragResize({ x: 0, y: 0, w: 220, h: 150 }, { snap: true, margin: 12, minW: 160, minH: 110 });
  useEffect(() => {
    setBox((b) => ({ ...b, x: window.innerWidth - b.w - 16, y: window.innerHeight - b.h - 90 }));
  }, [setBox]);

  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return createPortal(
    <div
      onPointerDown={startDrag}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      className="fixed z-[120] rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-slate-900 cursor-grab active:cursor-grabbing touch-none select-none"
    >
      {/* tap the video to restore */}
      <button onClick={onRestore} className="absolute inset-0 z-0" aria-label="Restore call" tabIndex={-1} />
      <BubbleVideo stream={stream} avatar={avatar} showVideo={showVideo} mirror={mirror} />

      <button
        onClick={onRestore}
        onPointerDown={stop}
        aria-label="Restore call"
        className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition"
      >
        <Maximize2 size={14} />
      </button>

      <span className="absolute top-1.5 left-1.5 z-10 px-2 py-0.5 bg-black/50 backdrop-blur-md rounded-full text-[10px] text-white/90 font-medium truncate max-w-[60%] flex items-center gap-1">
        {sharing && <MonitorUp size={11} className="shrink-0 text-blue-300" />}
        {name}
      </span>

      <div className="absolute bottom-0 inset-x-0 z-10 flex items-center justify-center gap-3 p-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <button
          onClick={onToggleMute}
          onPointerDown={stop}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          className={`p-2 rounded-full transition ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-700/80 text-white hover:bg-slate-600'}`}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button
          onClick={onHangup}
          onPointerDown={stop}
          aria-label="Hang up"
          className="p-2 rounded-full bg-red-600 text-white hover:bg-red-700 transition"
        >
          <PhoneOff size={16} fill="currentColor" />
        </button>
      </div>
    </div>,
    document.body
  );
};

export default MinimizedCallBubble;
