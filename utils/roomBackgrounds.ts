import type { CSSProperties } from 'react';

// Room "wallpaper" presets. Each is theme-aware and pure CSS (no image assets) so
// it loads instantly and reads well in both light and dark. These are the
// selectable looks shown in the Room Appearance editor; the chosen key is stored
// in rooms.background_preset (with background_type = 'preset').
//
// NOTE: keys are persisted on existing rooms — never rename/remove a key, only
// add. The picker groups looks by `category` (Gradients / Patterns / Solid).

export type RoomBgCategory = 'gradient' | 'pattern' | 'solid';

export interface RoomBgPreset {
  key: string;
  name: string;
  category: RoomBgCategory;
  style: (isDark: boolean) => CSSProperties;
}

// Inline-SVG watermark of the Incognito Chat mark (speech bubble + mountain +
// sun), as a tileable data-URI. Color + opacity are baked in so it stays a pure
// single background layer (no asset fetch) and reads in both themes. The mark
// sits in a 96px cell with transparent padding so it tiles with airy spacing.
function logoWatermark(col: string, op: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'>` +
    `<g transform='translate(28 30)' fill='none' stroke='${col}' stroke-width='2.4' stroke-linejoin='round' stroke-linecap='round' opacity='${op}'>` +
    `<path d='M3 3h32a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H17l-7 5v-5H3a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z'/>` +
    `<path d='M7 18l5-6 3 3 5-7 7 11'/>` +
    `<circle cx='30' cy='10' r='2' fill='${col}' stroke='none'/>` +
    `</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export const ROOM_BG_PRESETS: RoomBgPreset[] = [
  // ── Patterns ─────────────────────────────────────────────────────────────
  {
    key: 'dots',
    name: 'Dots',
    category: 'pattern',
    style: (d) => ({
      backgroundColor: d ? '#020617' : '#f8fafc',
      backgroundImage: `radial-gradient(${d ? '#334155' : '#cbd5e1'} 1px, transparent 1px)`,
      backgroundSize: '20px 20px',
    }),
  },
  {
    key: 'noir',
    name: 'Noir',
    category: 'pattern',
    // Fine film-grain dots. Dots are a full 1px (sub-pixel 0.5px vanished on
    // standard-DPI/scaled screens, making it look like flat charcoal) with more
    // contrast and tighter spacing so the texture reads everywhere.
    style: (d) => ({
      backgroundColor: d ? '#0a0a0a' : '#eef1f5',
      backgroundImage: `radial-gradient(${d ? '#3a3a3a' : '#8b97a6'} 1px, transparent 1px)`,
      backgroundSize: '11px 11px',
    }),
  },
  {
    key: 'blueprint',
    name: 'Blueprint',
    category: 'pattern',
    style: (d) => ({
      backgroundColor: d ? '#020617' : '#f8fafc',
      backgroundImage: `linear-gradient(${d ? '#1e293b' : '#cbd5e1'} 1px, transparent 1px), linear-gradient(90deg, ${d ? '#1e293b' : '#cbd5e1'} 1px, transparent 1px)`,
      backgroundSize: '24px 24px',
    }),
  },
  {
    key: 'graph',
    name: 'Graph',
    category: 'pattern',
    style: (d) => ({
      backgroundColor: d ? '#0b1120' : '#fbfdff',
      backgroundImage: `linear-gradient(${d ? '#172033' : '#e2e8f0'} 1px, transparent 1px), linear-gradient(90deg, ${d ? '#172033' : '#e2e8f0'} 1px, transparent 1px)`,
      backgroundSize: '12px 12px',
    }),
  },
  {
    key: 'diagonal',
    name: 'Diagonal',
    category: 'pattern',
    style: (d) => ({
      backgroundColor: d ? '#020617' : '#f8fafc',
      backgroundImage: `repeating-linear-gradient(45deg, ${d ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.10)'} 0, ${d ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.10)'} 1px, transparent 1px, transparent 11px)`,
    }),
  },
  {
    key: 'crosshatch',
    name: 'Crosshatch',
    category: 'pattern',
    style: (d) => {
      const c = d ? 'rgba(148,163,184,0.07)' : 'rgba(100,116,139,0.09)';
      return {
        backgroundColor: d ? '#060b16' : '#f8fafc',
        backgroundImage: `repeating-linear-gradient(45deg, ${c} 0, ${c} 1px, transparent 1px, transparent 12px), repeating-linear-gradient(-45deg, ${c} 0, ${c} 1px, transparent 1px, transparent 12px)`,
      };
    },
  },

  // ── Gradients (mesh) ─────────────────────────────────────────────────────
  {
    key: 'brand',
    name: 'Incognito',
    category: 'gradient',
    // Subtle tiled brand watermark over a soft brand-blue mesh.
    style: (d) => ({
      backgroundColor: d ? '#060b18' : '#f5f8ff',
      backgroundImage: `${logoWatermark(d ? '#bcd2f5' : '#1e3a8a', d ? 0.07 : 0.05)}, ` + (d
        ? 'radial-gradient(at 18% 18%, rgba(37,99,235,0.16), transparent 50%), radial-gradient(at 85% 90%, rgba(56,189,248,0.12), transparent 55%)'
        : 'radial-gradient(at 18% 18%, rgba(59,130,246,0.14), transparent 50%), radial-gradient(at 85% 90%, rgba(96,165,250,0.12), transparent 55%)'),
      backgroundSize: '96px 96px, cover, cover',
      backgroundPosition: 'center, center, center',
      backgroundRepeat: 'repeat, no-repeat, no-repeat',
    }),
  },
  {
    key: 'aurora',
    name: 'Aurora',
    category: 'gradient',
    style: (d) => ({
      backgroundColor: d ? '#020617' : '#f8fafc',
      backgroundImage: d
        ? 'radial-gradient(at 15% 20%, rgba(56,189,248,0.18), transparent 45%), radial-gradient(at 85% 12%, rgba(99,102,241,0.20), transparent 45%), radial-gradient(at 60% 95%, rgba(168,85,247,0.16), transparent 55%)'
        : 'radial-gradient(at 15% 20%, rgba(56,189,248,0.28), transparent 45%), radial-gradient(at 85% 12%, rgba(129,140,248,0.24), transparent 45%), radial-gradient(at 60% 95%, rgba(168,85,247,0.20), transparent 55%)',
    }),
  },
  {
    key: 'ocean',
    name: 'Ocean',
    category: 'gradient',
    style: (d) => ({
      backgroundColor: d ? '#020617' : '#f0f9ff',
      backgroundImage: d
        ? 'radial-gradient(at 20% 25%, rgba(14,165,233,0.20), transparent 50%), radial-gradient(at 82% 28%, rgba(6,182,212,0.18), transparent 50%), radial-gradient(at 50% 100%, rgba(59,130,246,0.16), transparent 55%)'
        : 'radial-gradient(at 20% 25%, rgba(56,189,248,0.30), transparent 50%), radial-gradient(at 82% 28%, rgba(34,211,238,0.26), transparent 50%), radial-gradient(at 50% 100%, rgba(96,165,250,0.24), transparent 55%)',
    }),
  },
  {
    key: 'twilight',
    name: 'Twilight',
    category: 'gradient',
    style: (d) => ({
      backgroundColor: d ? '#0b0820' : '#faf5ff',
      backgroundImage: d
        ? 'radial-gradient(at 15% 15%, rgba(99,102,241,0.22), transparent 50%), radial-gradient(at 85% 25%, rgba(168,85,247,0.20), transparent 50%), radial-gradient(at 50% 95%, rgba(217,70,239,0.16), transparent 55%)'
        : 'radial-gradient(at 15% 15%, rgba(129,140,248,0.28), transparent 50%), radial-gradient(at 85% 25%, rgba(192,132,252,0.26), transparent 50%), radial-gradient(at 50% 95%, rgba(240,171,252,0.22), transparent 55%)',
    }),
  },
  {
    key: 'sunset',
    name: 'Sunset',
    category: 'gradient',
    style: (d) => ({
      backgroundColor: d ? '#0c0a09' : '#fff7ed',
      backgroundImage: d
        ? 'radial-gradient(at 10% 10%, rgba(244,63,94,0.18), transparent 45%), radial-gradient(at 90% 18%, rgba(234,88,12,0.18), transparent 45%), radial-gradient(at 50% 100%, rgba(202,138,4,0.15), transparent 55%)'
        : 'radial-gradient(at 10% 10%, rgba(251,113,133,0.26), transparent 45%), radial-gradient(at 90% 18%, rgba(251,146,60,0.26), transparent 45%), radial-gradient(at 50% 100%, rgba(250,204,21,0.22), transparent 55%)',
    }),
  },
  {
    key: 'ember',
    name: 'Ember',
    category: 'gradient',
    style: (d) => ({
      backgroundColor: d ? '#1a0a0a' : '#fff7ed',
      backgroundImage: d
        ? 'radial-gradient(at 18% 22%, rgba(244,63,94,0.20), transparent 50%), radial-gradient(at 82% 20%, rgba(249,115,22,0.18), transparent 50%), radial-gradient(at 50% 100%, rgba(245,158,11,0.14), transparent 55%)'
        : 'radial-gradient(at 18% 22%, rgba(251,113,133,0.28), transparent 50%), radial-gradient(at 82% 20%, rgba(251,146,60,0.26), transparent 50%), radial-gradient(at 50% 100%, rgba(252,211,77,0.22), transparent 55%)',
    }),
  },
  {
    key: 'mint',
    name: 'Mint',
    category: 'gradient',
    style: (d) => ({
      backgroundColor: d ? '#021410' : '#f0fdfa',
      backgroundImage: d
        ? 'radial-gradient(at 20% 80%, rgba(20,184,166,0.18), transparent 45%), radial-gradient(at 80% 20%, rgba(16,185,129,0.16), transparent 45%)'
        : 'radial-gradient(at 20% 80%, rgba(45,212,191,0.24), transparent 45%), radial-gradient(at 80% 20%, rgba(52,211,153,0.22), transparent 45%)',
    }),
  },
  {
    key: 'forest',
    name: 'Forest',
    category: 'gradient',
    style: (d) => ({
      backgroundColor: d ? '#04140d' : '#f0fdf4',
      backgroundImage: d
        ? 'radial-gradient(at 22% 78%, rgba(16,185,129,0.18), transparent 50%), radial-gradient(at 78% 25%, rgba(34,197,94,0.16), transparent 50%), radial-gradient(at 50% 50%, rgba(132,204,22,0.10), transparent 55%)'
        : 'radial-gradient(at 22% 78%, rgba(52,211,153,0.24), transparent 50%), radial-gradient(at 78% 25%, rgba(74,222,128,0.22), transparent 50%), radial-gradient(at 50% 50%, rgba(190,242,100,0.18), transparent 55%)',
    }),
  },
  {
    key: 'steel',
    name: 'Steel',
    category: 'gradient',
    style: (d) => ({
      backgroundColor: d ? '#0f172a' : '#f1f5f9',
      backgroundImage: d
        ? 'radial-gradient(at 25% 20%, rgba(100,116,139,0.20), transparent 50%), radial-gradient(at 80% 80%, rgba(71,85,105,0.18), transparent 50%)'
        : 'radial-gradient(at 25% 20%, rgba(148,163,184,0.26), transparent 50%), radial-gradient(at 80% 80%, rgba(100,116,139,0.18), transparent 50%)',
    }),
  },

  // ── Solids (minimal, subtle top vignette for depth) ──────────────────────
  {
    key: 'slate',
    name: 'Slate',
    category: 'solid',
    style: (d) => ({
      backgroundColor: d ? '#0f172a' : '#f1f5f9',
      backgroundImage: d
        ? 'radial-gradient(at 50% 0%, rgba(255,255,255,0.05), transparent 60%)'
        : 'radial-gradient(at 50% 0%, rgba(15,23,42,0.04), transparent 60%)',
    }),
  },
  {
    key: 'midnight',
    name: 'Midnight',
    category: 'solid',
    style: (d) => ({
      backgroundColor: d ? '#0a0a23' : '#eef2ff',
      backgroundImage: d
        ? 'radial-gradient(at 50% 0%, rgba(129,140,248,0.10), transparent 60%)'
        : 'radial-gradient(at 50% 0%, rgba(79,70,229,0.06), transparent 60%)',
    }),
  },
  {
    key: 'charcoal',
    name: 'Charcoal',
    category: 'solid',
    style: (d) => ({
      backgroundColor: d ? '#0a0a0a' : '#e5e7eb',
      backgroundImage: d
        ? 'radial-gradient(at 50% 0%, rgba(255,255,255,0.04), transparent 55%)'
        : 'radial-gradient(at 50% 0%, rgba(0,0,0,0.05), transparent 55%)',
    }),
  },
  {
    key: 'paper',
    name: 'Paper',
    category: 'solid',
    style: (d) => ({
      backgroundColor: d ? '#1c1917' : '#fffbeb',
      backgroundImage: d
        ? 'radial-gradient(at 50% 0%, rgba(250,204,21,0.06), transparent 55%)'
        : 'radial-gradient(at 50% 0%, rgba(180,83,9,0.05), transparent 55%)',
    }),
  },
];

export const ROOM_BG_CATEGORIES: { key: RoomBgCategory; label: string }[] = [
  { key: 'gradient', label: 'Gradients' },
  { key: 'pattern', label: 'Patterns' },
  { key: 'solid', label: 'Solid' },
];

// Category of a stored preset key (falls back to gradient for unknown/legacy).
export function presetCategory(key: string | null | undefined): RoomBgCategory {
  return ROOM_BG_PRESETS.find((p) => p.key === key)?.category ?? 'gradient';
}

export interface RoomAppearance {
  type?: string | null;     // 'preset' | 'image'
  preset?: string | null;   // preset key when type === 'preset'
  url?: string | null;      // image URL when type === 'image'
}

// Resolves the background style for the chat area from a room's stored appearance.
export function getRoomBackgroundStyle(appearance: RoomAppearance, isDark: boolean): CSSProperties {
  // Only honor an https image URL (member-controlled room data — block
  // http:// mixed content / non-image schemes), and quote + escape the value
  // so a ')' or quote can't break out of the CSS url(). Falls through to the
  // default preset otherwise.
  if (appearance.type === 'image' && appearance.url && /^https:\/\//i.test(appearance.url)) {
    const safe = appearance.url.replace(/["'()\\\s]/g, encodeURIComponent);
    return {
      backgroundColor: isDark ? '#020617' : '#f8fafc',
      backgroundImage: `url("${safe}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    };
  }
  const preset = ROOM_BG_PRESETS.find((p) => p.key === appearance.preset) ?? ROOM_BG_PRESETS[0];
  return preset.style(isDark);
}

