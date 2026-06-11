# Flexible Call Windows + iPhone Spotlight + Voice Presets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the in-call UI flexible (desktop drag/resize/minimize + OS Document-PiP), add an iPhone-style spotlight layout for 1-on-1 video with a draggable self-view PiP, add Monster + Alien voice presets (and beef up Robot), and refine the reconnecting indicator.

**Architecture:** Presentation-only change over the existing mesh. `hooks/useWebRTC.ts` gains voice presets (in the unified audio graph) + a per-peer `everConnected` flag; everything else is in the view layer: a new `useDragResize` hook, a refactored `CallManager` with window modes + spotlight, a `MinimizedCallBubble`, and a `documentPip` util. The WebRTC/signaling logic is untouched.

**Tech Stack:** React 18 + TS, Tailwind, Web Audio API, Pointer Events, Document Picture-in-Picture API, lucide-react icons, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-flexible-call-windows-design.md`

---

### Task 1: Voice presets (Monster + Alien, beefier Robot)

**Files:**
- Modify: `hooks/useWebRTC.ts` (`VoiceFilterType`, `cycleVoiceFilter`, `buildOutgoingAudio` filter section)

Only the **filter chain** inside `buildOutgoingAudio` changes plus the type and the cycle order. The fast path (`normal` + no screen audio → raw mic), the `micGain` mute node, the screen-audio mix, and `applyOutgoingAudio` stay exactly as they are.

- [ ] **Step 1: Extend the type + cycle order**

In `hooks/useWebRTC.ts`:
```ts
export type VoiceFilterType = 'normal' | 'deep' | 'robot' | 'monster' | 'alien';
```
`cycleVoiceFilter`:
```ts
const cycleVoiceFilter = useCallback(() => {
  const order: VoiceFilterType[] = ['normal', 'deep', 'robot', 'monster', 'alien'];
  const next = order[(order.indexOf(voiceFilter) + 1) % order.length];
  setVoiceFilter(next);
  voiceFilterRef.current = next;
  applyOutgoingAudio();
}, [voiceFilter, applyOutgoingAudio]);
```

- [ ] **Step 2: Replace the filter section of `buildOutgoingAudio`**

Inside `buildOutgoingAudio`, the `if (mic) { ... }` block currently builds `node` for `deep`/`robot`. Replace the filter-building portion (between `let node: AudioNode = micSource;` and the `const micGain = ...` line) with a call to a new pure helper `buildVoiceChain(ctx, micSource, filter)` that returns the tail node:

```ts
if (mic) {
  mic.enabled = true; // gain handles mute when the graph is active
  const micSource = ctx.createMediaStreamSource(new MediaStream([mic]));
  const node = buildVoiceChain(ctx, micSource, filter);
  const micGain = ctx.createGain(); micGain.gain.value = muted ? 0 : 1;
  node.connect(micGain); micGain.connect(dest);
  micGainRef.current = micGain;
}
```

Add `buildVoiceChain` as a module-level function (above `useWebRTC`, next to `mediaErrorMessage`). It creates/starts any oscillators it needs (they live until the AudioContext closes). **Ring modulation** = signal through a GainNode with base gain 0, carrier oscillator connected to `.gain`:

```ts
// Build the per-filter Web Audio chain from a mic source node; returns the tail
// node to connect onward. Oscillators are started immediately (GC'd on ctx close).
function buildVoiceChain(ctx: AudioContext, src: AudioNode, filter: VoiceFilterType): AudioNode {
  if (filter === 'deep') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 1.5;
    src.connect(lp); lp.connect(g); return g;
  }
  if (filter === 'robot') {
    // Bandpass → pure ring mod (square ~80Hz) → comb/flanger → hard-clip waveshaper.
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
    const ring = ctx.createGain(); ring.gain.value = 0; // pure ring mod
    const carrier = ctx.createOscillator(); carrier.type = 'square'; carrier.frequency.value = 80; carrier.start();
    carrier.connect(ring.gain);
    const comb = ctx.createDelay(); comb.delayTime.value = 0.006;
    const fb = ctx.createGain(); fb.gain.value = 0.5;
    const shaper = ctx.createWaveShaper(); shaper.curve = makeClipCurve(0.6); shaper.oversample = '2x';
    const out = ctx.createGain(); out.gain.value = 0.9;
    src.connect(bp); bp.connect(ring);
    ring.connect(comb); comb.connect(fb); fb.connect(comb); // feedback loop
    ring.connect(shaper); comb.connect(shaper);
    shaper.connect(out); return out;
  }
  if (filter === 'monster') {
    // Heavy lowpass + growl waveshaper + low ring-mod sub-harmonic + boost.
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const shaper = ctx.createWaveShaper(); shaper.curve = makeClipCurve(0.35); shaper.oversample = '4x';
    const sub = ctx.createGain(); sub.gain.value = 0; // ring mod
    const subOsc = ctx.createOscillator(); subOsc.type = 'sine'; subOsc.frequency.value = 30; subOsc.start();
    subOsc.connect(sub.gain);
    const boost = ctx.createGain(); boost.gain.value = 1.8;
    src.connect(lp); lp.connect(shaper); shaper.connect(sub); sub.connect(boost); return boost;
  }
  if (filter === 'alien') {
    // Ring mod (sine ~140Hz) + LFO tremolo + light highpass.
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
    const ring = ctx.createGain(); ring.gain.value = 0;
    const carrier = ctx.createOscillator(); carrier.type = 'sine'; carrier.frequency.value = 140; carrier.start();
    carrier.connect(ring.gain);
    const trem = ctx.createGain(); trem.gain.value = 0.7;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 6; lfo.start();
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth); lfoDepth.connect(trem.gain);
    src.connect(hp); hp.connect(ring); ring.connect(trem); return trem;
  }
  return src; // normal (only reached when screen audio forces the graph)
}

