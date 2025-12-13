
import CryptoJS from 'crypto-js';

/**
 * Derives a secure 256-bit key from the PIN and Room Key (Salt).
 * Uses PBKDF2 to prevent rainbow table attacks.
 */
const deriveKey = (pin: string, roomKey: string) => {
    // We combine PIN and RoomKey to ensure the same PIN in different rooms creates different keys.
    return CryptoJS.PBKDF2(pin, roomKey, {
        keySize: 256 / 32,
        iterations: 1000
    });
};

/**
 * Encrypts a message using AES-256.
 * Generates a random IV for every message so identical texts look different.
 */
export function encryptMessage(text: string, pin: string, roomKey: string): string {
  try {
    if (!text) return '';
    
    const key = deriveKey(pin, roomKey);
    const iv = CryptoJS.lib.WordArray.random(128 / 8); // 16 bytes random IV
    
    const encrypted = CryptoJS.AES.encrypt(text, key, { 
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });

    // Return format: IV:Ciphertext (both in Hex or Base64)
    // We use Hex for IV and standard string for ciphertext container
    return `${iv.toString()}:${encrypted.toString()}`;
  } catch (e) {
    console.error("Encryption error", e);
    return text; // Fallback (should ideally never happen)
  }
}

/**
 * Decrypts a message using AES-256.
 * Handles legacy Base64 messages gracefully.
 */
export function decryptMessage(encryptedStr: string, pin: string, roomKey: string): string {
  try {
    if (!encryptedStr) return '';

    // Check if it follows our "IV:Ciphertext" format
    if (encryptedStr.includes(':')) {
        const parts = encryptedStr.split(':');
        const iv = CryptoJS.enc.Hex.parse(parts[0]);
        const ciphertext = parts[1];
        const key = deriveKey(pin, roomKey);

        const decrypted = CryptoJS.AES.decrypt(ciphertext, key, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });

        return decrypted.toString(CryptoJS.enc.Utf8);
    } else {
        // Fallback for legacy messages (Old Base64 format)
        // If decryption fails, we assume it's legacy encoding
        try {
             return decodeURIComponent(escape(atob(encryptedStr)));
        } catch {
             return encryptedStr; // Return as-is if all else fails
        }
    }
  } catch (e) {
    // If decryption completely fails (wrong PIN?), return raw string or a placeholder
    console.warn("Decryption failed (wrong PIN?)");
    return "🔒 Encrypted Message (Wrong PIN)"; 
  }
}

// Keep legacy Base64 for backward compatibility if needed internally, but prefer above
export function encodeMessageLegacy(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch (e) {
    return str;
  }
}

export function generateRoomKey(pin: string, roomName: string): string {
  return `${roomName.toLowerCase().trim()}_${pin.trim()}`;
}

// Singleton AudioContext to prevent running out of hardware contexts
let audioCtx: AudioContext | null = null;
let ringNodes: AudioNode[] = []; // Store active ringtone nodes

export function initAudio() {
  try {
    if (!audioCtx) {
       audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(console.error);
    }
    // Play a silent oscillator to fully unlock audio on iOS/Chrome without making noise
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0; // Silence
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.01);
  } catch (e) {
    // Ignore errors if audio is not supported
  }
}

export function playBeep() {
  try {
    if (!audioCtx) {
       initAudio();
    }
    if (!audioCtx) return;
    
    // Resume if suspended (common in browsers preventing autoplay)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(console.error);
    }

    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.value = 600;
    gain.gain.value = 0.17;
    
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.18);
  } catch (e) {
    console.log('Audio not supported or blocked');
  }
}

// Starts a persistent ringtone (phone ringing sound)
export function startRingtone() {
    try {
        if (!audioCtx) initAudio();
        if (!audioCtx) return;
        
        // Ensure context is running (crucial for iOS)
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(console.error);

        stopRingtone(); // Stop any existing ring

        const t = audioCtx.currentTime;
        const gain = audioCtx.createGain();
        // Increased gain for visibility on desktop speakers
        gain.gain.value = 0.5; 
        gain.connect(audioCtx.destination);
        ringNodes.push(gain);

        // Schedule a repeating ring pattern for 45 seconds
        // Pattern: "Drring-Drring" ... pause ...
        for (let i = 0; i < 15; i++) {
            const start = t + (i * 3); // Loop every 3s
            
            // Tone 1 (0.4s)
            createRingOsc(start, 0.4, 600, gain);
            // Tone 2 (0.4s)
            createRingOsc(start + 0.5, 0.4, 500, gain);
        }
    } catch (e) {
        console.error("Ringtone error:", e);
    }
}

function createRingOsc(time: number, duration: number, freq: number, dest: AudioNode) {
    if(!audioCtx) return;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    // Slight modulation for a "phone" feel
    osc.frequency.linearRampToValueAtTime(freq * 0.95, time + duration);
    
    osc.connect(dest);
    osc.start(time);
    osc.stop(time + duration);
    ringNodes.push(osc);
}

export function stopRingtone() {
    ringNodes.forEach(n => {
        try { 
            if (n instanceof OscillatorNode) n.stop();
            n.disconnect(); 
        } catch(e) {}
    });
    ringNodes = [];
}

// Helper to extract YouTube ID
export function getYouTubeId(url: string): string | null {
  // Updated regex to include shorts/
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Helper to compress images
export async function compressImage(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                // Max resolution for standard chat viewing
                const MAX_WIDTH = 1280; 
                const MAX_HEIGHT = 1280;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if(!ctx) {
                    reject(new Error("Canvas context missing"));
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);

                // Compress to JPEG with 0.7 quality which usually gives good results for chat
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error("Compression failed"));
                        return;
                    }
                    const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                        type: 'image/jpeg',
                        lastModified: Date.now(),
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', 0.7);
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
}
