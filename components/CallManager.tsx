import React, { useEffect, useRef, useState } from 'react';
import { Phone, Video, Mic, MicOff, VideoOff, PhoneOff, RotateCcw, X } from 'lucide-react';
import { db } from '../services/firebase';
import { collection, doc, onSnapshot, addDoc, updateDoc, serverTimestamp, query, where } from 'firebase/firestore';
import { User, ChatConfig } from '../types';
import { initAudio } from '../utils/helpers';

// Public STUN servers
const ICE_SERVERS = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
};

interface CallManagerProps {
  user: User;
  config: ChatConfig;
  users: any[]; 
  onCloseParticipants: () => void;
  showParticipants: boolean;
}

const CallManager: React.FC<CallManagerProps> = ({ user, config, users, onCloseParticipants, showParticipants }) => {
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [activeCall, setActiveCall] = useState<any>(null);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected'>('idle');
  
  // Media States
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  // Stream States - We store these in state to trigger re-renders when streams arrive
  const [remoteMediaStream, setRemoteMediaStream] = useState<MediaStream | null>(null);
  const [localMediaStream, setLocalMediaStream] = useState<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null); // Keep ref for logic access
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);
  const candidateQueue = useRef<RTCIceCandidate[]>([]);

  // --- 1. Attach Media to Video Elements when DOM is ready ---
  
  useEffect(() => {
      if (remoteVideoRef.current && remoteMediaStream) {
          remoteVideoRef.current.srcObject = remoteMediaStream;
          // Ensure audio plays
          remoteVideoRef.current.play().catch(e => console.error("Remote video play error", e));
      }
  }, [remoteMediaStream, activeCall]);

  useEffect(() => {
      if (localVideoRef.current && localMediaStream) {
          localVideoRef.current.srcObject = localMediaStream;
          localVideoRef.current.muted = true; // Always mute local to avoid feedback
      }
  }, [localMediaStream, activeCall]);


  // --- 2. Signaling Listeners ---

  useEffect(() => {
    // Listen for incoming calls
    const q = query(
        collection(db, "chats", config.roomKey, "calls"),
        where("calleeId", "==", user.uid),
        where("status", "==", "offering")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                if (callStatus === 'idle') {
                   setIncomingCall({ id: change.doc.id, ...data });
                   playRingtone();
                }
            }
            if (change.type === "removed") {
               if (incomingCall && incomingCall.id === change.doc.id) {
                   stopRingtone();
                   setIncomingCall(null);
               }
            }
        });
    });

    return () => {
        unsubscribe();
        stopRingtone();
        endCall(false); // Cleanup on unmount
    };
  }, [config.roomKey, user.uid]); // Removed callStatus/incomingCall dependency to prevent loop

  // Listen to active call updates
  useEffect(() => {
      if (!activeCall) return;

      const callDocRef = doc(db, "chats", config.roomKey, "calls", activeCall.id);
      const unsub = onSnapshot(callDocRef, async (snapshot) => {
          const data = snapshot.data();
          if (!data) {
              endCall(false);
              return;
          }
          
          // Caller handles "answered"
          if (activeCall.isCaller && data.status === 'answered' && data.answer && !peerConnection.current?.currentRemoteDescription) {
               try {
                   const answerDescription = new RTCSessionDescription(data.answer);
                   await peerConnection.current?.setRemoteDescription(answerDescription);
                   setCallStatus('connected');
                   processCandidateQueue();
               } catch (e) {
                   console.error("Error setting remote description", e);
               }
          } else if (data.status === 'ended' || data.status === 'declined') {
              endCall(false);
          }
      });

      // Listen for candidates
      const collectionName = activeCall.isCaller ? 'answerCandidates' : 'offerCandidates';
      const candidatesRef = collection(callDocRef, collectionName);
      
      const unsubCandidates = onSnapshot(candidatesRef, (snapshot) => {
           snapshot.docChanges().forEach((change) => {
               if (change.type === 'added') {
                   const candidateData = change.doc.data();
                   try {
                       const candidate = new RTCIceCandidate(candidateData);
                       if (peerConnection.current && peerConnection.current.remoteDescription) {
                           peerConnection.current.addIceCandidate(candidate);
                       } else {
                           candidateQueue.current.push(candidate);
                       }
                   } catch (e) {
                       console.error("Error adding ICE candidate", e);
                   }
               }
           });
      });

      return () => {
          unsub();
          unsubCandidates();
      };
  }, [activeCall?.id]); 


  // --- Actions ---

  const processCandidateQueue = async () => {
      if (!peerConnection.current) return;
      while (candidateQueue.current.length > 0) {
          const candidate = candidateQueue.current.shift();
          if (candidate) {
              peerConnection.current.addIceCandidate(candidate).catch(e => console.error(e));
          }
      }
  };

  const playRingtone = () => {
      initAudio();
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); 
      audio.loop = true;
      audio.play().catch(() => {});
      ringtoneRef.current = audio;
  };

  const stopRingtone = () => {
      if (ringtoneRef.current) {
          ringtoneRef.current.pause();
          ringtoneRef.current = null;
      }
  };

  const startLocalStream = async (type: 'audio' | 'video') => {
    try {
        // Always request audio. Video is optional based on type.
        const constraints = {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: type === 'video' ? { facingMode: facingMode } : false
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        setLocalMediaStream(stream); // Update state to render
        return stream;
    } catch (err) {
        console.error("Error accessing media devices:", err);
        alert("Could not access camera/microphone. Please check permissions.");
        return null;
    }
  };

  const createPeerConnection = (callId: string, isCaller: boolean) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      
      pc.onicecandidate = (event) => {
          if (event.candidate) {
              const collectionName = isCaller ? 'offerCandidates' : 'answerCandidates';
              const cRef = collection(db, "chats", config.roomKey, "calls", callId, collectionName);
              addDoc(cRef, event.candidate.toJSON());
          }
      };

      pc.ontrack = (event) => {
          // Important: Store remote stream in state so useEffect can attach it when video DOM is ready
          if (event.streams && event.streams[0]) {
              console.log("Received remote stream", event.streams[0]);
              setRemoteMediaStream(event.streams[0]);
          }
      };

      // Add local tracks to PC
      if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => {
              pc.addTrack(track, localStreamRef.current!);
          });
      }

      peerConnection.current = pc;
      return pc;
  };

  const initiateCall = async (targetUid: string, targetName: string, targetAvatar: string, type: 'audio' | 'video') => {
      onCloseParticipants();

      const stream = await startLocalStream(type);
      if(!stream) return;

      setCallStatus('calling');

      const callDocRef = await addDoc(collection(db, "chats", config.roomKey, "calls"), {
          callerId: user.uid,
          callerName: config.username,
          callerAvatar: config.avatarURL,
          calleeId: targetUid,
          type,
          status: 'offering',
          createdAt: serverTimestamp()
      });

      const pc = createPeerConnection(callDocRef.id, true);
      
      const offerDescription = await pc.createOffer();
      await pc.setLocalDescription(offerDescription);

      const offer = {
          type: offerDescription.type,
          sdp: offerDescription.sdp,
      };

      await updateDoc(callDocRef, { offer });

      setActiveCall({ 
          id: callDocRef.id, 
          isCaller: true, 
          otherName: targetName, 
          otherAvatar: targetAvatar, 
          type 
      });
  };

  const answerCall = async () => {
      if (!incomingCall) return;
      const callId = incomingCall.id;
      const callType = incomingCall.type;
      
      stopRingtone();
      
      // Update UI immediately to prevent double clicks
      setActiveCall({ 
          id: callId, 
          isCaller: false, 
          otherName: incomingCall.callerName, 
          otherAvatar: incomingCall.callerAvatar, 
          type: callType 
      });
      setCallStatus('connected');
      setIncomingCall(null);

      // Start media
      const stream = await startLocalStream(callType);
      if(!stream) { 
          endCall(true);
          return; 
      }

      // Create PC
      const pc = createPeerConnection(callId, false);

      // Handle Offer
      const offerDescription = new RTCSessionDescription(incomingCall.offer);
      await pc.setRemoteDescription(offerDescription);
      
      // Create Answer
      const answerDescription = await pc.createAnswer();
      await pc.setLocalDescription(answerDescription);

      const answer = {
          type: answerDescription.type,
          sdp: answerDescription.sdp,
      };

      await updateDoc(doc(db, "chats", config.roomKey, "calls", callId), { answer, status: 'answered' });
      
      processCandidateQueue();
  };

  const declineCall = async () => {
      stopRingtone();
      if (incomingCall) {
        const callRef = doc(db, "chats", config.roomKey, "calls", incomingCall.id);
        await updateDoc(callRef, { status: 'declined' }).catch(() => {});
        setIncomingCall(null);
      }
  };

  const endCall = async (updateDb = true) => {
      if (peerConnection.current) {
          peerConnection.current.onicecandidate = null;
          peerConnection.current.ontrack = null;
          peerConnection.current.close();
          peerConnection.current = null;
      }
      
      if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
          localStreamRef.current = null;
      }

      setLocalMediaStream(null);
      setRemoteMediaStream(null);
      
      if (updateDb && activeCall) {
          const callRef = doc(db, "chats", config.roomKey, "calls", activeCall.id);
          try { await updateDoc(callRef, { status: 'ended' }); } catch(e) {}
      }

      setActiveCall(null);
      setCallStatus('idle');
      setIsMuted(false);
      setIsVideoOff(false);
      candidateQueue.current = [];
  };

  const toggleMute = () => {
      if (localStreamRef.current) {
          localStreamRef.current.getAudioTracks().forEach(track => track.enabled = !track.enabled);
          setIsMuted(!isMuted);
      }
  };

  const toggleVideo = () => {
    if (localStreamRef.current && activeCall.type === 'video') {
        localStreamRef.current.getVideoTracks().forEach(track => track.enabled = !track.enabled);
        setIsVideoOff(!isVideoOff);
    }
  };

  const switchCamera = async () => {
      if (activeCall.type !== 'video') return;
      const newMode = facingMode === 'user' ? 'environment' : 'user';
      setFacingMode(newMode);
      
      if (localStreamRef.current) {
          // Stop only video tracks
          localStreamRef.current.getVideoTracks().forEach(track => track.stop());
      }
      
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: true, // Re-request audio to keep stream valid
            video: { facingMode: newMode }
        });
        
        // Replace video track in Peer Connection sender
        const newVideoTrack = newStream.getVideoTracks()[0];
        const sender = peerConnection.current?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
            sender.replaceTrack(newVideoTrack);
        }
        
        // Update ref and state
        localStreamRef.current = newStream;
        setLocalMediaStream(newStream);
      } catch (e) {
          console.error("Failed to switch camera", e);
      }
  };

  // --- UI ---

  if (incomingCall) {
      return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl text-center border border-white/10">
                  <img src={incomingCall.callerAvatar} alt="Caller" className="w-24 h-24 rounded-full mx-auto mb-4 border-4 border-blue-500 bg-slate-200" />
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">{incomingCall.callerName}</h3>
                  <p className="text-slate-500 dark:text-slate-400 mb-8 animate-pulse">
                      Incoming {incomingCall.type === 'video' ? 'Video' : 'Voice'} Call...
                  </p>
                  <div className="flex justify-center gap-8">
                      <button onClick={declineCall} className="flex flex-col items-center gap-2 group">
                          <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center text-white shadow-lg group-hover:bg-red-600 transition transform group-hover:scale-110">
                              <PhoneOff size={32} />
                          </div>
                          <span className="text-sm text-slate-500 dark:text-slate-400">Decline</span>
                      </button>
                      <button onClick={answerCall} className="flex flex-col items-center gap-2 group">
                          <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white shadow-lg group-hover:bg-green-600 transition transform group-hover:scale-110 animate-bounce">
                              {incomingCall.type === 'video' ? <Video size={32} /> : <Phone size={32} />}
                          </div>
                          <span className="text-sm text-slate-500 dark:text-slate-400">Answer</span>
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  if (activeCall) {
      return (
          <div className="fixed inset-0 z-[60] bg-slate-950 flex flex-col">
              {/* Main Media Area */}
              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                  {/* Remote Video */}
                  {/* Note: We always render the video tag for Audio calls too, because tracks need an element to play */}
                  <video 
                      ref={remoteVideoRef} 
                      autoPlay 
                      playsInline 
                      className={`w-full h-full object-contain bg-black ${activeCall.type === 'audio' ? 'opacity-0 absolute h-1 w-1' : ''}`} 
                  />
                  
                  {/* Placeholder for Audio Call or Video Loading */}
                  {(activeCall.type === 'audio' || (!remoteMediaStream && callStatus === 'connected')) && (
                      <div className="flex flex-col items-center z-10 animate-in fade-in zoom-in">
                           <img src={activeCall.otherAvatar} className="w-32 h-32 rounded-full border-4 border-white/20 shadow-2xl mb-6 bg-slate-800" />
                           <h3 className="text-3xl text-white font-bold mb-2">{activeCall.otherName}</h3>
                           <p className="text-white/60 text-lg animate-pulse">
                               {callStatus === 'calling' ? 'Calling...' : (remoteMediaStream ? 'Connected' : 'Connecting...')}
                           </p>
                      </div>
                  )}

                  {/* Local Video (PiP) - Only for video calls */}
                  {activeCall.type === 'video' && (
                      <div className="absolute top-4 right-4 w-28 sm:w-36 aspect-[3/4] bg-slate-800 rounded-xl overflow-hidden shadow-2xl border border-white/10 z-20">
                          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover transform scale-x-[-1]" />
                      </div>
                  )}
              </div>

              {/* Controls */}
              <div className="bg-slate-900/80 backdrop-blur p-6 pb-10 flex items-center justify-center gap-6 z-30">
                  <button 
                      onClick={toggleMute} 
                      className={`p-4 rounded-full ${isMuted ? 'bg-white text-slate-900' : 'bg-white/10 text-white hover:bg-white/20'} transition`}
                  >
                      {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>
                  
                  {activeCall.type === 'video' && (
                    <>
                        <button 
                            onClick={toggleVideo} 
                            className={`p-4 rounded-full ${isVideoOff ? 'bg-white text-slate-900' : 'bg-white/10 text-white hover:bg-white/20'} transition`}
                        >
                            {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                        </button>
                        <button 
                            onClick={switchCamera} 
                            className="p-4 rounded-full bg-white/10 text-white hover:bg-white/20 transition md:hidden"
                        >
                            <RotateCcw size={24} />
                        </button>
                    </>
                  )}

                  <button 
                      onClick={() => endCall(true)} 
                      className="p-4 rounded-full bg-red-500 text-white hover:bg-red-600 transition shadow-lg shadow-red-500/50"
                  >
                      <PhoneOff size={32} fill="currentColor" />
                  </button>
              </div>
          </div>
      );
  }

  // Participant List Modal
  if (showParticipants) {
      return (
        <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm flex items-start justify-end p-4 sm:p-6" onClick={onCloseParticipants}>
            <div className="bg-white dark:bg-slate-800 w-full max-w-xs rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden animate-in slide-in-from-right-4 mt-14" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
                    <h3 className="font-bold text-slate-800 dark:text-slate-100">Active Participants ({users.length})</h3>
                    <button onClick={onCloseParticipants}><div className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition"><X size={20} className="text-slate-500 dark:text-slate-400" /></div></button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-2">
                    {users.length === 0 && <p className="p-4 text-center text-slate-400 text-sm">No one else is here.</p>}
                    {users.filter(u => u.uid !== user.uid).map((u) => (
                        <div key={u.uid} className="flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-xl transition group">
                            <div className="flex items-center gap-3 overflow-hidden">
                                <img src={u.avatar} className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-600" />
                                <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{u.username}</span>
                            </div>
                            <div className="flex gap-1">
                                <button 
                                    onClick={() => initiateCall(u.uid, u.username, u.avatar, 'audio')}
                                    className="p-2 text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition"
                                    title="Voice Call"
                                >
                                    <Phone size={18} />
                                </button>
                                <button 
                                    onClick={() => initiateCall(u.uid, u.username, u.avatar, 'video')}
                                    className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                                    title="Video Call"
                                >
                                    <Video size={18} />
                                </button>
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
