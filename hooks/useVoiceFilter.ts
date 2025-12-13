
import { useRef, useState, useCallback } from 'react';

export type VoiceFilterType = 'normal' | 'deep' | 'robot';

export const useVoiceFilter = () => {
  const [filterType, setFilterType] = useState<VoiceFilterType>('normal');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const processedStreamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (audioSourceRef.current) {
        try { audioSourceRef.current.disconnect(); } catch(e) {}
        audioSourceRef.current = null;
    }
    if (audioDestRef.current) {
        try { audioDestRef.current.disconnect(); } catch(e) {}
        audioDestRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        try { audioCtxRef.current.close(); } catch(e) {}
        audioCtxRef.current = null;
    }
    processedStreamRef.current = null;
  }, []);

  const processStream = useCallback((stream: MediaStream, type: VoiceFilterType): MediaStream => {
    if (type === 'normal') {
        cleanup();
        return stream;
    }

    cleanup();

    try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        audioSourceRef.current = source;
        
        const destination = ctx.createMediaStreamDestination();
        audioDestRef.current = destination;

        if (type === 'deep') {
            // Lowpass filter + Gain for "Deep" effect
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 400; 
            
            const gain = ctx.createGain();
            gain.gain.value = 1.6; 
            
            source.connect(filter);
            filter.connect(gain);
            gain.connect(destination);
        } 
        else if (type === 'robot') {
             // Ring Modulator for "Robot" effect
             const oscillator = ctx.createOscillator();
             oscillator.type = 'square';
             oscillator.frequency.value = 50; 
             oscillator.start();

             const ringMod = ctx.createGain();
             ringMod.gain.value = 1.0; 

             const dryNodes = ctx.createGain();
             dryNodes.gain.value = 0.3; // Keep some original voice clarity

             source.connect(ringMod);
             source.connect(dryNodes);
             
             oscillator.connect(ringMod.gain);
             
             ringMod.connect(destination);
             dryNodes.connect(destination);
        }

        const newStream = destination.stream;
        // Preserve video tracks
        stream.getVideoTracks().forEach(track => newStream.addTrack(track));
        
        processedStreamRef.current = newStream;
        setFilterType(type);
        return newStream;

    } catch (e) {
        console.error("Audio processing failed", e);
        return stream;
    }
  }, [cleanup]);

  return {
    voiceFilter: filterType,
    processStream,
    cleanupAudio: cleanup
  };
};