// Symmetric clip curve for waveshaper distortion; `amount` in (0,1], higher = harder.
function makeClipCurve(amount: number): Float32Array {
  const n = 1024; const curve = new Float32Array(n); const k = amount * 100;
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return curve;
}
```

- [ ] **Step 3: Build + run tests** — `npm run build` (expect clean) and `npm test` (expect 20 passing, no regressions).

- [ ] **Step 4: Commit** — `git add hooks/useWebRTC.ts && git commit -m "Voice presets: add Monster + Alien, beef up Robot (unified audio graph)"`

---

### Task 2: `useDragResize` hook + pure helpers (with tests)

**Files:**
- Create: `hooks/useDragResize.ts`
- Create: `hooks/useDragResize.test.ts`

- [ ] **Step 1: Write the failing test for the pure helpers**

`hooks/useDragResize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { clampBox, nearestCorner } from './useDragResize';

describe('clampBox', () => {
  it('keeps a box inside the viewport', () => {
    expect(clampBox({ x: -50, y: -50, w: 100, h: 100 }, 800, 600)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(clampBox({ x: 9999, y: 9999, w: 100, h: 100 }, 800, 600)).toEqual({ x: 700, y: 500, w: 100, h: 100 });
  });
  it('caps size to the viewport', () => {
    expect(clampBox({ x: 0, y: 0, w: 2000, h: 2000 }, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
});

describe('nearestCorner', () => {
  it('snaps a point box to the closest viewport corner with margin', () => {
    // top-left-ish
    expect(nearestCorner({ x: 10, y: 10, w: 100, h: 100 }, 800, 600, 16)).toMatchObject({ x: 16, y: 16 });
    // bottom-right-ish
    expect(nearestCorner({ x: 700, y: 500, w: 100, h: 100 }, 800, 600, 16)).toMatchObject({ x: 800 - 100 - 16, y: 600 - 100 - 16 });
  });
});
```

- [ ] **Step 2: Run it (expect fail — module not found / no export)** — `npm test -- useDragResize`

- [ ] **Step 3: Implement the hook + helpers**

`hooks/useDragResize.ts`:
```ts
import { useCallback, useRef, useState } from 'react';

export interface Box { x: number; y: number; w: number; h: number; }

// Clamp a box so it stays fully within w×h (size capped to the viewport first).
export function clampBox(b: Box, vw: number, vh: number): Box {
  const w = Math.min(b.w, vw); const h = Math.min(b.h, vh);
  const x = Math.min(Math.max(b.x, 0), Math.max(0, vw - w));
  const y = Math.min(Math.max(b.y, 0), Math.max(0, vh - h));
  return { x, y, w, h };
}

// Snap a box to the nearest viewport corner (keeping `margin` from the edges).
export function nearestCorner(b: Box, vw: number, vh: number, margin: number): Box {
  const left = b.x + b.w / 2 < vw / 2;
  const top = b.y + b.h / 2 < vh / 2;
  const x = left ? margin : vw - b.w - margin;
  const y = top ? margin : vh - b.h - margin;
  return { ...b, x, y };
}

interface Opts { minW?: number; minH?: number; snap?: boolean; margin?: number; }

// Pointer-based drag (from a handle) + bottom-right resize. Mouse + touch via
// Pointer Events; clamps to the viewport; optional corner-snap on release.
export function useDragResize(initial: Box, opts: Opts = {}) {
  const { minW = 240, minH = 160, snap = false, margin = 12 } = opts;
  const [box, setBox] = useState<Box>(initial);
  const boxRef = useRef(box); boxRef.current = box;

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const orig = boxRef.current;
    const move = (ev: PointerEvent) => {
      const next = clampBox({ ...orig, x: orig.x + (ev.clientX - startX), y: orig.y + (ev.clientY - startY) }, innerWidth, innerHeight);
      setBox(next);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (snap) setBox((b) => clampBox(nearestCorner(b, innerWidth, innerHeight, margin), innerWidth, innerHeight));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }, [snap, margin]);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const orig = boxRef.current;
    const move = (ev: PointerEvent) => {
      const w = Math.max(minW, orig.w + (ev.clientX - startX));
      const h = Math.max(minH, orig.h + (ev.clientY - startY));
      setBox(clampBox({ ...orig, w, h }, innerWidth, innerHeight));
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }, [minW, minH]);

  return { box, setBox, startDrag, startResize };
}
```

- [ ] **Step 4: Run tests (expect pass)** — `npm test -- useDragResize`
- [ ] **Step 5: Commit** — `git add hooks/useDragResize.ts hooks/useDragResize.test.ts && git commit -m "Add useDragResize hook (pointer drag + corner resize + snap) with helper tests"`

---

### Task 3: `everConnected` flag + Connecting/Reconnecting distinction

**Files:**
- Modify: `hooks/useWebRTC.ts` (`RemotePeer`, `PeerEntry`, `oniceconnectionstatechange`, `syncPeers`)
- Modify: `components/CallManager.tsx` (`CallTile` reconnecting label)

- [ ] **Step 1:** Add `everConnected: boolean` to `RemotePeer` and to `PeerEntry` (init `false`). In `createPeer`'s `oniceconnectionstatechange`, set `entry.everConnected = true` when `st === 'connected' || st === 'completed'`. In `syncPeers`, include `everConnected: e.everConnected`.

- [ ] **Step 2:** In `CallManager`, change the reconnecting computation so the tile distinguishes states. Replace the boolean `reconnecting` prop with a `connState` so `CallTile` can label correctly:
```ts
const dropped = p.state === 'disconnected' || p.state === 'failed';
const connecting = !p.everConnected && (p.state === 'checking' || p.state === 'new');
```
Pass `reconnecting={dropped}` and a new `connecting={connecting}` to `CallTile`; in `CallTile` render the overlay when `reconnecting || connecting` with text `reconnecting ? 'Reconnecting…' : 'Connecting…'`. (A freshly-joined peer no longer says "Reconnecting".)

- [ ] **Step 3:** Build + tests (clean / 20 pass; note the useWebRTC test may assert the peer shape — update it if it checks fields).
- [ ] **Step 4:** Commit — `git commit -am "Calls: distinguish Connecting from Reconnecting (per-peer everConnected)"`

---

### Task 4: iPhone spotlight (1-on-1 video) + draggable self-view PiP

**Files:**
- Modify: `components/CallManager.tsx`

Add a desktop check + a spotlight branch in the incall body. The grid stays for group/audio.

- [ ] **Step 1: Desktop detection hook** (top of `CallManager.tsx`, module scope):
```tsx
function useIsDesktop(): boolean {
  const [d, setD] = React.useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px) and (pointer: fine)').matches);
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px) and (pointer: fine)');
    const on = () => setD(mq.matches); mq.addEventListener('change', on); return () => mq.removeEventListener('change', on);
  }, []);
  return d;
}
```

- [ ] **Step 2: Draggable self-view PiP component** (in `CallManager.tsx`):
```tsx
const SelfViewPiP: React.FC<{ stream: MediaStream | null; mirror: boolean; showVideo: boolean; avatar: string }>
  = ({ stream, mirror, showVideo, avatar }) => {
  const start = { x: 0, y: 0, w: 0, h: 0 }; // set on mount from viewport (see below)
  const { box, setBox, startDrag } = useDragResize(start, { snap: true, minW: 96, minH: 128, margin: 12 });
  React.useEffect(() => {
    const w = Math.min(140, window.innerWidth * 0.32); const h = w * 1.34;
    setBox({ x: window.innerWidth - w - 14, y: window.innerHeight - h - 120, w, h });
  }, [setBox]);
  return (
    <div
      onPointerDown={startDrag}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      className="absolute z-40 rounded-2xl overflow-hidden border-2 border-white/25 shadow-2xl cursor-grab active:cursor-grabbing touch-none bg-slate-900"
    >
      <CallTile stream={stream} name="You" avatar={avatar} muted mirror={mirror} showVideo={showVideo} />
    </div>
  );
};
```
(`CallTile` already fills its parent `w-full h-full`. The `touch-none` class prevents the page scrolling while dragging.)

- [ ] **Step 3: Spotlight branch in the incall body.** Compute:
```ts
const isVideo = callType === 'video';
const oneRemote = peers.length === 1;
const spotlight = isVideo && oneRemote; // iPhone style
```
When `spotlight`: render the single remote `CallTile` filling the surface (`absolute inset-0`, `showVideo` from the same `!t.muted` live-track gate, `sharing` badge, `reconnecting`/`connecting` overlay), plus `<SelfViewPiP stream={localStream} mirror={showLocalVideo} showVideo={showLocalVideo} avatar={config.avatarURL} />`. Otherwise render the existing grid unchanged. Keep the controls bar + top bar identical for both.

- [ ] **Step 4:** Build + verify in browser at desktop and mobile widths (spotlight only when 1 remote + video; grid otherwise; self-view drags + snaps; hidden-as-avatar while screen sharing because `showLocalVideo` is already false then).
- [ ] **Step 5:** Commit — `git commit -am "Calls: iPhone-style spotlight for 1-on-1 video + draggable self-view PiP"`

---

### Task 5: Window modes — full / windowed (desktop drag+resize) / control buttons

**Files:**
- Modify: `components/CallManager.tsx`

- [ ] **Step 1: State + reset.** Add:
```ts
type WindowMode = 'full' | 'window' | 'min';
const [windowMode, setWindowMode] = React.useState<WindowMode>('full');
const isDesktop = useIsDesktop();
React.useEffect(() => { if (status !== 'incall') setWindowMode('full'); }, [status]);
React.useEffect(() => { if (!isDesktop && windowMode === 'window') setWindowMode('full'); }, [isDesktop, windowMode]);
```

- [ ] **Step 2: Extract the incall UI into `renderSurface()`** — the existing top bar + body (grid/spotlight) + controls, taking a `variant: 'full' | 'window'`. Move the window-control buttons into the **top bar** (right group), shown next to the participant count:
  - minimize button (lucide `Minus`) → `setWindowMode('min')` (all platforms).
  - windowed/full toggle (lucide `Maximize2`/`Minimize2`) → toggles `full`↔`window` (desktop only — hide on mobile).
  - (pop-out button added in Task 7.)
  The body must use the **container's** size, not `inset-0`, so switch the body wrappers from `fixed inset-0` assumptions to `absolute inset-0`/`h-full` inside the surface root (the surface root is `relative w-full h-full overflow-hidden bg-slate-950`).

- [ ] **Step 3: Draggable/resizable window wrapper.** Add a `DraggableWindow` (in-file) using `useDragResize`:
```tsx
const DraggableWindow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const init = { x: Math.max(0, window.innerWidth - 760) / 2, y: 60, w: Math.min(760, window.innerWidth - 24), h: Math.min(560, window.innerHeight - 120) };
  const { box, startDrag, startResize } = useDragResize(init, { minW: 360, minH: 280 });
  return (
    <div style={{ left: box.x, top: box.y, width: box.w, height: box.h }} className="fixed z-[100] rounded-2xl overflow-hidden shadow-2xl border border-white/15 bg-slate-950">
      {/* drag strip overlaid on the surface top bar */}
      <div onPointerDown={startDrag} className="absolute top-0 left-0 right-0 h-12 z-40 cursor-grab active:cursor-grabbing touch-none" />
      <div className="w-full h-full">{children}</div>
      {/* resize handle */}
      <div onPointerDown={startResize} className="absolute bottom-0 right-0 w-5 h-5 z-50 cursor-nwse-resize" />
    </div>
  );
};
```
The drag strip sits ABOVE the top bar but must not eat the window-control buttons — give those buttons `relative z-50` so they stay clickable above the strip, or place the strip only on the left portion. (Implementer: ensure buttons remain clickable — simplest is the strip spans the bar minus a right inset where the buttons live.)

- [ ] **Step 4: Choose the container in `renderContent` incall branch:**
```tsx
if (status === 'incall') {
  if (windowMode === 'min') return <MinimizedCallBubble ... />; // Task 6
  const surface = renderSurface(windowMode === 'window' && isDesktop ? 'window' : 'full');
  if (windowMode === 'window' && isDesktop) return <DraggableWindow>{surface}</DraggableWindow>;
  return <div className="fixed inset-0 z-[100] bg-slate-950">{surface}</div>;
}
```

- [ ] **Step 5:** Build + browser-verify on desktop: minimize→(bubble, Task 6), window toggle drags + resizes within bounds, controls still work; mobile shows no window/resize affordances.
- [ ] **Step 6:** Commit — `git commit -am "Calls: window modes — full/windowed with desktop drag+resize + window controls"`

---

### Task 6: Minimized floating bubble

**Files:**
- Create: `components/MinimizedCallBubble.tsx`
- Modify: `components/CallManager.tsx` (render it for `windowMode === 'min'`, pass props)

- [ ] **Step 1: Component.** Props: `{ stream, avatar, name, showVideo, mirror, sharing, isMuted, onToggleMute, onHangup, onRestore }`. Portal a small draggable card to `document.body`:
```tsx
import { createPortal } from 'react-dom';
import { Mic, MicOff, PhoneOff, Maximize2 } from 'lucide-react';
import { useDragResize } from '../hooks/useDragResize';

