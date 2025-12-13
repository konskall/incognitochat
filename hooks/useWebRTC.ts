
import { useState, useRef, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, SignalData } from '../types';
import { initAudio, startRingtone, stopRingtone } from '../utils/helpers';
import { useVoiceFilter, VoiceFilterType } from './useVoiceFilter';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:standard.relay.metered.ca:80",
      username: "4aa8db5b8a8c31527e2495be",
      credential: "8O6d1Nc3j8iAsTiq",
    },
    {
      urls: "turn:standard.relay.metered.ca:443",
      username: "4aa8db5b8a8c31527e2495be",
      credential: "8O6d1Nc3j8iAsTiq",
    },
    {
      urls: "turns:standard.relay.metered.ca:443?transport=tcp",
      username: "4aa8db5b8a8c31527e2495be",
      credential: "8O6d1Nc3j8iAsTiq",
    },
  ],
};

export type CallStatus = 'idle' | 'calling' | 'incoming' | 'connected' | 'reconnecting';

export const useWebRTC = (user: User, config: ChatConfig) => {
  // State
  const [status, setStatus] = useState<CallStatus>('idle');
  const [incomingCall, setIncomingCall] = useState<SignalData | null>(null);
  const [remoteDetails, setRemoteDetails] = useState({ name: '', avatar: '', uid: '' });
  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<'good' | 'poor' | 'bad'>('good');
  
  // Refs
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const candidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const channelRef = useRef<any>(null);
  
  // Audio Filter Hook
  const { voiceFilter, processStream, cleanupAudio } = useVoiceFilter();

  // --- Signaling ---
  useEffect(() => {
    if (!config.roomKey) return;
    
    const channel = supabase.channel(`calls:${config.roomKey}`);
    channelRef.current = channel;

    channel.on('broadcast', { event: 'signal' }, ({ payload }: { payload: SignalData }) => {
        if (payload.fromUid === user.uid) return;
        if (payload.toUid && payload.toUid !== user.uid) return;
        handleSignal(payload);
    });

    channel.subscribe();

    return () => {
        supabase.removeChannel(channel);
        endCall(true); // Cleanup on unmount
    };
  }, [config.roomKey, user.uid]);

  const sendSignal = async (data: SignalData) => {
    if (channelRef.current) {
        await channelRef.current.send({
            type: 'broadcast',
            event: 'signal',
            payload: data
        });
    }
  };

  // --- Logic ---
  const getMedia = async (video: boolean) => {
      const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: video ? { facingMode: 'user' } : false
      });
      localStreamRef.current = stream;
      return stream;
  };

  const createPeerConnection = (remoteUid: string) => {
      const newPC = new RTCPeerConnection(ICE_SERVERS);
      
      newPC.onicecandidate = (event) => {
          if (event.candidate) {
              sendSignal({
                  type: 'candidate',
                  payload: event.candidate.toJSON(),
                  fromUid: user.uid,
                  fromName: config.username,
                  fromAvatar: config.avatarURL,
                  toUid: remoteUid
              });
          }
      };

      newPC.ontrack = (event) => {
          if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
          remoteStreamRef.current.addTrack(event.track);
          // Trigger re-render to update video element
          setStatus(prev => prev === 'connected' ? 'connected' : prev); 
      };

      newPC.oniceconnectionstatechange = () => {
          if (newPC.iceConnectionState === 'disconnected') setStatus('reconnecting');
          if (newPC.iceConnectionState === 'connected') setStatus('connected');
          if (newPC.iceConnectionState === 'failed') endCall();
      };

      // Quality Monitoring
      setInterval(async () => {
          if (!newPC) return;
          const stats = await newPC.getStats();
          let packetLoss = 0;
          stats.forEach(report => {
              if (report.type === 'inbound-rtp' && report.kind === 'video') {
                  packetLoss = report.packetsLost / (report.packetsReceived + report.packetsLost) || 0;
              }
          });
          setNetworkQuality(packetLoss > 0.05 ? 'bad' : packetLoss > 0.02 ? 'poor' : 'good');
      }, 5000);

      pc.current = newPC;
      return newPC;
  };

  const startCall = async (targetUid: string, name: string, avatar: string, type: 'audio' | 'video') => {
      setStatus('calling');
      setCallType(type);
      setRemoteDetails({ name, avatar, uid: targetUid });
      candidateQueue.current = [];

      try {
          const stream = await getMedia(type === 'video');
          const connection = createPeerConnection(targetUid);
          stream.getTracks().forEach(t => connection.addTrack(t, stream));

          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);

          await sendSignal({
              type: 'offer',
              payload: offer,
              fromUid: user.uid,
              fromName: config.username,
              fromAvatar: config.avatarURL,
              toUid: targetUid,
              callType: type
          });
      } catch (e) {
          console.error("Start call failed", e);
          endCall();
      }
  };

  const answerCall = async () => {
      if (!incomingCall) return;
      stopRingtone();
      setStatus('connected');
      setCallType(incomingCall.callType || 'video');
      setRemoteDetails({ 
          name: incomingCall.fromName, 
          avatar: incomingCall.fromAvatar, 
          uid: incomingCall.fromUid 
      });

      try {
          const stream = await getMedia(incomingCall.callType === 'video');
          const connection = createPeerConnection(incomingCall.fromUid);
          stream.getTracks().forEach(t => connection.addTrack(t, stream));

          await connection.setRemoteDescription(new RTCSessionDescription(incomingCall.payload));
          
          // Process queued candidates
          while (candidateQueue.current.length) {
              const c = candidateQueue.current.shift();
              if (c) await connection.addIceCandidate(new RTCIceCandidate(c));
          }

          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);

          await sendSignal({
              type: 'answer',
              payload: answer,
              fromUid: user.uid,
              fromName: config.username,
              fromAvatar: config.avatarURL,
              toUid: incomingCall.fromUid
          });
          setIncomingCall(null);
      } catch (e) {
          console.error("Answer failed", e);
          endCall();
      }
  };

  const handleSignal = async (data: SignalData) => {
      if (data.type === 'offer') {
          // If busy
          if (status !== 'idle' && status !== 'incoming') return;
          
          setIncomingCall(data);
          setStatus('incoming');
          candidateQueue.current = [];
          initAudio();
          startRingtone();
      } 
      else if (data.type === 'answer' && pc.current) {
          await pc.current.setRemoteDescription(new RTCSessionDescription(data.payload));
          setStatus('connected');
      } 
      else if (data.type === 'candidate') {
          if (pc.current && pc.current.remoteDescription) {
              await pc.current.addIceCandidate(new RTCIceCandidate(data.payload));
          } else {
              candidateQueue.current.push(data.payload);
          }
      } 
      else if (data.type === 'bye' || data.type === 'reject') {
          if (status === 'incoming' && incomingCall?.fromUid === data.fromUid) {
              // Cancelled before answer
              setIncomingCall(null);
              setStatus('idle');
              stopRingtone();
          } else if (remoteDetails.uid === data.fromUid) {
              endCall();
          }
      }
  };

  const endCall = (silent = false) => {
      if (!silent && status !== 'idle' && status !== 'incoming') {
          sendSignal({ 
              type: 'bye', payload: null, 
              fromUid: user.uid, fromName: '', fromAvatar: '', 
              toUid: remoteDetails.uid 
          });
      }
      
      stopRingtone();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
      if (pc.current) pc.current.close();
      
      cleanupAudio();
      
      pc.current = null;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      
      setStatus('idle');
      setIncomingCall(null);
      setIsMuted(false);
      setIsVideoOff(false);
  };

  const switchCamera = async () => {
      if (!localStreamRef.current) return;
      // Simple toggle logic assuming mobile behavior primarily
      // Advanced implementation would enumerate devices
      const currentTrack = localStreamRef.current.getVideoTracks()[0];
      if (!currentTrack) return;
      
      const currentSettings = currentTrack.getSettings();
      const newMode = currentSettings.facingMode === 'user' ? 'environment' : 'user';
      
      currentTrack.stop();
      
      const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: newMode },
          audio: true
      });
      
      const newVideoTrack = newStream.getVideoTracks()[0];
      
      if (pc.current) {
          const sender = pc.current.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(newVideoTrack);
      }
      
      // Keep audio track, replace video
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      localStreamRef.current = new MediaStream([audioTrack, newVideoTrack]);
  };

  const applyFilter = (type: VoiceFilterType) => {
      if (!localStreamRef.current) return;
      const newStream = processStream(localStreamRef.current, type);
      const newAudio = newStream.getAudioTracks()[0];
      
      if (pc.current && newAudio) {
          const sender = pc.current.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) sender.replaceTrack(newAudio);
      }
  };

  const toggleMute = () => {
      if (localStreamRef.current) {
          const audio = localStreamRef.current.getAudioTracks()[0];
          if (audio) audio.enabled = !audio.enabled;
          setIsMuted(!isMuted);
      }
  };

  const toggleVideo = () => {
      if (localStreamRef.current) {
          const video = localStreamRef.current.getVideoTracks()[0];
          if (video) video.enabled = !video.enabled;
          setIsVideoOff(!isVideoOff);
      }
  };

  return {
      status,
      callType,
      incomingCall,
      remoteDetails,
      localStream: localStreamRef.current,
      remoteStream: remoteStreamRef.current,
      isMuted,
      isVideoOff,
      networkQuality,
      voiceFilter,
      startCall,
      answerCall,
      endCall,
      handleReject: () => { 
          if(incomingCall) sendSignal({type: 'reject', payload: null, fromUid: user.uid, fromName:'', fromAvatar:'', toUid: incomingCall.fromUid});
          setIncomingCall(null); 
          stopRingtone(); 
          setStatus('idle');
      },
      toggleMute,
      toggleVideo,
      switchCamera,
      setVoiceFilter: applyFilter
  };
};
