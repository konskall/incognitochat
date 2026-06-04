
import { useState, useRef, useEffect } from 'react';

// Hard cap so a forgotten recording can't grow unbounded (and blow the 40MB
// upload limit). 5 minutes is plenty for a voice message.
const MAX_RECORDING_SECONDS = 300;

export const useAudioRecorder = (onRecordingComplete: (blob: Blob, mimeType: string) => void) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>('');

  const clearTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // Always release the microphone tracks + timer (called from onstop, cancel, unmount).
  const releaseStream = () => {
    clearTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const types = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];
      const supported = types.find((type) => MediaRecorder.isTypeSupported(type));

      // Only pass an explicit mimeType if one is actually supported. iOS Safari
      // throws NotSupportedError if you force e.g. 'audio/webm', so when nothing
      // matches we let the browser choose its own default container.
      const mediaRecorder = supported
        ? new MediaRecorder(stream, { mimeType: supported })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      // Use the recorder's actual mimeType (most reliable for the file extension).
      mimeTypeRef.current = mediaRecorder.mimeType || supported || 'audio/mp4';
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const type = mediaRecorderRef.current?.mimeType || mimeTypeRef.current;
        const audioBlob = new Blob(audioChunksRef.current, { type });
        onRecordingComplete(audioBlob, type);
        releaseStream();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      let seconds = 0;
      recordingTimerRef.current = setInterval(() => {
        seconds += 1;
        setRecordingDuration(seconds);
        if (seconds >= MAX_RECORDING_SECONDS) {
          // Auto-stop at the cap (onstop fires -> completes + releases stream).
          const mr = mediaRecorderRef.current;
          if (mr && mr.state === 'recording') mr.stop();
          setIsRecording(false);
          clearTimer();
        }
      }, 1000);
    } catch (e) {
      console.error('Microphone error', e);
      alert('Could not access microphone.');
      releaseStream();
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    // Gate on the recorder's real state, not the (possibly stale) isRecording.
    if (mr && mr.state === 'recording') {
      mr.stop(); // triggers onstop -> onRecordingComplete + releaseStream
    } else {
      releaseStream();
    }
    setIsRecording(false);
    clearTimer();
  };

  const cancelRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr) {
      mr.onstop = null; // prevent the completion callback
      if (mr.state === 'recording') {
        try { mr.stop(); } catch { /* ignore */ }
      }
    }
    setIsRecording(false);
    releaseStream();
  };

  // Safety net: if the component unmounts mid-recording (e.g. user leaves the
  // room), stop the recorder and release the microphone + timer.
  useEffect(() => {
    return () => {
      const mr = mediaRecorderRef.current;
      if (mr) {
        mr.onstop = null;
        if (mr.state === 'recording') {
          try { mr.stop(); } catch { /* ignore */ }
        }
      }
      releaseStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isRecording,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  };
};
