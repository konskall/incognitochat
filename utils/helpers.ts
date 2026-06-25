// NOTE: AES message encryption (encryptMessage/decryptMessage) lives in
// utils/crypto.ts so this module stays crypto-js-free — the marketing landing
// imports generateRoomKey / beginThemeTransition from here and must not pull
// crypto-js (~65KB) into the first-paint bundle.

// Keep legacy Base64 for backward compatibility if needed internally, but prefer crypto.ts
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
  if (!url) return FALLBACK_AVATAR;
  // Parse with the WHATWG URL API (same discipline as getYouTubeId / isStripeUrl)
  // rather than a bare /^https:/ prefix test: require the https scheme AND reject
  // embedded credentials (user:pass@host), so a member-set avatar can't smuggle a
  // credentialed URL into an <img src> beacon. Falls back to the neutral inline avatar.
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return FALLBACK_AVATAR;
    return u.href;
  } catch {
    return FALLBACK_AVATAR;
  }
}

// The inco assistant's default avatar (self-hosted in /public). Resolved to an
// ABSOLUTE https URL at runtime so it satisfies the https-only avatar policy
// (safeAvatarUrl + the message-list <img> guard) and works on any deploy origin.
// Guarded for non-browser (test) environments where `window` is undefined.
export const INCO_BOT_AVATAR =
  (typeof window !== 'undefined' ? window.location.origin : '') +
  import.meta.env.BASE_URL + 'inco-avatar.png';

// The Notes room's default avatar (self-hosted in /public), same resolution as
// the get_or_create_notes_room RPC bakes. Used to restore it from the room
// appearance editor. Absolute https at runtime; window-guarded for tests.
export const NOTES_DEFAULT_AVATAR =
  (typeof window !== 'undefined' ? window.location.origin : '') +
  import.meta.env.BASE_URL + 'notes-default.png';

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

// Extract a YouTube video id. Validates the HOST via the WHATWG URL API and an
// explicit allowlist, then reads the id ONLY from that URL's search/pathname —
// so neither a spoofed host (notyoutube.com, evil.com containing the substring
// "youtube.com/watch?v=") nor a youtube.com substring hidden in the path /
// #fragment of an arbitrary domain can mount a fake embed. The old un-anchored
// regex matched any of those, letting a member suppress a real (tracking/
// phishing) link and replace it with an attacker-chosen YouTube embed. Pass a
// single URL string (not free text); non-URL input returns null.
export function getYouTubeId(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const isYouTube = /(^|\.)youtube(-nocookie)?\.com$/.test(host);
  const isShort = /(^|\.)youtu\.be$/.test(host);
  if (!isYouTube && !isShort) return null;
  const ID = /^[A-Za-z0-9_-]{11}$/;
  let id: string | null = null;
  if (isShort) {
    id = u.pathname.slice(1).split('/')[0] || null;               // youtu.be/<id>
  } else {
    const v = u.searchParams.get('v');
    if (v) id = v;                                                // /watch?v=<id>
    else {
      const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([^/?#]+)/); // /embed|/shorts|/v/<id>
      if (m) id = m[1];
    }
  }
  return id && ID.test(id) ? id : null;
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
