
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Phone, Video, Mic, MicOff, VideoOff, PhoneOff, RotateCcw, X, User as UserIcon, AlertCircle, Volume2, VolumeX, Signal, Crown } from 'lucide-react';
import { supabase } from '../services/supabase';
import { User, ChatConfig, Presence, SignalData } from '../types';
import { initAudio, startRingtone, stopRingtone } from '../utils/helpers';

// Public Google STUN servers
const ICE_SERVERS = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
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
  // --- UI State ---
  const [viewState, setViewState] = useState<CallState>({
    status: 'idle',
    callId: null,
    isCaller: false,
    remoteName: '',
    remoteAvatar: '',
    type: 'video'
  });
  
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [incomingCall, setIncomingCall] = useState<SignalData | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [networkQuality, setNetworkQuality] = useState<'good' | 'poor' | 'bad'>('good');
  const [networkStats, setNetworkStats] = useState({ rtt: 0, loss: 0 });

  // --- Logic Refs ---
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  
  // Refs for channel communication
  const channelRef = useRef<any>(null);
  
  // DOM Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Initialize Channel
  useEffect(() => {
     if (!config.roomKey) return;
     
     // Join the room channel for signaling
     const channel = supabase.channel(`room:${config.roomKey}`);
     
     channel.on('broadcast', { event: 'signal' }, ({ payload }: { payload: SignalData }) => {
         // Filter out messages not meant for us
         if (payload.toUid && payload.toUid !== user.uid) return;
         if (payload.fromUid === user.uid) return; // Ignore own messages

         handleSignalMessage(payload);
     });

     channel.subscribe();
     channelRef.current = channel;

     return () => {
         supabase.removeChannel(channel);
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
      // 1. Handle Incoming Offer
      if (data.type === 'offer') {
          // If we are already in a call, ignore or busy?
          if (viewState.status !== 'idle' && viewState.status !== 'incoming') return;
          
          setIncomingCall(data);
          initAudio();
          startRingtone();
      }
      
      // 2. Handle Answer (Caller receives answer)
      else if (data.type === 'answer') {
           if (viewState.status === 'calling' && pc.current) {
               await pc.current.setRemoteDescription(new RTCSessionDescription(data.payload));
               setViewState(prev => ({ ...prev, status: 'connected' }));
           }
      }
      
      // 3. Handle Candidates
      else if (data.type === 'candidate') {
           if (pc.current && pc.current.remoteDescription) {
               await pc.current.addIceCandidate(new RTCIceCandidate(data.payload));
           }
      }
      
      // 4. Handle Bye / Reject
      else if (data.type === 'bye' || data.type === 'reject') {
           if (viewState.status !== 'idle') {
               cleanup();
           }
           if (incomingCall) {
               setIncomingCall(null);
               stopRingtone();
           }
      }
  };

  // --- WebRTC Logic ---

  const createPC = () => {
      const newPC = new RTCPeerConnection(ICE_SERVERS);
      pc.current = newPC;

      newPC.onicecandidate = (event) => {
          if (event.candidate) {
              sendSignal({
                  type: 'candidate',
                  payload: event.candidate.toJSON(),
                  fromUid: user.uid,
                  fromName: config.username,
                  fromAvatar: config.avatarURL,
                  toUid: viewState.isCaller ? undefined : incomingCall?.fromUid, // Send back to caller or specific target if known
              });
          }
      };

      newPC.ontrack = (event) => {
          if (!remoteStream.current) remoteStream.current = new MediaStream();
          remoteStream.current.addTrack(event.track);
          
          if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream.current;
              remoteVideoRef.current.play().catch(console.error);
          }
      };
      
      newPC.oniceconnectionstatechange = () => {
          if (newPC.iceConnectionState === 'disconnected' || newPC.iceConnectionState === 'failed') {
               setViewState(prev => ({...prev, status: 'reconnecting'}));
               // Simple reconnection logic could go here (restart ICE)
          } else if (newPC.iceConnectionState === 'connected') {
               setViewState(prev => ({...prev, status: 'connected'}));
          }
      };

      return newPC;
  };

  const getMedia = async (video: boolean) => {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
          localStream.current = stream;
          return stream;
      } catch (e) {
          console.error("Media error", e);
          setErrorMsg("Could not access camera/microphone");
          throw e;
      }
  };

  const startCall = async (targetUid: string, targetName: string, targetAvatar: string, type: 'audio' | 'video') => {
      onCloseParticipants();
      try {
          const stream = await getMedia(type === 'video');
          const connection = createPC();
          
          stream.getTracks().forEach(t => connection.addTrack(t, stream));

          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);

          setViewState({
              status: 'calling',
              callId: 'temp-id', // No DB ID needed for broadcast
              isCaller: true,
              remoteName: targetName,
              remoteAvatar: targetAvatar,
              type
          });

          // Send Offer
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
          cleanup();
      }
  };

  const answerCall = async () => {
      if (!incomingCall) return;
      stopRingtone();
      
      try {
          const stream = await getMedia(incomingCall.callType === 'video');
          const connection = createPC();
          
          stream.getTracks().forEach(t => connection.addTrack(t, stream));
          
          await connection.setRemoteDescription(new RTCSessionDescription(incomingCall.payload));
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
              toUid: incomingCall.fromUid
          });
          
          setIncomingCall(null);

      } catch (e) {
          console.error(e);
          cleanup();
      }
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
      stopRingtone();
      setViewState({ status: 'idle', callId: null, isCaller: false, remoteName: '', remoteAvatar: '', type: 'video' });
      setIncomingCall(null);
      setErrorMsg(null);
  };

  const handleHangup = async () => {
      await sendSignal({
          type: 'bye',
          payload: null,
          fromUid: user.uid,
          fromName: config.username,
          fromAvatar: config.avatarURL
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
      cleanup();
  };
  
  const toggleMute = () => {
      if (localStream.current) {
          localStream.current.getAudioTracks().forEach(t => t.enabled = !t.enabled);
          setIsMuted(!isMuted);
      }
  };
  
  // -- RENDERERS (Same UI as before) --

  if (incomingCall) {
      return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
              <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 w-full max-w-sm text-center border border-white/10 shadow-2xl flex flex-col items-center gap-6 animate-in zoom-in-95 duration-300">
                  <div className="relative">
                      <img 
                        src={incomingCall.fromAvatar} 
                        alt="Caller" 
                        className="w-28 h-28 rounded-full object-cover border-4 border-blue-500 shadow-xl bg-slate-200"
                      />
                      <div className="absolute inset-0 rounded-full border-4 border-blue-400 animate-ping opacity-20"></div>
                  </div>
                  
                  <div>
                      <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
                          {incomingCall.fromName}
                      </h3>
                      <p className="text-slate-500 dark:text-slate-400 font-medium animate-pulse">
                          Incoming {incomingCall.callType === 'video' ? 'Video' : 'Audio'} Call...
                      </p>
                  </div>

                  <div className="flex items-center justify-center gap-8 w-full mt-2">
                      <button onClick={handleReject} className="flex flex-col items-center gap-2 group">
                          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 border-2 border-red-500/20 group-hover:bg-red-500 group-hover:text-white transition-all duration-300">
                              <PhoneOff size={32} fill="currentColor" />
                          </div>
                          <span className="text-sm text-slate-500 font-medium">Decline</span>
                      </button>

                      <button onClick={answerCall} className="flex flex-col items-center gap-2 group">
                          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg shadow-green-500/40 group-hover:scale-110 transition-transform duration-300 animate-bounce">
                              {incomingCall.callType === 'video' ? <Video size={32} fill="currentColor" /> : <Phone size={32} fill="currentColor" />}
                          </div>
                          <span className="text-sm text-slate-500 font-medium">Answer</span>
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  if (viewState.status !== 'idle') {
       return (
          <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
              <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
                  <video 
                      ref={remoteVideoRef} 
                      autoPlay 
                      playsInline 
                      className={`w-full h-full object-contain ${viewState.type === 'video' ? '' : 'hidden'}`} 
                  />
                  
                  {viewState.type === 'audio' && (
                      <div className="flex flex-col items-center z-10 animate-in fade-in zoom-in duration-500 p-6 text-center">
                           <img src={viewState.remoteAvatar} className="w-32 h-32 rounded-full border-4 border-white/10 shadow-2xl bg-slate-800 object-cover mb-4" />
                           <h3 className="text-3xl font-bold text-white mb-2">{viewState.remoteName}</h3>
                           <p className="text-white/60 text-lg font-medium">{viewState.status === 'calling' ? 'Calling...' : 'Connected'}</p>
                      </div>
                  )}

                  {viewState.type === 'video' && (
                      <div className="absolute top-4 right-4 w-28 sm:w-32 aspect-[3/4] bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-white/10 z-20">
                          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                      </div>
                  )}
              </div>

              <div className="bg-slate-900/90 backdrop-blur-lg p-6 pb-10 flex items-center justify-center gap-6 z-30 border-t border-white/5">
                  <button onClick={toggleMute} className={`p-4 rounded-full transition-all ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                      {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>
                  <button onClick={handleHangup} className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/40 hover:scale-110">
                      <PhoneOff size={32} fill="currentColor" />
                  </button>
              </div>
          </div>
       );
  }

  // Participants List
  if (showParticipants) {
      return (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm flex items-start justify-end p-4 sm:p-6" onClick={onCloseParticipants}>
            <div className="bg-white dark:bg-slate-800 w-full max-w-xs rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden animate-in slide-in-from-right-4 mt-14" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100">Participants ({users.length})</h3>
                    <button onClick={onCloseParticipants}><X size={20} /></button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-2 space-y-1">
                    {users.filter(u => u.uid !== user.uid).map((u) => (
                        <div key={u.uid} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <img src={u.avatar} className="w-10 h-10 rounded-full bg-slate-200 object-cover" />
                                <span className="font-medium text-slate-700 dark:text-slate-200 truncate flex items-center gap-1">
                                    {u.username}
                                    {roomCreatorId === u.uid && <Crown size={14} className="text-yellow-500 fill-yellow-500 ml-1" />}
                                </span>
                            </div>
                            <div className="flex gap-1">
                                <button onClick={() => startCall(u.uid, u.username, u.avatar, 'audio')} className="p-2 text-slate-400 hover:text-green-500 rounded-lg"><Phone size={18} /></button>
                                <button onClick={() => startCall(u.uid, u.username, u.avatar, 'video')} className="p-2 text-slate-400 hover:text-blue-500 rounded-lg"><Video size={18} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      );
  }

  return null;
};

export default CallManager;