const MinimizedCallBubble: React.FC<Props> = ({ stream, avatar, name, showVideo, mirror, sharing, isMuted, onToggleMute, onHangup, onRestore }) => {
  const { box, setBox, startDrag } = useDragResize({ x: 0, y: 0, w: 220, h: 150 }, { snap: true, margin: 12 });
  React.useEffect(() => { setBox((b) => ({ ...b, x: window.innerWidth - b.w - 16, y: window.innerHeight - b.h - 90 })); }, [setBox]);
  return createPortal(
    <div onPointerDown={startDrag} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      className="fixed z-[120] rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-slate-900 cursor-grab active:cursor-grabbing touch-none">
      {/* video / avatar — reuse CallTile via a thin wrapper or inline a <video> */}
      <BubbleVideo stream={stream} avatar={avatar} showVideo={showVideo} mirror={mirror} />
      <button onClick={onRestore} onPointerDown={(e) => e.stopPropagation()} aria-label="Restore call"
        className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70"><Maximize2 size={14} /></button>
      <div className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-3 p-1.5 bg-gradient-to-t from-black/80 to-transparent">
        <button onClick={onToggleMute} onPointerDown={(e) => e.stopPropagation()} aria-label="Toggle mute"
          className={`p-2 rounded-full ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-700/80 text-white'}`}>{isMuted ? <MicOff size={16} /> : <Mic size={16} />}</button>
        <button onClick={onHangup} onPointerDown={(e) => e.stopPropagation()} aria-label="Hang up"
          className="p-2 rounded-full bg-red-600 text-white hover:bg-red-700"><PhoneOff size={16} fill="currentColor" /></button>
      </div>
      <span className="absolute bottom-12 left-2 px-2 py-0.5 bg-black/50 rounded-full text-[10px] text-white/90 truncate max-w-[70%]">{sharing ? '🖥 ' : ''}{name}</span>
    </div>,
    document.body
  );
};
```
`BubbleVideo` is a tiny local component binding `stream` to a `<video autoPlay playsInline muted>` (muted — audio plays from the main audio elements, which keep mounted? NO — see Step 3) with the avatar fallback. **Buttons call `e.stopPropagation()` on `onPointerDown`** so dragging the card doesn't fire them.

- [ ] **Step 2: Wire in `CallManager`.** For `windowMode === 'min'`, pick the bubble's primary stream: the single remote (spotlight), else the first remote, else local; pass `onRestore={() => setWindowMode('full')}`, `onToggleMute={toggleMute}`, `onHangup={hangup}`.

- [ ] **Step 3: CRITICAL — keep remote audio playing while minimized.** The grid/spotlight `<video>` elements unmount when we render only the bubble, which would **drop remote audio**. The bubble shows ONE video; other peers' audio would go silent. Fix: render a hidden, always-mounted **audio sink** for every remote stream regardless of window mode — a small `RemoteAudioSinks` component (`peers.map` → `<audio autoPlay muted={isSpeakerMuted}>` bound to each `p.stream`) mounted at the CallManager root (outside `renderContent`). Then bubble/spotlight/grid `<video>` elements can stay `muted` and audio never depends on which tile is visible. Verify audio continues when minimized.

- [ ] **Step 4:** Build + browser-verify: minimize shows the bubble, drag+snap works, restore returns to full, mute/hangup work, **remote audio keeps playing** when minimized.
- [ ] **Step 5:** Commit — `git add components/MinimizedCallBubble.tsx components/CallManager.tsx && git commit -m "Calls: minimized floating bubble + always-on remote audio sinks"`

---

### Task 7: Document Picture-in-Picture pop-out

**Files:**
- Create: `utils/documentPip.ts`
- Modify: `components/CallManager.tsx`

- [ ] **Step 1: Util.**
```ts
// Document Picture-in-Picture: a real OS-level always-on-top window. Chrome/Edge
// desktop only. Returns the PiP Window (caller portals React into its body).
export function docPipSupported(): boolean {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}
export async function openDocPip(width = 360, height = 240): Promise<Window | null> {
  try {
    const w: Window = await (window as any).documentPictureInPicture.requestWindow({ width, height });
    copyStyles(w.document);
    return w;
  } catch { return null; }
}
function copyStyles(doc: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      const style = doc.createElement('style'); style.textContent = css; doc.head.appendChild(style);
    } catch {
      if (sheet.href) { const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; doc.head.appendChild(link); }
    }
  }
  doc.body.style.margin = '0'; doc.body.style.background = '#020617';
}
```

- [ ] **Step 2: Wire pop-out in `CallManager`.**
```ts
const [pipWindow, setPipWindow] = React.useState<Window | null>(null);
const openPip = async () => {
  const w = await openDocPip(360, 240);
  if (!w) { setWindowMode('min'); return; } // fallback to bubble
  w.addEventListener('pagehide', () => setPipWindow(null));
  setPipWindow(w);
};
React.useEffect(() => { if (status !== 'incall' && pipWindow) { pipWindow.close(); setPipWindow(null); } }, [status, pipWindow]);
```
Add a pop-out button (lucide `PictureInPicture2`) in the top-bar control group, shown only when `docPipSupported()`.

- [ ] **Step 3: Render into the PiP window.** When `pipWindow` is set, portal the **bubble content** (reuse the bubble's inner layout, or a compact surface) into `pipWindow.document.body`:
```tsx
if (status === 'incall' && pipWindow) {
  return createPortal(<PipCallView .../>, pipWindow.document.body);
}
```
`PipCallView` = the same compact video + controls as the bubble but without the drag wrapper (the OS window IS the drag surface). Reuse `BubbleVideo` + control buttons. Restore/close button calls `pipWindow.close()`. The always-on `RemoteAudioSinks` (Task 6) keep audio in the MAIN document, so audio is unaffected by the pop-out.

- [ ] **Step 4:** Build + browser-verify in Chrome (pop-out opens a real window with correct styles + live video + working mute/hangup; closing it restores). In a non-supporting context the button is absent and minimize still works.
- [ ] **Step 5:** Commit — `git add utils/documentPip.ts components/CallManager.tsx && git commit -m "Calls: Document Picture-in-Picture pop-out (Chrome/Edge) with bubble fallback"`

---

### Task 8: Final integration review, build, tests

**Files:** (review across) `hooks/useWebRTC.ts`, `hooks/useDragResize.ts`, `components/CallManager.tsx`, `components/MinimizedCallBubble.tsx`, `utils/documentPip.ts`

- [ ] **Step 1:** Full read-through for: window-mode transitions during screen share (sharing must persist across full↔window↔min↔pip — it lives in the hook, so it should); spotlight ↔ grid switch when a 2nd peer joins/leaves; self-view hidden (avatar) while sharing; controls clickable under drag strips; no `noUnusedLocals` violations; the `tailwindcss-animate` classes intact.
- [ ] **Step 2:** `npm run build` (clean) + `npm test` (all pass).
- [ ] **Step 3:** Confirm: mobile shows NO window/resize/pop-out affordances (only full + minimize bubble); desktop shows all.
- [ ] **Step 4:** Final commit if any fixes — `git commit -am "Flexible call windows: final integration fixes"` — then push all: `git push origin main`.

---

## Verification summary

- `tsc` + `vite build` clean; Vitest green (existing 20 + new drag-helper tests).
- Real-device confirmation by the user (CI has no media): desktop drag/resize/minimize/pop-out; iPhone spotlight + draggable self-view + all 5 voice presets × mute/share; reconnecting shows on drop.
