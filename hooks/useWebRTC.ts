import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, SignalData } from '../types';
import { initAudio, startRingtone, stopRingtone, getDisplayMediaSupported, displayMediaErrorMessage } from '../utils/helpers';

// STUN + TURN (metered.ca). Mesh topology: every participant holds one
// RTCPeerConnection per other participant, so this scales to small groups
// (~4-5) before bandwidth becomes the limit — fine for private rooms.
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:standard.relay.metered.ca:80', username: '4aa8db5b8a8c31527e2495be', credential: '8O6d1Nc3j8iAsTiq' },
    { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username: '4aa8db5b8a8c31527e2495be', credential: '8O6d1Nc3j8iAsTiq' },
    { urls: 'turn:standard.relay.metered.ca:443', username: '4aa8db5b8a8c31527e2495be', credential: '8O6d1Nc3j8iAsTiq' },
    { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username: '4aa8db5b8a8c31527e2495be', credential: '8O6d1Nc3j8iAsTiq' },
  ],
  iceCandidatePoolSize: 10,
};

export type VoiceFilterType = 'normal' | 'deep' | 'robot' | 'monster' | 'alien';
export type CallStatus = 'idle' | 'ringing' | 'incall';
export type CallType = 'audio' | 'video';

export interface RemotePeer {
  uid: string;
  name: string;
  avatar: string;
  stream: MediaStream;
  state: RTCIceConnectionState;
  everConnected: boolean;
}

export interface IncomingCall {
  fromUid: string;
  fromName: string;
  fromAvatar: string;
  callType: CallType;
  // true ⇒ a 1-on-1 call aimed only at me; false ⇒ a room-wide group call.
  direct?: boolean;
}

interface PeerEntry {
  uid: string;
  name: string;
  avatar: string;
  pc: RTCPeerConnection;
  stream: MediaStream;
  candidateQueue: RTCIceCandidateInit[];
  makingOffer: boolean;
  // Cached senders so we always replaceTrack the RIGHT m-line — even when this
  // peer has no mic/camera (then both senders start with a null track, and a
  // "find first null-track sender" heuristic would be ambiguous).
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  everConnected: boolean;
  failTimer: ReturnType<typeof setTimeout> | null;
}

export interface CallNotice {
  kind: 'error' | 'info';
  text: string;
}

// Friendly, specific message for a getUserMedia failure.
export function mediaErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return 'Camera/microphone access was blocked. Allow permission in your browser to join the call.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError')
    return 'No microphone or camera found on this device — the call could not start.';
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'Your microphone or camera is already in use by another app.';
  return 'Could not start the call. Check your microphone/camera and try again.';
}

// Build the per-filter Web Audio chain from a mic source node; returns the tail
// node to connect onward. Oscillators are started immediately (GC'd on ctx close).
function buildVoiceChain(ctx: AudioContext, src: AudioNode, filter: VoiceFilterType): AudioNode {
  if (filter === 'deep') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 1.5;
    src.connect(lp); lp.connect(g); return g;
  }
  if (filter === 'robot') {
    // Bandpass -> pure ring mod (square ~80Hz) -> comb/flanger -> hard-clip waveshaper.
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
    const ring = ctx.createGain(); ring.gain.value = 0; // base 0 => pure ring modulation
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
    const sub = ctx.createGain(); sub.gain.value = 0; // ring mod sub-harmonic
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
function makeClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024; const curve = new Float32Array(new ArrayBuffer(n * 4)); const k = amount * 100;
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return curve;
}

