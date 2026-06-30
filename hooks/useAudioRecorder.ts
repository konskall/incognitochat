
import { useState, useRef, useEffect } from 'react';

// Hard cap so a forgotten recording can't grow unbounded (and blow the 40MB
// upload limit). 5 minutes is plenty for a voice message.
const MAX_RECORDING_SECONDS = 300;

// Live-waveform tuning: how many bars the rolling window holds, how often a new
// bar is pushed (ms), and the gain applied so ordinary speech fills the bars.
const WAVEFORM_BARS = 28;
const WAVEFORM_SAMPLE_MS = 80;
const WAVEFORM_GAIN = 3.2;

// Friendly, specific message for a getUserMedia (microphone) failure — surfaced
// in a modal instead of a raw alert().
function micErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return 'Microphone access is blocked. Allow microphone permission in your browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
    return "No microphone was found on this device, so you can't record a voice message.";
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'Your microphone is already in use by another app. Close it and try again.';
  return "Couldn't access the microphone. Check your device and browser settings, then try again.";
}

export const useAudioRecorder = (onRecordingComplete: (blob: Blob, mimeType: string) => void) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  // Rolling window of recent mic amplitudes (0..1), newest last, for the live
  // recording waveform. Empty when not recording.
  const [levels, setLevels] = useState<number[]>([]);
  // Set when the mic can't be accessed; the UI shows it in a modal (was alert()).
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>('');
  // Web Audio plumbing for the live waveform (best-effort, torn down on stop).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelsRef = useRef<number[]>([]);

  const clearTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // Tear down the Web Audio graph + animation frame driving the live waveform.
  // Safe to call repeatedly; leaves `levels` untouched (callers reset it).
  const stopAnalysis = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    const ctx = audioCtxRef.current;
    if (ctx) {
      ctx.close().catch(() => { /* already closed */ });
      audioCtxRef.current = null;
    }
    levelsRef.current = [];
  };

  // Feed the live mic stream into an AnalyserNode and push a throttled rolling
  // amplitude window to state for the waveform UI. Best-effort: if Web Audio is
  // missing or throws, recording still works — just without bars.
  const startAnalysis = (stream: MediaStream) => {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      // A fresh context can start suspended outside the gesture tick (getUserMedia
      // is async); resume so the analyser actually sees samples.
      ctx.resume().catch(() => { /* best-effort */ });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      levelsRef.current = [];
      setLevels([]);

      const buf = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = (t: number) => {
        const a = analyserRef.current;
        if (!a) return;
        if (t - last >= WAVEFORM_SAMPLE_MS) {
          last = t;
          a.getByteTimeDomainData(buf);
          // RMS deviation from the 128 silence midpoint -> 0..1 loudness.
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const level = Math.min(1, Math.sqrt(sum / buf.length) * WAVEFORM_GAIN);
          const next = [...levelsRef.current, level];
          if (next.length > WAVEFORM_BARS) next.shift();
          levelsRef.current = next;
          setLevels(next);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      stopAnalysis();
    }
  };

  // Always release the microphone tracks + timer (called from onstop, cancel, unmount).
  const releaseStream = () => {
    clearTimer();
    stopAnalysis();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    try {
      setMicError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicError("This browser can't record audio, so voice messages aren't available here.");
        return;
      }
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
      startAnalysis(stream);
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
      setMicError(micErrorMessage(e));
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
    setLevels([]);
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
    setLevels([]);
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
    levels,
    startRecording,
    stopRecording,
    cancelRecording,
    micError,
    dismissMicError: () => setMicError(null),
  };
};
