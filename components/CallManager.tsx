import React, { useEffect, useRef, useState } from 'react';
import { Phone, Video, Mic, MicOff, PhoneOff, X, User as UserIcon, Crown, AlertCircle, VideoOff, RotateCcw, Signal, Clock, Volume2, VolumeX } from 'lucide-react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Presence, SignalData } from '../types';
import { initAudio, startRingtone, stopRingtone } from '../utils/helpers';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:standard.relay.metered.ca:80",
      username: "4aa8db5b8a8c31527e2495be",
      credential: "8O6d1Nc3j8iAsTiq",
    },
    {
      urls: "turn:standard.relay.metered.ca:80?transport=tcp",
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
  iceCandidatePoolSize: 10,
};

interface CallManagerProps {
  user: User;
  config: ChatConfig;
  users: Presence[]; 
  onCloseParticipants: () => void;
  showParticipants: boolean;
  roomCreatorId?: string | null;
}

interface CallState {
  status: 'idle' | 'calling' | 'incoming' | 'connected' | 'reconnecting';
  callId: string | null;
  isCaller: boolean;
  remoteName: string;
  remoteAvatar: string;
  type: 'audio' | 'video';
}

const CallManager: React.FC<CallManagerProps> = ({ user, config, users, onCloseParticipants, showParticipants, roomCreatorId }) => {
  const [viewState, setViewState] = useState<CallState>({
    status: 'idle',
    callId: null,
    isCaller: false,
    remoteName: '',
    remoteAvatar: '',
    type: 'video'
  });
  
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState<boolean>(false); // New state for speaker mute
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [incomingCall, setIncomingCall] = useState<SignalData | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  // Stats & Timer
  const [networkQuality, setNetworkQuality] = useState<'good' | 'poor' | 'bad'>('good');
  const [callDuration, setCallDuration] = useState(0);

  // Refs
  const viewStateRef = useRef(viewState);
  const incomingCallRef = useRef(incomingCall);
  const isCallerRef = useRef(false);
  const remoteUidRef = useRef<string | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const channelRef = useRef<any>(null);
  const candidateQueue = useRef<RTCIceCandidateInit[]>([]);
  
  // DOM Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  // Timer Refs
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- SYNC STATE TO REFS ---
  useEffect(() => {
    viewStateRef.current = viewState;
    isCallerRef.current = viewState.isCaller;
  }, [viewState]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  // --- STREAM MANAGEMENT ---
  useEffect(() => {
    if (viewState.status === 'connected' || viewState.status === 'reconnecting') {
        
        if (remoteVideoRef.current && remoteStream.current) {
            remoteVideoRef.current.srcObject = remoteStream.current;
            remoteVideoRef.current.muted = isSpeakerMuted; // Apply mute state
            remoteVideoRef.current.play().catch(e => console.warn("Remote autoplay failed", e));
        }

        if (localVideoRef.current && localStream.current) {
             localVideoRef.current.srcObject = localStream.current;
             localVideoRef.current.muted = true;
             localVideoRef.current.play().catch(e => console.warn("Local autoplay failed", e));
        }
    }
  }, [viewState.status, viewState.type]);

  // Handle speaker mute toggle syncing with video element
  useEffect(() => {
    if (remoteVideoRef.current) {
        remoteVideoRef.current.muted = isSpeakerMuted;
    }
  }, [isSpeakerMuted]);

  // --- CALL DURATION TIMER ---
  useEffect(() => {
    if (viewState.status === 'connected') {
      if (!durationIntervalRef.current) {
        setCallDuration(0);
        durationIntervalRef.current = setInterval(() => {
          setCallDuration(prev => prev + 1);
        }, 1000);
      }
      
      // Start stats monitoring
      if (!statsIntervalRef.current) {
        statsIntervalRef.current = setInterval(checkConnectionStats, 2000);
      }
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    }
  }, [viewState.status]);

  // --- SIGNALING ---
  useEffect(() => {
     if (!config.roomKey) return;
     
     const channel = supabase.channel(`calls:${config.roomKey}`);
     
     channel.on('broadcast', { event: 'signal' }, ({ payload }: { payload: SignalData }) => {
         if (payload.fromUid === user.uid) return;
         if (payload.toUid && payload.toUid !== user.uid) return;

         handleSignalMessage(payload);
     });

     channel.subscribe();
     channelRef.current = channel;

     return () => {
         supabase.removeChannel(channel);
         cleanup();
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

  const handleSignalMessage = async (data: SignalData) => {
      const currentStatus = viewStateRef.current.status;
      const currentIncoming = incomingCallRef.current;

      console.log(`[WebRTC] Signal: ${data.type} | CurrentStatus: ${currentStatus}`);

      switch (data.type) {
          case 'offer':
              // If we are already connected, treat this as a renegotiation (ICE Restart)
              if (currentStatus === 'connected' || currentStatus === 'reconnecting') {
                 console.log("[WebRTC] Received renegotiation offer");
                 if (pc.current) {
                     await pc.current.setRemoteDescription(new RTCSessionDescription(data.payload));
                     const answer = await pc.current.createAnswer();
                     await pc.current.setLocalDescription(answer);
                     sendSignal({
                        type: 'answer',
                        payload: answer,
                        fromUid: user.uid,
                        fromName: config.username,
                        fromAvatar: config.avatarURL,
                        toUid: data.fromUid
                     });
                     setViewState(prev => ({ ...prev, status: 'connected' }));
                 }
                 return;
              }

              if (currentStatus !== 'idle' && currentStatus !== 'incoming') {
                  console.log("[WebRTC] Busy, ignoring offer");
                  return;
              }
              candidateQueue.current = [];
              setIncomingCall(data);
              remoteUidRef.current = data.fromUid;
              initAudio();
              startRingtone();
              break;

          case 'answer':
               if ((currentStatus === 'calling' || currentStatus === 'reconnecting') && pc.current) {
                   try {
                       const remoteDesc = new RTCSessionDescription(data.payload);
                       await pc.current.setRemoteDescription(remoteDesc);
                       setViewState(prev => ({ ...prev, status: 'connected' }));
                       await processCandidateQueue();
                   } catch (err) {
                       console.error("Error setting remote description:", err);
                   }
               }
               break;

          case 'candidate':
               const candidate = new RTCIceCandidate(data.payload);
               if (pc.current && pc.current.remoteDescription) {
                   pc.current.addIceCandidate(candidate).catch(e => console.error("AddCandidate Error", e));
               } else {
                   candidateQueue.current.push(data.payload);
               }
               break;

          case 'bye':
          case 'reject':
               if (currentIncoming && currentIncoming.fromUid === data.fromUid) {
                   setIncomingCall(null);
                   stopRingtone();
               } else if (currentStatus !== 'idle') {
                   cleanup();
               }
               break;
      }
  };

  const processCandidateQueue = async () => {
      if (!pc.current) return;
      while (candidateQueue.current.length > 0) {
          const candidateData = candidateQueue.current.shift();
          if (candidateData) {
              try {
                  await pc.current.addIceCandidate(new RTCIceCandidate(candidateData));
              } catch (e) {
                  console.error("Error processing buffered candidate", e);
              }
          }
      }
  };

  // --- WEBRTC CORE ---
  const createPC = (targetUid: string) => {
      const newPC = new RTCPeerConnection(ICE_SERVERS);
      
      newPC.onicecandidate = (event) => {
          if (event.candidate) {
              const destUid = isCallerRef.current ? targetUid : remoteUidRef.current;
              sendSignal({
                  type: 'candidate',
                  payload: event.candidate.toJSON(),
                  fromUid: user.uid,
                  fromName: config.username,
                  fromAvatar: config.avatarURL,
                  toUid: destUid || undefined, 
              });
          }
      };

      newPC.ontrack = (event) => {
          if (!remoteStream.current) {
              remoteStream.current = new MediaStream();
          }
          remoteStream.current.addTrack(event.track);
          
          if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream.current;
              remoteVideoRef.current.play().catch(e => console.warn("Remote play error", e));
          }
      };
      
      newPC.oniceconnectionstatechange = () => {
          console.log(`ICE State: ${newPC.iceConnectionState}`);
          if (newPC.iceConnectionState === 'disconnected' || newPC.iceConnectionState === 'failed') {
               setViewState(prev => ({...prev, status: 'reconnecting'}));
               // Trigger ICE restart for reconnection
               if (isCallerRef.current) {
                   restartIce();
               }
          } else if (newPC.iceConnectionState === 'connected') {
               setViewState(prev => ({...prev, status: 'connected'}));
          }
      };

      pc.current = newPC;
      return newPC;
  };

  const restartIce = async () => {
      if (!pc.current || !remoteUidRef.current) return;
      console.log("[WebRTC] Restarting ICE...");
      try {
          const offer = await pc.current.createOffer({ iceRestart: true });
          await pc.current.setLocalDescription(offer);
          sendSignal({
              type: 'offer',
              payload: offer,
              fromUid: user.uid,
              fromName: config.username,
              fromAvatar: config.avatarURL,
              toUid: remoteUidRef.current
          });
      } catch (e) {
          console.error("ICE Restart failed", e);
      }
  };

  const checkConnectionStats = async () => {
    if (!pc.current) return;
    try {
        const stats = await pc.current.getStats(null);
        let rtt = 0;
        let packetLoss = 0;

        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                rtt = report.currentRoundTripTime || 0;
            }
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                packetLoss = report.packetsLost / (report.packetsReceived + report.packetsLost) || 0;
            }
        });

        if (rtt > 0.3 || packetLoss > 0.05) setNetworkQuality('bad');
        else if (rtt > 0.15 || packetLoss > 0.02) setNetworkQuality('poor');
        else setNetworkQuality('good');

    } catch (e) {
        // ignore stats errors
    }
  };

  const getMedia = async (videoMode: boolean) => {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
              audio: { echoCancellation: true, noiseSuppression: true }, 
              video: videoMode ? { facingMode: facingMode } : false 
          });
          localStream.current = stream;
          return stream;
      } catch (e) {
          console.error("Media Error:", e);
          alert("Could not access camera/microphone. Check permissions.");
          throw e;
      }
  };

  const formatTime = (secs: number) => {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // --- ACTIONS ---

  const startCall = async (targetUid: string, targetName: string, targetAvatar: string, type: 'audio' | 'video') => {
      onCloseParticipants();
      candidateQueue.current = [];
      remoteUidRef.current = targetUid;
      isCallerRef.current = true; // Set immediate ref for callbacks
      
      try {
          const stream = await getMedia(type === 'video');
          const connection = createPC(targetUid);
          
          stream.getTracks().forEach(track => connection.addTrack(track, stream));

          const offer = await connection.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: type === 'video'
          });
          await connection.setLocalDescription(offer);

          setViewState({
              status: 'calling',
              callId: `${Date.now()}`,
              isCaller: true,
              remoteName: targetName,
              remoteAvatar: targetAvatar,
              type
          });

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
          cleanup();
      }
  };

  const answerCall = async () => {
      if (!incomingCall) return;
      stopRingtone();
      
      const remoteUid = incomingCall.fromUid;
      remoteUidRef.current = remoteUid;
      isCallerRef.current = false;
      
      try {
          const stream = await getMedia(incomingCall.callType === 'video');
          const connection = createPC(remoteUid);
          
          stream.getTracks().forEach(track => connection.addTrack(track, stream));
          
          await connection.setRemoteDescription(new RTCSessionDescription(incomingCall.payload));
          await processCandidateQueue();

          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);

          setViewState({
              status: 'connected',
              callId: incomingCall.callId || '',
              isCaller: false,
              remoteName: incomingCall.fromName,
              remoteAvatar: incomingCall.fromAvatar,
              type: incomingCall.callType || 'audio'
          });

          await sendSignal({
              type: 'answer',
              payload: answer,
              fromUid: user.uid,
              fromName: config.username,
              fromAvatar: config.avatarURL,
              toUid: remoteUid
          });
          
          setIncomingCall(null);

      } catch (e) {
          console.error("Answer call failed", e);
          cleanup();
      }
  };

  const handleHangup = async () => {
      await sendSignal({
          type: 'bye',
          payload: null,
          fromUid: user.uid,
          fromName: config.username,
          fromAvatar: config.avatarURL,
          toUid: remoteUidRef.current || undefined 
      });
      cleanup();
  };

  const handleReject = async () => {
      if (incomingCall) {
          await sendSignal({
            type: 'reject',
            payload: null,
            fromUid: user.uid,
            fromName: config.username,
            fromAvatar: config.avatarURL,
            toUid: incomingCall.fromUid
          });
      }
      setIncomingCall(null);
      stopRingtone();
  };

  const cleanup = () => {
      if (localStream.current) {
          localStream.current.getTracks().forEach(t => t.stop());
          localStream.current = null;
      }
      if (pc.current) {
          pc.current.close();
          pc.current = null;
      }
      remoteStream.current = null;
      
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
      
      stopRingtone();
      setViewState({ status: 'idle', callId: null, isCaller: false, remoteName: '', remoteAvatar: '', type: 'video' });
      setIncomingCall(null);
      candidateQueue.current = [];
      remoteUidRef.current = null;
      isCallerRef.current = false;
      setIsMuted(false);
      setIsSpeakerMuted(false);
      setIsVideoOff(false);
      setCallDuration(0);
      setNetworkQuality('good');
  };
  
  const toggleMute = () => {
      if (localStream.current) {
          localStream.current.getAudioTracks().forEach(t => t.enabled = !t.enabled);
          setIsMuted(!isMuted);
      }
  };

  const toggleVideo = () => {
      if (localStream.current) {
          localStream.current.getVideoTracks().forEach(t => t.enabled = !t.enabled);
          setIsVideoOff(!isVideoOff);
      }
  };

  const switchCamera = async () => {
      if (!localStream.current || viewState.type !== 'video') return;
      const newMode = facingMode === 'user' ? 'environment' : 'user';
      
      try {
          localStream.current.getVideoTracks().forEach(t => t.stop());
          
          const newStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: { facingMode: newMode }
          });
          
          const newVideoTrack = newStream.getVideoTracks()[0];
          
          if (pc.current) {
              const sender = pc.current.getSenders().find(s => s.track?.kind === 'video');
              if (sender) sender.replaceTrack(newVideoTrack);
          }
          
          const audioTrack = localStream.current.getAudioTracks()[0];
          const combinedStream = new MediaStream([audioTrack, newVideoTrack]);
          
          localStream.current = combinedStream;
          setFacingMode(newMode);
          
          if (localVideoRef.current) {
              localVideoRef.current.srcObject = combinedStream;
          }
          
      } catch (e) {
          console.error("Camera switch failed", e);
      }
  };
  
  // --- RENDERS ---

  if (incomingCall) {
      return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in zoom-in-95 duration-300">
              <div className="flex flex-col items-center gap-8 w-full max-w-sm text-center">
                  <div className="relative">
                      <img 
                        src={incomingCall.fromAvatar} 
                        alt="Caller" 
                        className="w-32 h-32 rounded-full object-cover border-4 border-blue-500 shadow-2xl bg-slate-200"
                      />
                      <div className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-30"></div>
                  </div>
                  
                  <div>
                      <h3 className="text-3xl font-bold text-white mb-2">
                          {incomingCall.fromName}
                      </h3>
                      <p className="text-blue-200 font-medium animate-pulse text-lg">
                          Incoming {incomingCall.callType === 'video' ? 'Video' : 'Audio'} Call...
                      </p>
                  </div>

                  <div className="flex items-center justify-between w-full px-8 mt-4">
                      <button onClick={handleReject} className="flex flex-col items-center gap-2 group">
                          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center text-red-500 border-2 border-red-500/50 group-hover:bg-red-500 group-hover:text-white transition-all duration-300">
                              <PhoneOff size={32} fill="currentColor" />
                          </div>
                          <span className="text-sm text-slate-400 font-medium">Decline</span>
                      </button>

                      <button onClick={answerCall} className="flex flex-col items-center gap-2 group">
                          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-green-500/40 group-hover:scale-110 transition-transform duration-300 animate-bounce">
                              {incomingCall.callType === 'video' ? <Video size={32} fill="currentColor" /> : <Phone size={32} fill="currentColor" />}
                          </div>
                          <span className="text-sm text-slate-400 font-medium">Answer</span>
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  if (viewState.status !== 'idle') {
       const showRemoteVideo = viewState.type === 'video' && (viewState.status === 'connected' || viewState.status === 'reconnecting');
       
       return (
          <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
              <div className="flex-1 relative overflow-hidden bg-black">
                  
                  {/* Remote Video */}
                  <video 
                      ref={remoteVideoRef} 
                      autoPlay 
                      playsInline 
                      className={`w-full h-full object-contain bg-black ${showRemoteVideo ? '' : 'hidden'}`} 
                  />

                  {/* Top Bar (Quality & Timer) */}
                  <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-30 pointer-events-none">
                       {/* Connection Quality */}
                       <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                           <Signal size={16} className={
                               networkQuality === 'good' ? 'text-green-500' : 
                               networkQuality === 'poor' ? 'text-yellow-500' : 'text-red-500'
                           } />
                           <span className="text-xs text-white/90 font-medium capitalize">{networkQuality}</span>
                       </div>

                       {/* Timer (only when connected) */}
                       {viewState.status === 'connected' && (
                           <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10">
                               <Clock size={16} className="text-white/80" />
                               <span className="text-xs text-white font-mono">{formatTime(callDuration)}</span>
                           </div>
                       )}
                  </div>
                  
                  {/* Avatar Overlay - Centered Absolutely */}
                  {(!showRemoteVideo) && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center pointer-events-none">
                           <div className="relative mb-6">
                                <img 
                                    src={viewState.remoteAvatar} 
                                    className="w-32 h-32 rounded-full border-4 border-white/10 shadow-2xl bg-slate-800 object-cover mb-6" 
                                />
                                {(viewState.status === 'calling' || viewState.status === 'reconnecting') && (
                                    <div className="absolute inset-0 rounded-full border-4 border-white/20 animate-ping opacity-30"></div>
                                )}
                           </div>
                           <h3 className="text-3xl font-bold text-white mb-2">{viewState.remoteName}</h3>
                           <p className="text-white/60 text-lg font-medium animate-pulse">
                               {viewState.status === 'calling' ? 'Calling...' : viewState.status === 'reconnecting' ? 'Reconnecting...' : 'Connected'}
                           </p>
                      </div>
                  )}

                  {/* Local Video PiP */}
                  {viewState.type === 'video' && (
                      <div className="absolute top-16 right-4 w-28 sm:w-36 aspect-[3/4] bg-slate-900 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 z-20 transition-all hover:scale-105 cursor-pointer">
                          <video 
                            ref={localVideoRef} 
                            autoPlay 
                            playsInline 
                            muted 
                            className="w-full h-full object-cover transform scale-x-[-1]" 
                          />
                      </div>
                  )}
              </div>

              {/* Controls Bar - Optimized for Mobile */}
              <div className="bg-slate-900/90 backdrop-blur-lg p-4 pb-8 sm:p-6 sm:pb-10 flex items-center justify-center gap-3 sm:gap-6 z-30 border-t border-white/10">
                  <button 
                      onClick={toggleMute} 
                      className={`p-3 sm:p-4 rounded-full transition-all ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-800 text-white border border-white/20 hover:bg-slate-700'}`}
                  >
                      {isMuted ? <MicOff className="w-5 h-5 sm:w-7 sm:h-7" /> : <Mic className="w-5 h-5 sm:w-7 sm:h-7" />}
                  </button>

                  <button 
                      onClick={() => setIsSpeakerMuted(!isSpeakerMuted)}
                      className={`p-3 sm:p-4 rounded-full transition-all ${isSpeakerMuted ? 'bg-white text-slate-900' : 'bg-slate-800 text-white border border-white/20 hover:bg-slate-700'}`}
                  >
                      {isSpeakerMuted ? <VolumeX className="w-5 h-5 sm:w-7 sm:h-7" /> : <Volume2 className="w-5 h-5 sm:w-7 sm:h-7" />}
                  </button>
                  
                  <button 
                      onClick={handleHangup} 
                      className="p-4 sm:p-5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/40 hover:scale-105"
                  >
                      <PhoneOff className="w-6 h-6 sm:w-9 sm:h-9" fill="currentColor" />
                  </button>
                  
                  {viewState.type === 'video' && (
                     <>
                        <button 
                            onClick={toggleVideo} 
                            className={`p-3 sm:p-4 rounded-full transition-all ${isVideoOff ? 'bg-white text-slate-900' : 'bg-slate-800 text-white border border-white/20 hover:bg-slate-700'}`}
                        >
                            {isVideoOff ? <VideoOff className="w-5 h-5 sm:w-7 sm:h-7" /> : <Video className="w-5 h-5 sm:w-7 sm:h-7" />}
                        </button>
                        <button 
                            onClick={switchCamera} 
                            className="p-3 sm:p-4 rounded-full bg-slate-800 text-white border border-white/20 hover:bg-slate-700"
                        >
                            <RotateCcw className="w-5 h-5 sm:w-7 sm:h-7" />
                        </button>
                     </>
                  )}
              </div>
          </div>
       );
  }

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
                    {users.filter(u => u.uid !== user.uid).map((u) => (
                        <div key={u.uid} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition group">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <div className="relative">
                                    <img src={u.avatar} className="w-10 h-10 rounded-full bg-slate-200 object-cover border border-slate-100 dark:border-slate-600" />
                                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-slate-800 rounded-full"></span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1 text-sm">
                                        {u.username}
                                        {roomCreatorId === u.uid && <Crown size={12} className="text-yellow-500 fill-yellow-500" />}
                                    </span>
                                    <span className="text-[10px] text-slate-400">Online</span>
                                </div>
                            </div>
                            
                            <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <button 
                                    onClick={() => startCall(u.uid, u.username, u.avatar, 'audio')} 
                                    className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition"
                                    title="Audio Call"
                                >
                                    <Phone size={18} />
                                </button>
                                <button 
                                    onClick={() => startCall(u.uid, u.username, u.avatar, 'video')} 
                                    className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                                    title="Video Call"
                                >
                                    <Video size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                    
                    {users.length <= 1 && (
                        <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-sm flex flex-col items-center gap-2">
                            <AlertCircle size={24} className="opacity-50" />
                            <p>No one else is here yet.</p>
                            <p className="text-xs opacity-70">Share the room details to invite friends!</p>
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
