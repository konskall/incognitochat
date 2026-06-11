# Screen Sharing (with audio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add screen sharing with audio to the existing mesh WebRTC calls — initiate on desktop/Android, view everywhere (incl. iOS).

**Architecture:** Reuse the mesh in `hooks/useWebRTC.ts`. Every call (incl. audio) keeps an always-present video sender so a screen track is sent via `replaceTrack` with no renegotiation. Screen audio is mixed with the mic through one unified Web Audio graph that also owns voice filters + mute. The receiving side renders any incoming video track. Multiple simultaneous sharers are allowed (each replaces only its own video).

**Tech Stack:** React 18 + TS, `getDisplayMedia`, RTCPeerConnection, Web Audio API, Supabase realtime broadcast, Vitest, lucide-react.

**Testing reality:** Media/WebRTC code cannot be meaningfully unit-tested in jsdom (no real `RTCPeerConnection`/`AudioContext`/media). Following the existing repo precedent (`hooks/useWebRTC.test.ts` only tests the pure `mediaErrorMessage`; calls were verified on real devices), only the new pure helpers get unit tests. The hook/UI tasks are verified by `npm run build` (full `tsc`) plus a real-device manual checklist in the final task. This is intentional, not a gap.

---

### Task 1: Pure helpers — `getDisplayMediaSupported` + `displayMediaErrorMessage`

**Files:**
- Modify: `utils/helpers.ts` (add two exports near `cleanUrl`)
- Test: `utils/helpers.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `utils/helpers.test.ts`:

```ts
import { getDisplayMediaSupported, displayMediaErrorMessage } from './helpers';

describe('getDisplayMediaSupported', () => {
  const orig = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  afterEach(() => {
    if (orig) Object.defineProperty(navigator, 'mediaDevices', orig);
  });

  it('is true when getDisplayMedia exists', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: () => {} }, configurable: true,
    });
    expect(getDisplayMediaSupported()).toBe(true);
  });

  it('is false when getDisplayMedia is missing (iOS)', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    expect(getDisplayMediaSupported()).toBe(false);
  });
});

describe('displayMediaErrorMessage', () => {
  it('returns null when the user cancels the picker', () => {
    expect(displayMediaErrorMessage({ name: 'NotAllowedError' })).toBeNull();
    expect(displayMediaErrorMessage({ name: 'AbortError' })).toBeNull();
  });
  it('explains a screen that cannot be captured', () => {
    expect(displayMediaErrorMessage({ name: 'NotReadableError' })).toMatch(/in use/i);
  });
  it('falls back to a generic message', () => {
    expect(displayMediaErrorMessage({ name: 'WeirdError' })).toMatch(/could not start screen sharing/i);
    expect(displayMediaErrorMessage(null)).toMatch(/could not start screen sharing/i);
  });
});
```

Add `afterEach` to the existing vitest import at the top of the file if not present (`import { describe, it, expect, afterEach } from 'vitest';`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- helpers`
Expected: FAIL — `getDisplayMediaSupported`/`displayMediaErrorMessage` are not exported.

- [ ] **Step 3: Implement the helpers**

In `utils/helpers.ts`, add after the `cleanUrl` function:

```ts
// True only where the page can INITIATE a screen share. iOS Safari / iOS PWA
// (WebKit) do not implement getDisplayMedia at all, so this is false there —
// the UI uses it to show an explanatory toast instead of a broken button.
export function getDisplayMediaSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

// User-facing message for a getDisplayMedia failure, or null when the user
// simply dismissed the picker (NotAllowedError/AbortError) — a deliberate
// cancel that should show nothing.
export function displayMediaErrorMessage(err: unknown): string | null {
  const name = (err as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'AbortError') return null;
  if (name === 'NotReadableError')
    return 'Could not capture the screen — it may be in use by another app.';
  return 'Could not start screen sharing on this device.';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- helpers`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add utils/helpers.ts utils/helpers.test.ts
