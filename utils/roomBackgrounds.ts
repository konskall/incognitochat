import type { CSSProperties } from 'react';

// Room "wallpaper" presets. Each is theme-aware and pure CSS (no image assets) so
// it loads instantly and reads well in both light and dark. These are the
// selectable looks shown in the Room Appearance editor; the chosen key is stored
// in rooms.background_preset (with background_type = 'preset').

export interface RoomBgPreset {
  key: string;
  name: string;
  style: (isDark: boolean) => CSSProperties;
}

export const ROOM_BG_PRESETS: RoomBgPreset[] = [
  {
    key: 'dots',
    name: 'Dots',
    style: (d) => ({
      backgroundColor: d ? '#020617' : '#f8fafc',
      backgroundImage: `radial-gradient(${d ? '#334155' : '#cbd5e1'} 1px, transparent 1px)`,
      backgroundSize: '20px 20px',
    }),
  },
  {
    key: 'aurora',
    name: 'Aurora',
    style: (d) => ({
      backgroundColor: d ? '#020617' : '#f8fafc',
      backgroundImage: d
        ? 'radial-gradient(at 15% 20%, rgba(56,189,248,0.18), transparent 45%), radial-gradient(at 85% 12%, rgba(99,102,241,0.20), transparent 45%), radial-gradient(at 60% 95%, rgba(168,85,247,0.16), transparent 55%)'
        : 'radial-gradient(at 15% 20%, rgba(56,189,248,0.28), transparent 45%), radial-gradient(at 85% 12%, rgba(129,140,248,0.24), transparent 45%), radial-gradient(at 60% 95%, rgba(168,85,247,0.20), transparent 55%)',
    }),
  },
  {
    key: 'sunset',
    name: 'Sunset',
    style: (d) => ({
      backgroundColor: d ? '#0c0a09' : '#fff7ed',
      backgroundImage: d
        ? 'radial-gradient(at 10% 10%, rgba(244,63,94,0.18), transparent 45%), radial-gradient(at 90% 18%, rgba(234,88,12,0.18), transparent 45%), radial-gradient(at 50% 100%, rgba(202,138,4,0.15), transparent 55%)'
        : 'radial-gradient(at 10% 10%, rgba(251,113,133,0.26), transparent 45%), radial-gradient(at 90% 18%, rgba(251,146,60,0.26), transparent 45%), radial-gradient(at 50% 100%, rgba(250,204,21,0.22), transparent 55%)',
    }),
  },
  {
    key: 'mint',
    name: 'Mint',
    style: (d) => ({
      backgroundColor: d ? '#021410' : '#f0fdfa',
      backgroundImage: d
        ? 'radial-gradient(at 20% 80%, rgba(20,184,166,0.18), transparent 45%), radial-gradient(at 80% 20%, rgba(16,185,129,0.16), transparent 45%)'
        : 'radial-gradient(at 20% 80%, rgba(45,212,191,0.24), transparent 45%), radial-gradient(at 80% 20%, rgba(52,211,153,0.22), transparent 45%)',
    }),
  },
  {
    key: 'blueprint',
    name: 'Blueprint',
    style: (d) => ({
      backgroundColor: d ? '#020617' : '#f8fafc',
      backgroundImage: `linear-gradient(${d ? '#1e293b' : '#cbd5e1'} 1px, transparent 1px), linear-gradient(90deg, ${d ? '#1e293b' : '#cbd5e1'} 1px, transparent 1px)`,
      backgroundSize: '24px 24px',
    }),
  },
  {
    key: 'noir',
    name: 'Noir',
    style: (d) => ({
      backgroundColor: d ? '#0a0a0a' : '#f1f5f9',
      backgroundImage: `radial-gradient(${d ? '#262626' : '#94a3b8'} 0.5px, transparent 0.5px)`,
      backgroundSize: '14px 14px',
    }),
  },
];

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