export function useWebRTC(user: User, config: ChatConfig) {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [callType, setCallType] = useState<CallType>('video');
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [sharingUids, setSharingUids] = useState<Set<string>>(new Set());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState<VoiceFilterType>('normal');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<'good' | 'poor' | 'bad'>('good');
  const [callDuration, setCallDuration] = useState(0);
  // Transient banner for call/media problems (no mic/cam, blocked perms, …).
  const [notice, setNotice] = useState<CallNotice | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);

  // Refs mirror state so the signaling callbacks (registered once) never read stale values.
  const statusRef = useRef(status);
  const callTypeRef = useRef(callType);
  const incomingRef = useRef(incoming);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { callTypeRef.current = callType; }, [callType]);
  useEffect(() => { incomingRef.current = incoming; }, [incoming]);
  useEffect(() => { voiceFilterRef.current = voiceFilter; }, [voiceFilter]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const rawStreamRef = useRef<MediaStream | null>(null); // unfiltered getUserMedia (local display + base)
  const sendStreamRef = useRef<MediaStream | null>(null); // what we attach to peers (raw or voice-filtered)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Web Audio voice filter graph
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Unified outgoing-audio graph: mic (+voice filter) (+screen audio) → dest.
  const micGainRef = useRef<GainNode | null>(null);            // mute = gain 0/1 when graph active
  const outgoingAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const voiceFilterRef = useRef(voiceFilter);
  const isMutedRef = useRef(isMuted);
  // Screen share (filled in a later task; declared now so the audio graph can read them).
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isScreenSharingRef = useRef(false);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  // Who I directly rang (1-on-1). null for a group ring. Lets a `decline` from
  // that exact person end my "Waiting…" screen instead of hanging forever.
  const directTargetRef = useRef<string | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incomingQueueRef = useRef<IncomingCall[]>([]);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rebuild the React-facing peer list from the ref map.
  const syncPeers = useCallback(() => {
    setPeers(
      Array.from(peersRef.current.values()).map((e) => ({
        uid: e.uid,
        name: e.name,
        avatar: e.avatar,
        stream: e.stream,
        state: e.pc.iceConnectionState,
        everConnected: e.everConnected,
      }))
    );
  }, []);

  const sendSignal = useCallback(
    (data: Omit<SignalData, 'fromUid' | 'fromName' | 'fromAvatar'>) => {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'signal',
        payload: {
          ...data,
          fromUid: user.uid,
          fromName: config.username,
          fromAvatar: config.avatarURL,
        } as SignalData,
      });
    },
    [user.uid, config.username, config.avatarURL]
  );

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
      ctx.resume().catch(() => {});
      const dest = ctx.createMediaStreamDestination();

      if (mic) {
        mic.enabled = true; // gain handles mute when the graph is active
        const micSource = ctx.createMediaStreamSource(new MediaStream([mic]));
        const node = buildVoiceChain(ctx, micSource, filter);
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
      if (mic) mic.enabled = !isMutedRef.current;
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
      e.audioSender?.replaceTrack(track).catch((err) => console.error('replaceTrack audio', err));
    });
  }, [buildOutgoingAudio]);

  // Swap the outgoing VIDEO track (camera, screen, or null) on sendStreamRef +
  // every peer's cached video sender (always exists — see createPeer).
  const setOutgoingVideo = useCallback((track: MediaStreamTrack | null) => {
    const send = sendStreamRef.current;
    if (send) {
      send.getVideoTracks().forEach((t) => send.removeTrack(t));
      if (track) send.addTrack(track);
    }
    peersRef.current.forEach((e) => {
      e.videoSender?.replaceTrack(track).catch((err) => console.error('replaceTrack video', err));
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

  // --- Peer lifecycle ---
  const drainCandidates = useCallback(async (entry: PeerEntry) => {
    while (entry.candidateQueue.length) {
      const c = entry.candidateQueue.shift();
      if (c) { try { await entry.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.error('addIceCandidate', e); } }
    }
  }, []);

  const removePeer = useCallback((uid: string) => {
    pendingCandidates.current.delete(uid); // drop stale buffered candidates either way
    const entry = peersRef.current.get(uid);
    if (entry) {
      if (entry.failTimer) { clearTimeout(entry.failTimer); entry.failTimer = null; }
      try { entry.pc.close(); } catch { /* noop */ }
      peersRef.current.delete(uid);
      setSharingUids((prev) => {
        if (!prev.has(uid)) return prev;
        const next = new Set(prev); next.delete(uid); return next;
      });
      syncPeers();
      // A participant left and none remain → end my call instead of hanging on
      // "Waiting…/Reconnecting…". (cleanup() runs async-safe: during teardown the
      // map is already empty + status idle, so this no-ops.)
      if (statusRef.current === 'incall' && peersRef.current.size === 0) {
        setNotice({ kind: 'info', text: 'Call ended.' });
        cleanupRef.current();
      }
    }
  }, [syncPeers]);

  const makeOffer = useCallback(async (entry: PeerEntry) => {
    // Only the smaller-uid side of a pair offers, and only once at a time.
    if (entry.makingOffer || entry.pc.signalingState !== 'stable') return;
    entry.makingOffer = true;
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', payload: offer, toUid: entry.uid, callType: callTypeRef.current });
    } catch (e) {
      console.error('makeOffer failed', e);
    } finally {
      entry.makingOffer = false;
    }
  }, [sendSignal]);

  const restartIce = useCallback(async (entry: PeerEntry) => {
    if (entry.makingOffer) return;
    entry.makingOffer = true;
    try {
      const offer = await entry.pc.createOffer({ iceRestart: true });
      await entry.pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', payload: offer, toUid: entry.uid, callType: callTypeRef.current });
    } catch (e) {
      console.error('restartIce failed', e);
    } finally {
      entry.makingOffer = false;
    }
  }, [sendSignal]);

  const createPeer = useCallback((uid: string, name: string, avatar: string): PeerEntry => {
    const existing = peersRef.current.get(uid);
    if (existing) return existing;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    const stream = new MediaStream();
    const entry: PeerEntry = { uid, name, avatar, pc, stream, candidateQueue: [], makingOffer: false, audioSender: null, videoSender: null, everConnected: false, failTimer: null };
    peersRef.current.set(uid, entry);

    // ALWAYS create exactly one audio + one video sender, even with no mic/camera,
    // so (a) the m-lines stay symmetric across peers and (b) a no-device user can
    // still RECEIVE everyone and later push a screen share via replaceTrack — all
    // without renegotiation. Senders start with a null track when we have nothing
    // to send yet.
    const send = sendStreamRef.current;
    const outAudio = send?.getAudioTracks()[0];
    try {
      entry.audioSender = outAudio && send
        ? pc.addTrack(outAudio, send)
        : pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    } catch (e) { console.error('add audio sender', e); }
    const outVideo = send?.getVideoTracks()[0];
    try {
      entry.videoSender = outVideo && send
        ? pc.addTrack(outVideo, send)
        : pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    } catch (e) { console.error('add video sender', e); }

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'candidate', payload: e.candidate.toJSON(), toUid: uid });
    };
    pc.ontrack = (e) => {
      entry.stream.addTrack(e.track);
      // The always-present video transceiver (above) means a video receiver
      // track exists even in an audio call — it just stays `muted` until the
      // peer actually sends camera/screen frames. Re-render on mute/unmute so a
      // tile flips between avatar and video exactly when media starts/stops
      // (the UI gates on `!track.muted`, see CallManager). Without this, a
      // screen share started mid-call wouldn't appear until the next re-render.
      e.track.onunmute = () => syncPeers();
      e.track.onmute = () => syncPeers();
      e.track.onended = () => { try { entry.stream.removeTrack(e.track); } catch { /* noop */ } syncPeers(); };
      syncPeers();
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === 'connected' || st === 'completed') {
        entry.everConnected = true;
        if (entry.failTimer) { clearTimeout(entry.failTimer); entry.failTimer = null; }
        if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
      }
      if (st === 'failed' || st === 'disconnected') {
        if (user.uid < uid) restartIce(entry); // smaller uid drives the ICE restart
        // Backstop (both sides): if still down after a grace period, drop the dead
        // peer so the survivor isn't stuck forever (covers a peer that vanished
        // without sending 'leave', e.g. a mobile tab killed in the background).
        if (!entry.failTimer) {
          entry.failTimer = setTimeout(() => {
            const s = entry.pc.iceConnectionState;
            if (s === 'failed' || s === 'disconnected') removePeer(uid);
          }, 15000);
        }
      }
      if (st === 'closed') removePeer(uid);
      syncPeers();
    };

    // Drain any candidates that arrived before the peer existed.
    const pend = pendingCandidates.current.get(uid);
    if (pend) { entry.candidateQueue.push(...pend); pendingCandidates.current.delete(uid); }

    syncPeers();
    return entry;
  }, [sendSignal, syncPeers, user.uid, restartIce, removePeer]);

  // --- Signal handlers ---
  const handleSignal = useCallback(async (data: SignalData) => {
    if (data.fromUid === user.uid) return;
    if (data.toUid && data.toUid !== user.uid) return;

    switch (data.type) {
      case 'join': {
        if (statusRef.current === 'incall') {
          // A newcomer joined the call I'm in — make myself known and connect.
          sendSignal({ type: 'present', toUid: data.fromUid, callType: callTypeRef.current });
          const entry = createPeer(data.fromUid, data.fromName, data.fromAvatar);
          if (user.uid < data.fromUid) makeOffer(entry);
        } else {
          // idle OR already ringing: enqueue this caller (deduped by uid).
          const inc: IncomingCall = { fromUid: data.fromUid, fromName: data.fromName, fromAvatar: data.fromAvatar, callType: data.callType || 'audio', direct: !!data.toUid };
          const q = incomingQueueRef.current;
          if (!q.some((c) => c.fromUid === inc.fromUid)) q.push(inc);
          if (statusRef.current === 'idle') {
            setIncoming(inc);
            setStatus('ringing');
            initAudio();
            startRingtone();
          }
          // already 'ringing' → current ring continues; new caller waits in the queue.
        }
        break;
      }
      case 'present': {
        if (statusRef.current === 'incall') {
          const entry = createPeer(data.fromUid, data.fromName, data.fromAvatar);
          if (user.uid < data.fromUid) makeOffer(entry);
        }
        break;
      }
      case 'offer': {
        if (statusRef.current !== 'incall') return;
        const entry = peersRef.current.get(data.fromUid) || createPeer(data.fromUid, data.fromName, data.fromAvatar);
        // Perfect-negotiation glare handling for MID-CALL renegotiation (a screen
        // share from a peer that had no video track renegotiates — see
        // startScreenShare). If both sides offer at once, the "polite" peer (larger
        // uid) rolls back to accept the incoming offer; the impolite peer ignores
        // it and keeps its own. Initial negotiation is always stable → no collision.
        const collision = entry.makingOffer || entry.pc.signalingState !== 'stable';
        const polite = user.uid > data.fromUid;
        if (collision && !polite) return;
        try {
          if (collision) {
            try { await entry.pc.setLocalDescription({ type: 'rollback' }); } catch { /* noop */ }
          }
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data.payload as RTCSessionDescriptionInit));
          await drainCandidates(entry);
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          sendSignal({ type: 'answer', payload: answer, toUid: data.fromUid });
        } catch (e) {
          console.error('handle offer failed', e);
        }
        break;
      }
      case 'answer': {
        const entry = peersRef.current.get(data.fromUid);
        if (!entry) return;
        try {
          await entry.pc.setRemoteDescription(new RTCSessionDescription(data.payload as RTCSessionDescriptionInit));
          await drainCandidates(entry);
        } catch (e) {
          console.error('handle answer failed', e);
        }
        break;
      }
      case 'candidate': {
        const entry = peersRef.current.get(data.fromUid);
        const cand = data.payload as RTCIceCandidateInit;
        if (!entry) {
          const list = pendingCandidates.current.get(data.fromUid) || [];
          list.push(cand);
          pendingCandidates.current.set(data.fromUid, list);
        } else if (entry.pc.remoteDescription) {
          entry.pc.addIceCandidate(new RTCIceCandidate(cand)).catch((e) => console.error('addIceCandidate', e));
        } else {
          entry.candidateQueue.push(cand);
        }
        break;
      }
      case 'leave': {
        removePeer(data.fromUid);
        incomingQueueRef.current = incomingQueueRef.current.filter((c) => c.fromUid !== data.fromUid);
        if (statusRef.current === 'ringing' && incomingRef.current?.fromUid === data.fromUid) {
          const next = incomingQueueRef.current[0];
          if (next) { setIncoming(next); } // promote the next caller; ring keeps going
          else { setIncoming(null); setStatus('idle'); stopRingtone(); }
        }
        break;
      }
      case 'screenshare': {
        setSharingUids((prev) => {
          const next = new Set(prev);
          if (data.sharing) next.add(data.fromUid); else next.delete(data.fromUid);
          return next;
        });
        break;
      }
      case 'decline': {
        // The one person I rang 1-on-1 rejected and nobody connected yet → stop
        // waiting. Group rings (directTargetRef null) ignore it; others may join.
        if (statusRef.current === 'incall' && directTargetRef.current === data.fromUid && peersRef.current.size === 0) {
          setNotice({ kind: 'info', text: `${data.fromName} declined the call.` });
          cleanupRef.current();
        }
        break;
      }
    }
  }, [user.uid, sendSignal, createPeer, makeOffer, drainCandidates, removePeer]);

  // Ref indirection so the (memoized-once) signal handler can end a call without
  // taking `cleanup` as a dependency (cleanup is declared below → would TDZ).
  const cleanupRef = useRef<() => void>(() => {});

  const handleSignalRef = useRef(handleSignal);
  useEffect(() => { handleSignalRef.current = handleSignal; }, [handleSignal]);

  // Subscribe to the room's call channel once.
  useEffect(() => {
    if (!config.roomKey) return;
    const channel = supabase.channel(`calls:${config.roomKey}`);
    channel.on('broadcast', { event: 'signal' }, ({ payload }: { payload: SignalData }) => {
      handleSignalRef.current(payload);
    });
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [config.roomKey]);

  // --- Media ---
  // Progressive, never-throwing acquisition: get the best of {mic+cam, mic, cam},
  // and if the device truly has neither (or permission is blocked) join with an
  // EMPTY stream so the user can still listen and share their screen. createPeer
  // always builds both senders, so a track-less participant still receives others.
  const getMedia = useCallback(async (video: boolean) => {
    const audio = { echoCancellation: true, noiseSuppression: true };
    let lastErr: unknown = null;
    const tryGUM = async (c: MediaStreamConstraints): Promise<MediaStream | null> => {
      try { return await navigator.mediaDevices.getUserMedia(c); }
      catch (e) { lastErr = e; return null; }
    };

    let stream: MediaStream | null = null;
    if (video) {
      stream = await tryGUM({ audio, video: { facingMode } });
      if (!stream) { stream = await tryGUM({ audio, video: false }); if (stream) setNotice({ kind: 'info', text: 'No camera available — you joined with audio only.' }); }
      if (!stream) { stream = await tryGUM({ audio: false, video: { facingMode } }); if (stream) setNotice({ kind: 'info', text: 'No microphone — you joined with video only.' }); }
    } else {
      stream = await tryGUM({ audio, video: false });
    }
    if (!stream) {
      stream = new MediaStream(); // listen-only + screen-share capable
      const name = (lastErr as { name?: string })?.name || '';
      setNotice(name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError'
        ? { kind: 'info', text: 'Mic/camera access is blocked — you joined to listen and can share your screen.' }
        : { kind: 'info', text: 'No mic or camera found — you joined to listen and can share your screen.' });
    }

    rawStreamRef.current = stream;
    sendStreamRef.current = new MediaStream(stream.getTracks());
    outgoingAudioTrackRef.current = stream.getAudioTracks()[0] || null;
    setLocalStream(stream);
    return stream;
  }, [facingMode]);

  const cleanup = useCallback(() => {
    statusRef.current = 'idle'; // synchronously, so a close()-triggered removePeer can't re-enter cleanup
    peersRef.current.forEach((e) => { if (e.failTimer) clearTimeout(e.failTimer); try { e.pc.close(); } catch { /* noop */ } });
    peersRef.current.clear();
    pendingCandidates.current.clear();
    rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    cameraVideoTrackRef.current = null;
    micGainRef.current = null;
    outgoingAudioTrackRef.current = null;
    isScreenSharingRef.current = false;
    directTargetRef.current = null;
    sendStreamRef.current = null;
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (durationIntervalRef.current) { clearInterval(durationIntervalRef.current); durationIntervalRef.current = null; }
    if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null; }
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
    incomingQueueRef.current = [];
    stopRingtone();
    setPeers([]);
    setLocalStream(null);
    setStatus('idle');
    setIncoming(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsSpeakerMuted(false);
    setVoiceFilter('normal');
    setCallDuration(0);
    setNetworkQuality('good');
    setIsScreenSharing(false);
    setSharingUids(new Set());
  }, []);
  useEffect(() => { cleanupRef.current = cleanup; }, [cleanup]);

  // --- Public actions ---
  // `targetUid` set ⇒ ring only that person (1-on-1); omitted ⇒ ring the whole room (group).
  const enterCall = useCallback(async (type: CallType, targetUid?: string) => {
    try {
      directTargetRef.current = targetUid ?? null;
      setNotice(null);
      stopRingtone();            // stop the ring BEFORE the (slow) permission prompt
      setIncoming(null);
      incomingQueueRef.current = [];
      await getMedia(type === 'video');
      setCallType(type);
      callTypeRef.current = type;
      setStatus('incall');
      statusRef.current = 'incall';
      // Announce; existing members reply with `present` and the smaller uid offers.
      sendSignal({ type: 'join', callType: type, toUid: targetUid });
      // 1-on-1: if the person we rang never connects, stop waiting ("No answer").
      if (targetUid) {
        if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = setTimeout(() => {
          const anyConnected = Array.from(peersRef.current.values()).some((e) => e.everConnected);
          if (statusRef.current === 'incall' && !anyConnected) {
            setNotice({ kind: 'info', text: 'No answer.' });
            cleanupRef.current();
          }
        }, 40000);
      }
    } catch (e) {
      console.error('Could not start/join call', e);
      setNotice({ kind: 'error', text: mediaErrorMessage(e) });
      cleanup();
    }
  }, [getMedia, sendSignal, cleanup]);

  const startCall = useCallback((type: CallType, targetUid?: string) => enterCall(type, targetUid), [enterCall]);

  const acceptCall = useCallback(() => {
    const inc = incomingRef.current;
    const type = inc?.callType || 'audio';
    // Answer a direct call only to the caller (keeps it 1-on-1); a group call is
    // announced to the whole room so the mesh forms with everyone present.
    return enterCall(type, inc?.direct ? inc.fromUid : undefined);
  }, [enterCall]);

  const declineCall = useCallback(() => {
    const inc = incomingRef.current;
    if (inc) sendSignal({ type: 'decline', toUid: inc.fromUid }); // let the caller stop waiting
    incomingQueueRef.current = incomingQueueRef.current.filter((c) => c.fromUid !== inc?.fromUid);
    const next = incomingQueueRef.current[0];
    if (next) { setIncoming(next); } // there was another caller waiting
    else { setIncoming(null); setStatus('idle'); stopRingtone(); }
  }, [sendSignal]);

  const hangup = useCallback(() => {
    sendSignal({ type: 'leave' });
    cleanup();
  }, [sendSignal, cleanup]);

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

  const toggleVideo = useCallback(() => {
    const s = rawStreamRef.current;
    if (!s) return;
    let off = false;
    s.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; off = !t.enabled; });
    setIsVideoOff(off);
  }, []);

  const cycleVoiceFilter = useCallback(() => {
    const order: VoiceFilterType[] = ['normal', 'deep', 'robot', 'monster', 'alien'];
    const next = order[(order.indexOf(voiceFilter) + 1) % order.length];
    setVoiceFilter(next);
    voiceFilterRef.current = next;
    applyOutgoingAudio();
  }, [voiceFilter, applyOutgoingAudio]);

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

    // Going back to a track-less video m-line (audio call / no-camera): renegotiate
    // so receivers cleanly drop the screen (mirror of the start path).
    if (!restore) peersRef.current.forEach((e) => makeOffer(e));

    isScreenSharingRef.current = false;
    setIsScreenSharing(false);
    sendSignal({ type: 'screenshare', sharing: false });
  }, [setOutgoingVideo, setLocalView, applyOutgoingAudio, sendSignal, makeOffer]);

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
    // The picker is async: the call may have ended (hangup / remote left /
    // unmount → cleanup) while it was open. If so, stop the just-captured stream
    // and bail — otherwise we'd leak the OS screen-capture (indicator stuck on)
    // and resurrect sharing state for a call we already left.
    if (statusRef.current !== 'incall' || !sendStreamRef.current) {
      display.getTracks().forEach((t) => t.stop());
      return;
    }
    screenStreamRef.current = display;
    const screenVideo = display.getVideoTracks()[0];

    cameraVideoTrackRef.current =
      callTypeRef.current === 'video' ? (rawStreamRef.current?.getVideoTracks()[0] || null) : null;

    const hadVideo = !!cameraVideoTrackRef.current; // a live camera track we just swapped away from
    setOutgoingVideo(screenVideo);
    // Deliberately DO NOT show the capture in our own tile: when sharing the whole
    // screen, rendering it locally puts a live copy on the very screen being
    // captured → infinite "hall of mirrors" (and that recursion is what remote
    // viewers see too). The sharer already sees their real screen; locally we keep
    // showing the camera (video call) or avatar (audio call).
    applyOutgoingAudio(); // fold screen audio (if any) into the mix

    // If our video m-line had NO prior track (audio call / no-camera device), it
    // goes track-less → active. Safari/iOS won't render a track that appears via
    // replaceTrack alone, so renegotiate to make receivers (esp. iPhone) pick it
    // up. Camera→screen (hadVideo) keeps a live track → replaceTrack is enough.
    if (!hadVideo) peersRef.current.forEach((e) => makeOffer(e));

    screenVideo.onended = () => { stopScreenShare(); }; // browser's native "Stop sharing"

    isScreenSharingRef.current = true;
    setIsScreenSharing(true);
    sendSignal({ type: 'screenshare', sharing: true });
  }, [setOutgoingVideo, setLocalView, applyOutgoingAudio, sendSignal, stopScreenShare, makeOffer]);

  // --- Duration + connection stats while in a call ---
  useEffect(() => {
    if (status === 'incall') {
      if (!durationIntervalRef.current) {
        setCallDuration(0);
        durationIntervalRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
      }
      if (!statsIntervalRef.current) {
        statsIntervalRef.current = setInterval(async () => {
          const entry = peersRef.current.values().next().value as PeerEntry | undefined;
          if (!entry) return;
          try {
            const stats = await entry.pc.getStats(null);
            let rtt = 0; let loss = 0;
            stats.forEach((r) => {
              if (r.type === 'candidate-pair' && r.state === 'succeeded') rtt = r.currentRoundTripTime || 0;
              if (r.type === 'inbound-rtp' && r.kind === 'video') loss = r.packetsLost / (r.packetsReceived + r.packetsLost) || 0;
            });
            if (rtt > 0.3 || loss > 0.05) setNetworkQuality('bad');
            else if (rtt > 0.15 || loss > 0.02) setNetworkQuality('poor');
            else setNetworkQuality('good');
          } catch { /* ignore */ }
        }, 2000);
      }
    } else {
      if (durationIntervalRef.current) { clearInterval(durationIntervalRef.current); durationIntervalRef.current = null; }
      if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null; }
    }
  }, [status]);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (statusRef.current === 'incall') { try { sendSignal({ type: 'leave' }); } catch { /* noop */ } }
    cleanup();
  }, [cleanup, sendSignal]);

  // iOS: a fresh AudioContext starts `suspended` and only advances on a user
  // gesture. While in a call, resume ours on any pointer/touch/key interaction so
  // voice-filter / screen-audio output isn't silent to peers.
  useEffect(() => {
    if (status !== 'incall') return;
    const resume = () => { const c = audioCtxRef.current; if (c && c.state === 'suspended') c.resume().catch(() => {}); };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('touchstart', resume, { passive: true });
    window.addEventListener('keydown', resume);
    return () => {
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('touchstart', resume);
      window.removeEventListener('keydown', resume);
    };
  }, [status]);

  return {
    status,
    callType,
    incoming,
    peers,
    localStream,
    isMuted,
    isVideoOff,
    isSpeakerMuted,
    setIsSpeakerMuted,
    voiceFilter,
    networkQuality,
    callDuration,
    notice,
    dismissNotice,
    startCall,
    acceptCall,
    declineCall,
    hangup,
    toggleMute,
    toggleVideo,
    switchCamera,
    cycleVoiceFilter,
    isScreenSharing,
    startScreenShare,
    stopScreenShare,
    sharingUids,
  };
}