git commit -m "feat(calls): screen-share support check + error-message helpers"
```

---

### Task 2: Extend `SignalData` with the `screenshare` event

**Files:**
- Modify: `types.ts:84-92`

- [ ] **Step 1: Add the event to the type**

Replace the `SignalData` interface (lines 84-92) with:

```ts
export interface SignalData {
  type: 'offer' | 'answer' | 'candidate' | 'join' | 'present' | 'leave' | 'screenshare';
  payload?: RTCSessionDescriptionInit | RTCIceCandidateInit | null;
  fromUid: string;
  fromName: string;
  fromAvatar: string;
  toUid?: string;
  callType?: 'audio' | 'video';
  // For type === 'screenshare': whether the sender just started (true) or
  // stopped (false) sharing. Cosmetic only — drives a tile badge; media never
  // depends on it.
  sharing?: boolean;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (no usages yet; this only widens the union).

- [ ] **Step 3: Commit**

```bash
git add types.ts
git commit -m "feat(calls): add screenshare event to SignalData"
```

---

### Task 3: Unified outgoing-audio + always-present video sender (refactor, behavior-preserving)

This refactors the audio path and `createPeer` WITHOUT adding screen share yet. After this task, existing audio/video calls, voice filters, mute, and camera switch must behave exactly as before — plus audio calls now negotiate an inactive video m-line.

**Files:**
- Modify: `hooks/useWebRTC.ts`

- [ ] **Step 1: Add refs/state for the unified audio graph**

In `useWebRTC`, just after the existing `audioCtxRef` declaration (~line 103), add ALL of these (the screen refs are declared here too because `buildOutgoingAudio` in Step 2 reads `screenStreamRef`):

```ts
  // Unified outgoing-audio graph: mic (+voice filter) (+screen audio) → dest.
  const micGainRef = useRef<GainNode | null>(null);            // mute = gain 0/1 when graph active
  const outgoingAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const voiceFilterRef = useRef(voiceFilter);
  const isMutedRef = useRef(isMuted);
  // Screen share (filled in Task 4; declared now so the audio graph can read them).
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const isScreenSharingRef = useRef(false);
```

And add the mirroring effects next to the other ref-mirrors (~line 92):

```ts
  useEffect(() => { voiceFilterRef.current = voiceFilter; }, [voiceFilter]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
```

- [ ] **Step 2: Replace `buildFilteredAudio` with `buildOutgoingAudio` + `applyOutgoingAudio` + `setOutgoingVideo`**

Replace the entire `buildFilteredAudio` useCallback (~lines 137-173) with:

```ts
  // Build the single audio track sent to peers from the current mic, voice
  // filter, screen audio, and mute state. Fast path (normal filter + no screen
  // audio) returns the raw mic track (mute via track.enabled). Otherwise it
  // builds a Web Audio graph: mic → [filter] → micGain → dest, plus screen
  // audio → dest. Tears down any previous graph first.
  const buildOutgoingAudio = useCallback((): MediaStreamTrack | null => {
    const mic = rawStreamRef.current?.getAudioTracks()[0] || null;
    const screenAudio = screenStreamRef.current?.getAudioTracks()[0] || null;
    const filter = voiceFilterRef.current;
    const muted = isMutedRef.current;

    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    micGainRef.current = null;

    if (filter === 'normal' && !screenAudio) {
      if (mic) mic.enabled = !muted;
      return mic;
    }
    if (!mic && !screenAudio) return mic;

    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();

      if (mic) {
        mic.enabled = true; // gain handles mute when the graph is active
        const micSource = ctx.createMediaStreamSource(new MediaStream([mic]));
        let node: AudioNode = micSource;
        if (filter === 'deep') {
          const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
          const g = ctx.createGain(); g.gain.value = 1.5;
          micSource.connect(f); f.connect(g); node = g;
        } else if (filter === 'robot') {
          const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 50; osc.start();
          const ring = ctx.createGain(); ring.gain.value = 1.0;
          micSource.connect(ring); osc.connect(ring.gain);
          const dry = ctx.createGain(); dry.gain.value = 0.4;
          micSource.connect(dry);
          const merge = ctx.createGain();
          ring.connect(merge); dry.connect(merge); node = merge;
        }
        const micGain = ctx.createGain(); micGain.gain.value = muted ? 0 : 1;
        node.connect(micGain); micGain.connect(dest);
        micGainRef.current = micGain;
      }

      if (screenAudio) {
        const sSource = ctx.createMediaStreamSource(new MediaStream([screenAudio]));
        sSource.connect(dest);
      }

      return dest.stream.getAudioTracks()[0] || mic;
    } catch {
      return mic;
    }
  }, []);

  // Rebuild outgoing audio and push it to sendStreamRef + every peer's audio sender.
  const applyOutgoingAudio = useCallback(() => {
    const track = buildOutgoingAudio();
    const send = sendStreamRef.current;
    if (send) {
      send.getAudioTracks().forEach((t) => { if (t !== track) send.removeTrack(t); });
      if (track && !send.getTracks().includes(track)) send.addTrack(track);
    }
    outgoingAudioTrackRef.current = track;
    if (!track) return;
    peersRef.current.forEach((e) => {
      const sender = e.pc.getSenders().find((s) => s.track?.kind === 'audio');
      sender?.replaceTrack(track).catch((err) => console.error('replaceTrack audio', err));
    });
  }, [buildOutgoingAudio]);

  // Swap the outgoing VIDEO track (camera, screen, or null) on sendStreamRef +
  // every peer's video sender. The video sender always exists (see createPeer).
  const setOutgoingVideo = useCallback((track: MediaStreamTrack | null) => {
    const send = sendStreamRef.current;
    if (send) {
      send.getVideoTracks().forEach((t) => send.removeTrack(t));
      if (track) send.addTrack(track);
    }
    peersRef.current.forEach((e) => {
      const sender =
        e.pc.getSenders().find((s) => s.track?.kind === 'video') ||
        e.pc.getSenders().find((s) => s.track === null);
      sender?.replaceTrack(track).catch((err) => console.error('replaceTrack video', err));
    });
  }, []);

  // Rebuild the LOCAL preview stream (mic + the given video track) as a NEW
  // MediaStream so CallTile's effect re-binds it.
  const setLocalView = useCallback((videoTrack: MediaStreamTrack | null) => {
    const mic = rawStreamRef.current?.getAudioTracks()[0];
    const tracks: MediaStreamTrack[] = [];
    if (mic) tracks.push(mic);
    if (videoTrack) tracks.push(videoTrack);
    setLocalStream(new MediaStream(tracks));
  }, []);
```

- [ ] **Step 3: (refs already added in Step 1 — nothing to do here; proceed)**

- [ ] **Step 4: Make `createPeer` always create a video sender**

In `createPeer`, replace the track-attach block (~lines 230-233):

```ts
    // Attach our outgoing tracks.
    sendStreamRef.current?.getTracks().forEach((t) => {
      try { pc.addTrack(t, sendStreamRef.current!); } catch (e) { console.error('addTrack', e); }
    });
```

with:

```ts
    // Attach outgoing tracks. ALWAYS ensure a video sender exists (even in an
    // audio call) so a later screen share is just replaceTrack — no renegotiation.
    const send = sendStreamRef.current;
    const outAudio = send?.getAudioTracks()[0];
    if (send && outAudio) { try { pc.addTrack(outAudio, send); } catch (e) { console.error('addTrack audio', e); } }
    const outVideo = send?.getVideoTracks()[0];
    if (send && outVideo) {
      try { pc.addTrack(outVideo, send); } catch (e) { console.error('addTrack video', e); }
    } else {
      try { pc.addTransceiver('video', { direction: 'sendrecv' }); } catch (e) { console.error('addTransceiver video', e); }
    }
```

- [ ] **Step 5: Rewrite `cycleVoiceFilter`, `toggleMute`, `switchCamera` to use the new helpers**

Replace `toggleMute` (~lines 444-451):

```ts
  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    if (micGainRef.current) {
      micGainRef.current.gain.value = next ? 0 : 1; // graph active (filter/screen)
    } else {
      rawStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    }
  }, []);
```

Replace `cycleVoiceFilter` (~lines 461-476):

```ts
  const cycleVoiceFilter = useCallback(() => {
    const next: VoiceFilterType = voiceFilter === 'normal' ? 'deep' : voiceFilter === 'deep' ? 'robot' : 'normal';
    setVoiceFilter(next);
    voiceFilterRef.current = next;
    applyOutgoingAudio();
  }, [voiceFilter, applyOutgoingAudio]);
```

Replace `switchCamera` (~lines 478-500):

```ts
  const switchCamera = useCallback(async () => {
    if (callTypeRef.current !== 'video' || isScreenSharingRef.current) return;
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    try {
      rawStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: newMode } });
      const newVideo = fresh.getVideoTracks()[0];
      const mic = rawStreamRef.current?.getAudioTracks()[0];
      rawStreamRef.current = new MediaStream(mic ? [mic, newVideo] : [newVideo]);
      setOutgoingVideo(newVideo);
      setLocalView(newVideo);
      setFacingMode(newMode);
    } catch (e) {
      console.error('switchCamera failed', e);
    }
  }, [facingMode, setOutgoingVideo, setLocalView]);
```

- [ ] **Step 6: Ensure `getMedia` seeds the managed send stream**

In `getMedia` (~lines 373-376), the assignments become:

```ts
    rawStreamRef.current = stream;
    sendStreamRef.current = new MediaStream(stream.getTracks());
    outgoingAudioTrackRef.current = stream.getAudioTracks()[0] || null;
    setLocalStream(stream);
    return stream;
```

- [ ] **Step 7: Verify it builds and behaves identically**

Run: `npm run build`
Expected: build succeeds, no TS errors.

Manual (desktop, two browser profiles in one room): start an audio call → both connect and hear each other; cycle voice filter (deep/robot) → remote hears the effect; mute/unmute → remote audio cuts/returns. Start a video call → video both ways; switch camera works; mute works. (This proves the refactor preserved behavior before screen share is added.)

- [ ] **Step 8: Commit**

```bash
git add hooks/useWebRTC.ts
git commit -m "refactor(calls): unified outgoing-audio graph + always-present video sender"
```

---

### Task 4: `startScreenShare` / `stopScreenShare` + `isScreenSharing`

**Files:**
- Modify: `hooks/useWebRTC.ts`

- [ ] **Step 1: Add `isScreenSharing` state**

Next to the other call state (~line 83), add:

```ts
  const [isScreenSharing, setIsScreenSharing] = useState(false);
```

- [ ] **Step 2: Import the helpers**

Update the helpers import at the top of `hooks/useWebRTC.ts`:

```ts
import { initAudio, startRingtone, stopRingtone, getDisplayMediaSupported, displayMediaErrorMessage } from '../utils/helpers';
```

- [ ] **Step 3: Add `stopScreenShare` then `startScreenShare`**

Add these two useCallbacks right after `switchCamera` (define stop first so start can depend on it):

```ts
  const stopScreenShare = useCallback(() => {
    if (!isScreenSharingRef.current) return;
    const display = screenStreamRef.current;

    // Restore video: camera (video call) or none (audio call → avatar).
    const restore = callTypeRef.current === 'video' ? cameraVideoTrackRef.current : null;
    setOutgoingVideo(restore);
    setLocalView(restore);
    cameraVideoTrackRef.current = null;

    // Stop the capture AFTER swapping away from its tracks.
    display?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;

    applyOutgoingAudio(); // rebuild mix without screen audio

    isScreenSharingRef.current = false;
    setIsScreenSharing(false);
    sendSignal({ type: 'screenshare', sharing: false });
  }, [setOutgoingVideo, setLocalView, applyOutgoingAudio, sendSignal]);

  const startScreenShare = useCallback(async () => {
    if (statusRef.current !== 'incall' || isScreenSharingRef.current) return;
    if (!getDisplayMediaSupported()) {
      setNotice({ kind: 'info', text: "Screen sharing isn't supported on this device (iPhone/iPad). It works on desktop and Android." });
      return;
    }
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch (err) {
      const msg = displayMediaErrorMessage(err);
      if (msg) setNotice({ kind: 'error', text: msg }); // null = user cancelled, stay silent
      return;
    }
    screenStreamRef.current = display;
    const screenVideo = display.getVideoTracks()[0];

    cameraVideoTrackRef.current =
      callTypeRef.current === 'video' ? (rawStreamRef.current?.getVideoTracks()[0] || null) : null;

    setOutgoingVideo(screenVideo);
    setLocalView(screenVideo);
    applyOutgoingAudio(); // fold screen audio (if any) into the mix

    screenVideo.onended = () => { stopScreenShare(); }; // browser's native "Stop sharing"

    isScreenSharingRef.current = true;
    setIsScreenSharing(true);
    sendSignal({ type: 'screenshare', sharing: true });
  }, [setOutgoingVideo, setLocalView, applyOutgoingAudio, sendSignal, stopScreenShare]);
```

- [ ] **Step 4: Stop the capture in `cleanup`**

In `cleanup` (~lines 379-400), add after the `rawStreamRef` stop lines:

```ts
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    cameraVideoTrackRef.current = null;
    micGainRef.current = null;
    outgoingAudioTrackRef.current = null;
    isScreenSharingRef.current = false;
```

And add to the state resets at the end of `cleanup`:

```ts
    setIsScreenSharing(false);
```

- [ ] **Step 5: Export the new API**

In the returned object (~lines 535-558), add:

```ts
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add hooks/useWebRTC.ts
git commit -m "feat(calls): start/stop screen share (replace video, mix screen audio)"
```

---

### Task 5: Sharing badges — `screenshare` broadcast + `sharingUids`

**Files:**
- Modify: `hooks/useWebRTC.ts`

- [ ] **Step 1: Add `sharingUids` state**

Next to `peers` state (~line 74):

```ts
  const [sharingUids, setSharingUids] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Handle the `screenshare` signal**

In `handleSignal`'s switch, add a case (after `'leave'`):

```ts
      case 'screenshare': {
        setSharingUids((prev) => {
          const next = new Set(prev);
          if (data.sharing) next.add(data.fromUid); else next.delete(data.fromUid);
          return next;
        });
        break;
      }
```

- [ ] **Step 3: Drop a peer from `sharingUids` when it leaves**

In `removePeer`, after `peersRef.current.delete(uid);`:

```ts
      setSharingUids((prev) => {
        if (!prev.has(uid)) return prev;
        const next = new Set(prev); next.delete(uid); return next;
      });
```

- [ ] **Step 4: Reset `sharingUids` in `cleanup`**

Add to `cleanup`'s state resets:

```ts
    setSharingUids(new Set());
```

- [ ] **Step 5: Export `sharingUids`**

Add to the returned object:

```ts
    sharingUids,
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add hooks/useWebRTC.ts
git commit -m "feat(calls): broadcast + track who is screen sharing (tile badge)"
```

---

### Task 6: CallManager — share button, unsupported toast, hide switch-camera while sharing

**Files:**
- Modify: `components/CallManager.tsx`

- [ ] **Step 1: Import the icons + new hook API**

Update the lucide import (line 3) to add `MonitorUp, MonitorX`:

```ts
import { Phone, Video, Mic, MicOff, PhoneOff, X, User as UserIcon, Crown, AlertCircle, VideoOff, RotateCcw, Signal, Clock, Volume2, VolumeX, Wand2, Users as UsersIcon, MonitorUp, MonitorX } from 'lucide-react';
```

Update the `useWebRTC` destructure (~lines 90-96) to add the new fields:

```ts
  const {
    status, callType, incoming, peers, localStream,
    isMuted, isVideoOff, isSpeakerMuted, setIsSpeakerMuted, voiceFilter,
    networkQuality, callDuration, notice, dismissNotice,
    startCall, acceptCall, declineCall, hangup,
    toggleMute, toggleVideo, switchCamera, cycleVoiceFilter,
    isScreenSharing, startScreenShare, stopScreenShare, sharingUids,
  } = useWebRTC(user, config);
```

- [ ] **Step 2: Add the share toggle button to the controls bar**

In the controls `<div>` (the active-call controls, ~lines 206-229), insert this button immediately BEFORE the hangup button:

```tsx
          <button
            onClick={() => (isScreenSharing ? stopScreenShare() : startScreenShare())}
            title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
            aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            className={`p-3.5 rounded-full transition-all shadow-lg ${isScreenSharing ? 'bg-blue-500 text-white' : 'bg-slate-800/80 backdrop-blur-md text-white border border-white/20 hover:bg-slate-700'}`}
          >
            {isScreenSharing ? <MonitorX size={24} /> : <MonitorUp size={24} />}
          </button>
```

- [ ] **Step 3: Hide switch-camera while sharing**

Change the switch-camera button condition (~line 215) from `{isVideo && hasLocalVideo && (` to:

```tsx
          {isVideo && hasLocalVideo && !isScreenSharing && (
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/CallManager.tsx
git commit -m "feat(calls): screen-share toggle button in call controls"
```

---

### Task 7: CallManager — render incoming video tracks + screen badge + local screen tile

**Files:**
- Modify: `components/CallManager.tsx`

- [ ] **Step 1: Let `CallTile` show a "sharing" badge**

Extend the `CallTile` props type and its name badge. Change the props (~lines 37-45) to add `sharing?: boolean`:

```tsx
}> = ({ stream, name, avatar, muted, mirror, showVideo, reconnecting, sharing }) => {
```

Add `sharing?: boolean;` to the prop type literal above (after `reconnecting?: boolean;`).

Replace the bottom name badge (~lines 74-76) with one that prefixes a monitor glyph when sharing:

```tsx
      <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/50 backdrop-blur-md rounded-full text-[11px] text-white/90 font-medium max-w-[80%] truncate flex items-center gap-1">
        {sharing && <MonitorUp size={12} className="shrink-0 text-blue-300" />}
        {name}
      </div>
```

- [ ] **Step 2: Render remote tiles whenever the peer sends video (not gated on call type)**

In the active-call tile grid, replace the remote `peers.map(...)` block (~lines 174-188) with:

```tsx
          {peers.map((p: RemotePeer) => {
            const hasVideo = p.stream.getVideoTracks().some((t) => t.readyState === 'live');
            const reconnecting = p.state === 'disconnected' || p.state === 'failed' || p.state === 'checking';
            const peerSharing = sharingUids.has(p.uid);
            return (
              <CallTile
                key={p.uid}
                stream={p.stream}
                name={p.name}
                avatar={p.avatar}
                muted={isSpeakerMuted}
                showVideo={hasVideo}
                reconnecting={reconnecting}
                sharing={peerSharing}
              />
            );
          })}
```

- [ ] **Step 3: Show the local screen while sharing + badge**

Replace the local `<CallTile ... name="You" />` (~lines 189-196) with:

```tsx
          <CallTile
            stream={localStream}
            name="You"
            avatar={config.avatarURL}
            muted
            mirror={!isScreenSharing}
            showVideo={(isScreenSharing && hasLocalVideo) || (isVideo && !isVideoOff && hasLocalVideo)}
            sharing={isScreenSharing}
          />
```

(`hasLocalVideo` is already computed earlier in the `incall` branch as `!!localStream && localStream.getVideoTracks().length > 0`; while sharing, `setLocalView` put the screen track on `localStream`, so it is true.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add components/CallManager.tsx
git commit -m "feat(calls): show incoming screen shares + sharing tile badge"
```

---

### Task 8: Full real-device verification + ship

**Files:** none (verification only).

- [ ] **Step 1: Build clean**

Run: `npm run build`
Expected: `tsc` + vite build succeed with no errors.

- [ ] **Step 2: Unit tests green**

Run: `npm test`
Expected: all tests pass (incl. the Task 1 helpers).

- [ ] **Step 3: Manual checklist — desktop ↔ desktop (two browser profiles, same room)**

Verify each, in order:
- Audio call → "Share screen" → pick a tab/window WITH audio (e.g. a YouTube tab) → the other side SEES the screen and HEARS its audio AND your mic together.
- Stop via the in-call button → the other side reverts to your avatar; screen-capture indicator stops.
- Repeat, stopping via the browser's native "Stop sharing" bar → same result (onended path).
- Voice filter (deep/robot) while sharing → remote hears the filter on your voice, screen audio unaffected.
- Mute while sharing → your voice cuts, screen audio still heard; unmute restores.
- Video call → share → camera replaced by screen for the remote; stop → camera returns.
- Two participants share at once → you see two screen tiles in the grid, each badged.
- Hang up while sharing → capture stops, no leaked getDisplayMedia.

- [ ] **Step 4: Manual checklist — mobile**

- Android Chrome (or installed PWA), in a call → "Share screen" → screen video reaches the others (audio may be absent on Android — expected).
- iOS PWA → "Share screen" → info toast "isn't supported on iPhone/iPad…", no broken state.
- iOS PWA as RECEIVER → a desktop peer shares → the iPhone SEES the shared screen.

- [ ] **Step 5: Push**

```bash
git push
```

Expected: GitHub Actions deploys; live screen sharing works on desktop/Android, viewable everywhere.

---

## Notes for the implementer

- **No renegotiation anywhere.** Every track change is `replaceTrack` on a sender that already exists (audio sender from `addTrack`; video sender from `addTrack` or the `addTransceiver('video')` added in Task 3 Step 4). Do not add `onnegotiationneeded` handling.
- **Symmetry matters.** Both peers run the same `createPeer`, so both add exactly one audio + one video sender; the m-lines line up. Don't make the transceiver conditional on call type beyond "is there already a video track".
- **CI has no media.** Tasks 3-7 are build-verified only; real behavior is the Task 8 manual checklist on real devices (same as the original calls feature).
