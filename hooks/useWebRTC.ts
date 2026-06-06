import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, SignalData } from '../types';
import { initAudio, startRingtone, stopRingtone } from '../utils/helpers';

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

export type VoiceFilterType = 'normal' | 'deep' | 'robot';
export type CallStatus = 'idle' | 'ringing' | 'incall';
export type CallType = 'audio' | 'video';

export interface RemotePeer {
  uid: string;
  name: string;
  avatar: string;
  stream: MediaStream;
  state: RTCIceConnectionState;
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

export function useWebRTC(user: User, config: ChatConfig) {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [callType, setCallType] = useState<CallType>('video');
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [voiceFilter, setVoiceFilter] = useState<VoiceFilterType>('normal');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
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

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const pendingCandidates = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const rawStreamRef = useRef<MediaStream | null>(null); // unfiltered getUserMedia (local display + base)
  const sendStreamRef = useRef<MediaStream | null>(null); // what we attach to peers (raw or voice-filtered)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Web Audio voice filter graph
  const audioCtxRef = useRef<AudioContext | null>(null);
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

  // --- Voice filters (Web Audio) ---
  const buildFilteredAudio = useCallback((raw: MediaStream, type: VoiceFilterType): MediaStream => {
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (type === 'normal') return raw;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(raw);
      const dest = ctx.createMediaStreamDestination();
      if (type === 'deep') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        const gain = ctx.createGain();
        gain.gain.value = 1.5;
        source.connect(filter); filter.connect(gain); gain.connect(dest);
      } else {
        // robot: ring modulation + a little dry signal for intelligibility
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 50;
        osc.start();
        const ring = ctx.createGain();
        ring.gain.value = 1.0;
        source.connect(ring); osc.connect(ring.gain); ring.connect(dest);
        const dry = ctx.createGain();
        dry.gain.value = 0.4;
        source.connect(dry); dry.connect(dest);
      }
      const out = dest.stream;
      const videoTrack = raw.getVideoTracks()[0];
      if (videoTrack) out.addTrack(videoTrack);
      return out;
    } catch {
      return raw;
    }
  }, []);

  // --- Peer lifecycle ---
  const drainCandidates = useCallback(async (entry: PeerEntry) => {
    while (entry.candidateQueue.length) {
      const c = entry.candidateQueue.shift();
      if (c) { try { await entry.pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.error('addIceCandidate', e); } }
    }
  }, []);

  const removePeer = useCallback((uid: string) => {
    const entry = peersRef.current.get(uid);
    if (entry) {
      try { entry.pc.close(); } catch { /* noop */ }
      peersRef.current.delete(uid);
      syncPeers();
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
    const entry: PeerEntry = { uid, name, avatar, pc, stream, candidateQueue: [], makingOffer: false };
    peersRef.current.set(uid, entry);

    // Attach our outgoing tracks.
    sendStreamRef.current?.getTracks().forEach((t) => {
      try { pc.addTrack(t, sendStreamRef.current!); } catch (e) { console.error('addTrack', e); }
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal({ type: 'candidate', payload: e.candidate.toJSON(), toUid: uid });
    };
    pc.ontrack = (e) => {
      entry.stream.addTrack(e.track);
      syncPeers();
    };
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      if (st === 'failed' || st === 'disconnected') {
        if (user.uid < uid) restartIce(entry); // offerer drives the restart
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
        } else if (statusRef.current === 'idle') {
          // Someone started/extended a call — ring me so I can join. A `toUid` on
          // the join means it was aimed only at me (1-on-1); otherwise it's a group ring.
          setIncoming({ fromUid: data.fromUid, fromName: data.fromName, fromAvatar: data.fromAvatar, callType: data.callType || 'audio', direct: !!data.toUid });
          setStatus('ringing');
          initAudio();
          startRingtone();
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
        try {
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
        if (statusRef.current === 'ringing' && incomingRef.current?.fromUid === data.fromUid) {
          setIncoming(null);
          setStatus('idle');
          stopRingtone();
        }
        break;
      }
    }
  }, [user.uid, sendSignal, createPeer, makeOffer, drainCandidates, removePeer]);

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
  const getMedia = useCallback(async (video: boolean) => {
    const audio = { echoCancellation: true, noiseSuppression: true };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio, video: video ? { facingMode } : false });
    } catch (err) {
      // A video call on a device without a (working) camera shouldn't fail
      // outright — fall back to audio-only so the user can still join.
      if (video) {
        stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
        setNotice({ kind: 'info', text: 'No camera available — you joined with audio only.' });
      } else {
        throw err;
      }
    }
    rawStreamRef.current = stream;
    sendStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, [facingMode]);

  const cleanup = useCallback(() => {
    peersRef.current.forEach((e) => { try { e.pc.close(); } catch { /* noop */ } });
    peersRef.current.clear();
    pendingCandidates.current.clear();
    rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawStreamRef.current = null;
    sendStreamRef.current = null;
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    if (durationIntervalRef.current) { clearInterval(durationIntervalRef.current); durationIntervalRef.current = null; }
    if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null; }
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
  }, []);

  // --- Public actions ---
  // `targetUid` set ⇒ ring only that person (1-on-1); omitted ⇒ ring the whole room (group).
  const enterCall = useCallback(async (type: CallType, targetUid?: string) => {
    try {
      await getMedia(type === 'video');
      setCallType(type);
      callTypeRef.current = type;
      setStatus('incall');
      statusRef.current = 'incall';
      setIncoming(null);
      stopRingtone();
      setNotice(null);
      // Announce; existing members reply with `present` and the smaller uid offers.
      sendSignal({ type: 'join', callType: type, toUid: targetUid });
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
    setIncoming(null);
    setStatus('idle');
    stopRingtone();
  }, []);

  const hangup = useCallback(() => {
    sendSignal({ type: 'leave' });
    cleanup();
  }, [sendSignal, cleanup]);

  const toggleMute = useCallback(() => {
    const s = rawStreamRef.current;
    if (!s) return;
    let muted = false;
    s.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; muted = !t.enabled; });
    sendStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    setIsMuted(muted);
  }, []);

  const toggleVideo = useCallback(() => {
    const s = rawStreamRef.current;
    if (!s) return;
    let off = false;
    s.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; off = !t.enabled; });
    setIsVideoOff(off);
  }, []);

  const cycleVoiceFilter = useCallback(async () => {
    if (!rawStreamRef.current) return;
    const next: VoiceFilterType = voiceFilter === 'normal' ? 'deep' : voiceFilter === 'deep' ? 'robot' : 'normal';
    const filtered = buildFilteredAudio(rawStreamRef.current, next);
    sendStreamRef.current = filtered;
    const audioTrack = filtered.getAudioTracks()[0];
    if (audioTrack) {
      // keep mute state across the swap
      audioTrack.enabled = !isMuted;
      peersRef.current.forEach((e) => {
        const sender = e.pc.getSenders().find((s) => s.track?.kind === 'audio');
        sender?.replaceTrack(audioTrack).catch((err) => console.error('replaceTrack', err));
      });
    }
    setVoiceFilter(next);
  }, [voiceFilter, buildFilteredAudio, isMuted]);

  const switchCamera = useCallback(async () => {
    if (!rawStreamRef.current || callTypeRef.current !== 'video') return;
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    try {
      rawStreamRef.current.getVideoTracks().forEach((t) => t.stop());
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: newMode } });
      const newVideo = fresh.getVideoTracks()[0];
      peersRef.current.forEach((e) => {
        const sender = e.pc.getSenders().find((s) => s.track?.kind === 'video');
        sender?.replaceTrack(newVideo).catch((err) => console.error('replaceTrack', err));
      });
      // rebuild local display stream (existing audio + new video)
      const audio = rawStreamRef.current.getAudioTracks()[0];
      const combined = new MediaStream(audio ? [audio, newVideo] : [newVideo]);
      rawStreamRef.current = combined;
      if (voiceFilter === 'normal') sendStreamRef.current = combined;
      else if (sendStreamRef.current) { sendStreamRef.current.getVideoTracks().forEach((t) => sendStreamRef.current!.removeTrack(t)); sendStreamRef.current.addTrack(newVideo); }
      setLocalStream(combined);
      setFacingMode(newMode);
    } catch (e) {
      console.error('switchCamera failed', e);
    }
  }, [facingMode, voiceFilter]);

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
  useEffect(() => () => { cleanup(); }, [cleanup]);

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
  };
}
