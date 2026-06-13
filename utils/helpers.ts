
import CryptoJS from 'crypto-js';

/**
 * Derives a secure 256-bit key from the PIN and Room Key (Salt).
 * Uses PBKDF2 to prevent rainbow table attacks.
 */
// PBKDF2 is intentionally CPU-heavy; the derived key is identical for a given
// (pin, roomKey) so we derive it ONCE and cache it. Without this, every message
// encrypt/decrypt re-ran PBKDF2 on the main thread (a multi-hundred-ms freeze
// when decrypting a full history).
const keyCache = new Map<string, CryptoJS.lib.WordArray>();

const deriveKey = (pin: string, roomKey: string) => {
    // We combine PIN and RoomKey to ensure the same PIN in different rooms creates different keys.
    const cacheKey = `${roomKey}::${pin}`;
    let key = keyCache.get(cacheKey);
    if (!key) {
        key = CryptoJS.PBKDF2(pin, roomKey, {
            keySize: 256 / 32,
            iterations: 1000
        });
        keyCache.set(cacheKey, key);
    }
    return key;
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
    // Never silently fall back to storing plaintext — fail the send instead so
    // the caller can surface it and the message is never written unencrypted.
    console.error("Encryption error", e);
    throw new Error("Message encryption failed");
  }
}

/**
 * Decrypts a message using AES-256.
 * Handles legacy Base64 messages gracefully.
 */
export function decryptMessage(encryptedStr: string, pin: string, roomKey: string): string {
  try {
    if (!encryptedStr) return '';

    // Only treat the string as "IV:Ciphertext" when it actually starts with a
    // 32-hex-char IV prefix (matching the strict gate used for reply quotes).
    // A bare `.includes(':')` misrouted legacy plaintext that merely contains a
    // colon — e.g. "see you at 10:30" — into the AES path, which then failed and
    // rendered as the wrong-PIN placeholder.
    if (/^[0-9a-f]{32}:/i.test(encryptedStr)) {
        const idx = encryptedStr.indexOf(':');
        const iv = CryptoJS.enc.Hex.parse(encryptedStr.slice(0, idx));
        const ciphertext = encryptedStr.slice(idx + 1);
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

// Room name / PIN rules — the SINGLE source of truth shared by the dashboard's
// create form and the login screen. They used to differ (login only allowed
// [A-Za-z0-9_], so a room created with a space or hyphen — including the
// "Quick chat" presets — could never be joined from the login screen). Allow
// letters, numbers, spaces, hyphens and underscores in names.
export const ROOM_NAME_RE = /^[A-Za-z0-9 _-]{3,30}$/;
export const ROOM_PIN_RE = /^[A-Za-z0-9_]{4,12}$/;
export const ROOM_NAME_RULE = 'Room name must be 3–30 characters: letters, numbers, spaces, - or _.';
export const ROOM_PIN_RULE = 'PIN must be 4–12 characters: letters, numbers or underscore.';

// Smooth dark<->light switch: add a short-lived class to <html> so colors
// cross-fade (the `.theme-anim` rule in index.css), then drop it so there's no
// always-on transition cost. Call this RIGHT BEFORE flipping the theme (toggling
// the `dark` class / setting the theme state) so the class is present when the
// color change paints. Honors prefers-reduced-motion (handled in CSS).
export function beginThemeTransition(ms = 450): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.add('theme-anim');
  window.setTimeout(() => root.classList.remove('theme-anim'), ms);
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

// Avatars from signal payloads are attacker-influenceable; only allow https URLs
// (block javascript:/data:/http: tracking-or-mixed-content), else a neutral inline avatar.
const FALLBACK_AVATAR = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="%23334155"/><circle cx="48" cy="38" r="18" fill="%2364748b"/><rect x="20" y="64" width="56" height="34" rx="17" fill="%2364748b"/></svg>';
export function safeAvatarUrl(url: string | undefined | null): string {
  return url && /^https:\/\//i.test(url) ? url : FALLBACK_AVATAR;
}

// Strip trailing punctuation that the greedy URL regex (matches up to
// whitespace) sucks in — e.g. "see https://example.com." → "https://example.com".
// Used for link previews, the rendered anchor, and the room "Links" gallery so a
// sentence-final URL isn't broken.
export function cleanUrl(url: string): string {
  // Strip sentence-final punctuation, but NOT ')' yet — many real URLs end in a
  // closing paren (e.g. /wiki/Pin_(disambiguation)).
  let u = url.replace(/[.,!?;:'"\]}>]+$/, '');
  // Only strip a trailing ')' when it's unbalanced (no matching '(' in the URL),
  // which is the sentence-wrapping case "(see https://x.com)".
  while (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) {
    u = u.slice(0, -1);
    u = u.replace(/[.,!?;:'"\]}>]+$/, '');
  }
  return u;
}

// True only where the page can INITIATE a screen share. iOS Safari / iOS PWA
// (WebKit) do not implement getDisplayMedia at all, so this is false there —
// the UI uses it to show an explanatory toast instead of a broken button.
export function getDisplayMediaSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

// User-facing message for a getDisplayMedia failure, or null when the user
// simply dismissed the picker (NotAllowedError/AbortError) — a deliberate
// cancel that should show nothing.
export function displayMediaErrorMessage(err: unknown): string | null {
  const name = (err as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'AbortError') return null;
  if (name === 'NotReadableError')
    return 'Could not capture the screen — it may be in use by another app.';
  return 'Could not start screen sharing on this device.';
}

// Extract a YouTube video id. Anchored to the youtube.com / youtu.be HOST and a
// strict 11-char id charset: the old loose regex matched a bare "v/" or "&v="
// anywhere, so any URL like https://files.example.com/v/abcdefghijk was treated
// as YouTube — mounting a broken embed AND making the real link disappear (and a
// member could spoof which video renders for an arbitrary domain).
export function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  return m ? m[1] : null;
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
                // JPEG has no alpha: paint a white background first so transparent
                // PNG/WebP pixels don't flatten to BLACK (avatars, stickers, logos,
                // room backgrounds all go through here).
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
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
