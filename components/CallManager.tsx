
import React, { useEffect, useRef, useState } from 'react';
import { Phone, Video, Mic, MicOff, PhoneOff, X, User as UserIcon, Crown, AlertCircle } from 'lucide-react';
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
  const [incomingCall, setIncomingCall] = useState<SignalData | null>(null);

  // WebRTC Refs
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const channelRef = useRef<any>(null);
  const candidateQueue = useRef<RTCIceCandidateInit[]>([]);
  
  // Logic Refs (to avoid stale closures in callbacks)
  const isCallerRef = useRef(false);
  const remoteUidRef = useRef<string | null>(null);
  
  // DOM Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // --- 1. SYNC STATE TO REFS ---
  useEffect(() => {
      isCallerRef.current = viewState.isCaller;
  }, [viewState.isCaller]);

  // --- 2. HANDLE VIDEO ATTACHMENT (The "Black Screen" Fix) ---
  // This ensures that when the UI updates to show the video tag, 
  // we immediately attach the stream if it's already available.
  useEffect(() => {
    if (viewState.status === 'connected' || viewState.status === 'reconnecting') {
        // Attach Remote Stream if waiting
        if (remoteVideoRef.current && remoteStream.current) {
            console.log("[WebRTC] Late attaching remote stream to DOM");
            remoteVideoRef.current.srcObject = remoteStream.current;
            remoteVideoRef.current.play().catch(e => console.warn("Remote autoplay error:", e));
        }
        
        // Attach Local Stream (for PiP)
        if (localVideoRef.current && localStream.current) {
             localVideoRef.current.srcObject = localStream.current;
             localVideoRef.current.muted = true; // Always mute local video to prevent echo
        }
    }
  }, [viewState.status]);

  // --- 3. SIGNALING SETUP ---
  useEffect(() => {
     if (!config.roomKey) return;
     
     const channel = supabase.channel(`calls:${config.roomKey}`);
     
     channel.on('broadcast', { event: 'signal' }, ({ payload }: { payload: SignalData }) => {
         if (payload.fromUid === user.uid) return; // Ignore own messages
         if (payload.toUid && payload.toUid !== user.uid) return; // Ignore messages not for us

         handleSignalMessage(payload);
     });

     channel.subscribe((status) => {
         if (status === 'SUBSCRIBED') console.log("[WebRTC] Signaling Connected");
     });
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
      if (data.type === 'offer') {
          if (viewState.status !== 'idle' && viewState.status !== 'incoming') {
              console.log("[WebRTC] Busy, ignoring offer");
              return;
          }
          
          console.log("[WebRTC] Received Offer from", data.fromName);
          candidateQueue.current = [];
          remoteUidRef.current = data.fromUid; // Important: Set remote UID early
          
          setIncomingCall(data);
          initAudio();
          startRingtone();
      }
      
      else if (data.type === 'answer') {
           console.log("[WebRTC] Received Answer");
           if (viewState.status === 'calling' && pc.current) {
               try {
                   await pc.current.setRemoteDescription(new RTCSessionDescription(data.payload));
                   setViewState(prev => ({ ...prev, status: 'connected' }));
                   await processCandidateQueue();
               } catch (err) {
                   console.error("[WebRTC] Error setting remote description:", err);
               }
           }
      }
      
      else if (data.type === 'candidate') {
           if (pc.current && pc.current.remoteDescription) {
               try {
                   await pc.current.addIceCandidate(new RTCIceCandidate(data.payload));
               } catch (e) {
                   console.error("[WebRTC] Error adding ice candidate:", e);
               }
           } else {
               // Queue candidates if connection isn't ready yet
               candidateQueue.current.push(data.payload);
           }
      }
      
      else if (data.type === 'bye' || data.type === 'reject') {
           console.log("[WebRTC] Call ended by remote");
           if (incomingCall && incomingCall.fromUid === data.fromUid) {
               setIncomingCall(null);
               stopRingtone();
           } else if (viewState.status !== 'idle') {
               cleanup();
           }
      }
  };

  const processCandidateQueue = async () => {
      if (!pc.current) return;
      while (candidateQueue.current.length > 0) {
          const candidate = candidateQueue.current.shift();
          if (candidate) {
              try {
                  await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {
                  console.error("[WebRTC] Error processing queued candidate", e);
              }
          }
      }
  };

  // --- 4. WEBRTC LOGIC ---

  const createPC = (targetUid?: string) => {
      const newPC = new RTCPeerConnection(ICE_SERVERS);
      pc.current = newPC;

      // Handle ICE Candidates
      newPC.onicecandidate = (event) => {
          if (event.candidate) {
              // Determine target: if we are caller, use passed targetUid. If callee, use remoteUidRef.
              const destUid = targetUid || remoteUidRef.current;
              if (destUid) {
                  sendSignal({
                      type: 'candidate',
                      payload: event.candidate.toJSON(),
                      fromUid: user.uid,
                      fromName: config.username,
                      fromAvatar: config.avatarURL,
                      toUid: destUid, 
                  });
              }
          }
      };

      // Handle Remote Stream (The most critical part for Audio/Video)
      newPC.ontrack = (event) => {
          console.log(`[WebRTC] Received Remote Track: ${event.track.kind}`);
          
          if (!remoteStream.current) {
              remoteStream.current = new MediaStream();
          }
          
          remoteStream.current.addTrack(event.track);

          // Try to attach immediately if the video element is already rendered
          if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = remoteStream.current;
              remoteVideoRef.current.play().catch(e => console.warn("Remote play error:", e));
          }
      };
      
      newPC.oniceconnectionstatechange = () => {
          console.log(`[WebRTC] ICE State: ${newPC.iceConnectionState}`);
          if (newPC.iceConnectionState === 'disconnected' || newPC.iceConnectionState === 'failed') {
               setViewState(prev => ({...prev, status: 'reconnecting'}));
          } else if (newPC.iceConnectionState === 'connected') {
               setViewState(prev => ({...prev, status: 'connected'}));
          }
      };

      return newPC;
  };

  const getMedia = async (video: boolean) => {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
              audio: { echoCancellation: true, noiseSuppression: true }, 
              video: video ? { facingMode: 'user' } : false 
          });
          localStream.current = stream;
          return stream;
      } catch (e) {
          console.error("[WebRTC] Media Access Error:", e);
          alert("Could not access camera or microphone. Please check permissions.");
          throw e;
      }
  };

  const startCall = async (targetUid: string, targetName: string, targetAvatar: string, type: 'audio' | 'video') => {
      onCloseParticipants();
      candidateQueue.current = [];
      remoteUidRef.current = targetUid;
      isCallerRef.current = true;
      
      try {
          const stream = await getMedia(type === 'video');
          const connection = createPC(targetUid);
          
          stream.getTracks().forEach(t => connection.addTrack(t, stream));

          // Create Offer with explicit media constraints
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
          
          stream.getTracks().forEach(t => connection.addTrack(t, stream));
          
          await connection.setRemoteDescription(new RTCSessionDescription(incomingCall.payload));
          await processCandidateQueue(); // Process any candidates that arrived early

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

  const cleanup = () => {
      if (localStream.current) {
          localStream.current.getTracks().forEach(t => t.stop());
          localStream.current = null;
      }
      if (pc.current) {
          pc.current.close();
          pc.current = null;
      }
      if (remoteStream.current) {
          remoteStream.current.getTracks().forEach(t => t.stop());
          remoteStream.current = null;
      }
      
      stopRingtone();
      setViewState({ status: 'idle', callId: null, isCaller: false, remoteName: '', remoteAvatar: '', type: 'video' });
      setIncomingCall(null);
      candidateQueue.current = [];
      remoteUidRef.current = null;
      isCallerRef.current = false;
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
      stopRingtone();
      setIncomingCall(null);
  };
  
  const toggleMute = () => {
      if (localStream.current) {
          localStream.current.getAudioTracks().forEach(t => t.enabled = !t.enabled);
          setIsMuted(!isMuted);
      }
  };
  
  // --- UI ---

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
       return (
          <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
              <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
                  <video 
                      ref={remoteVideoRef} 
                      autoPlay 
                      playsInline 
                      className={`w-full h-full object-contain ${viewState.type === 'video' ? '' : 'hidden'}`} 
                  />
                  
                  {/* Audio Call UI (or Video Call without remote video yet) */}
                  {(viewState.type === 'audio' || viewState.status !== 'connected') && (
                      <div className="flex flex-col items-center z-10 p-6 text-center">
                           <img src={viewState.remoteAvatar} className="w-32 h-32 rounded-full border-4 border-white/10 shadow-2xl bg-slate-800 object-cover mb-6" />
                           <h3 className="text-3xl font-bold text-white mb-2">{viewState.remoteName}</h3>
                           <p className="text-white/60 text-lg font-medium animate-pulse">
                               {viewState.status === 'calling' ? 'Calling...' : viewState.status === 'reconnecting' ? 'Reconnecting...' : 'Connected'}
                           </p>
                      </div>
                  )}

                  {viewState.type === 'video' && (
                      <div className="absolute top-4 right-4 w-28 sm:w-36 aspect-[3/4] bg-slate-900 rounded-xl overflow-hidden shadow-2xl border-2 border-white/20 z-20">
                          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                      </div>
                  )}
              </div>

              <div className="bg-slate-900/90 backdrop-blur-lg p-6 pb-10 flex items-center justify-center gap-8 z-30 border-t border-white/10">
                  <button 
                      onClick={toggleMute} 
                      className={`p-4 rounded-full transition-all ${isMuted ? 'bg-white text-slate-900' : 'bg-slate-800 text-white border border-white/20 hover:bg-slate-700'}`}
                  >
                      {isMuted ? <MicOff size={28} /> : <Mic size={28} />}
                  </button>
                  
                  <button 
                      onClick={handleHangup} 
                      className="p-5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/40 hover:scale-105"
                  >
                      <PhoneOff size={36} fill="currentColor" />
                  </button>
                  
                  {viewState.type === 'video' && (
                     <div className="p-4 w-[60px]"></div> 
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
