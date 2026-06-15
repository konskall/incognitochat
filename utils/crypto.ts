import CryptoJS from 'crypto-js';

// AES-256 message encryption, split out of utils/helpers.ts so that importing the
// crypto-FREE helpers (generateRoomKey, beginThemeTransition) from the marketing
// landing no longer drags crypto-js (~65KB) into the first-paint bundle. Only the
// chat/dashboard chunks import this module.

/**
 * Derives a secure 256-bit key from the PIN and Room Key (Salt).
 * Uses PBKDF2 to prevent rainbow table attacks.
 */
// PBKDF2 is intentionally CPU-heavy; the derived key is identical for a given
// (pin, roomKey) so we derive it ONCE and cache it. Without this, every message
// encrypt/decrypt re-ran PBKDF2 on the main thread (a multi-hundred-ms freeze
// when decrypting a full history).
// Bound the cache: DashboardScreen decrypts a preview for EVERY room AND every
// inbound realtime message, so the Map would otherwise accumulate one resident
// entry per (room, pin) for the whole PWA session. 50 is plenty for active use;
// an evicted entry is simply re-derived on next use (deriveKey is pure).
const KEY_CACHE_MAX = 50;
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
        // Evict the oldest entry once over the cap (Map preserves insertion order).
        if (keyCache.size >= KEY_CACHE_MAX) {
            const oldest = keyCache.keys().next().value;
            if (oldest !== undefined) keyCache.delete(oldest);
        }
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