// ── Per-room appearance cache ────────────────────────────────────────────────
// The room's wallpaper lives in the `rooms` row, which only arrives after the
// initRoom network round-trip — so on entry the chat area paints the default
// 'dots' preset for a beat before swapping to the configured look. We mirror the
// last-known appearance per room into localStorage so the NEXT visit can restore
// it synchronously on the first frame (no default flash). The live values from
// initRoom / realtime still override and refresh the cache.
const BG_CACHE_PREFIX = 'roombg_';

export function readCachedAppearance(roomKey: string): RoomAppearance | null {
  if (!roomKey) return null;
  try {
    const raw = localStorage.getItem(BG_CACHE_PREFIX + roomKey);
    if (!raw) return null;
    const a = JSON.parse(raw);
    if (a && typeof a === 'object') {
      return { type: a.type ?? null, preset: a.preset ?? null, url: a.url ?? null };
    }
  } catch { /* corrupt/unavailable storage → fall back to defaults */ }
  return null;
}

export function writeCachedAppearance(roomKey: string, a: RoomAppearance): void {
  if (!roomKey) return;
  try {
    localStorage.setItem(
      BG_CACHE_PREFIX + roomKey,
      JSON.stringify({ type: a.type ?? null, preset: a.preset ?? null, url: a.url ?? null }),
    );
  } catch { /* private mode / quota → caching is best-effort */ }
}
