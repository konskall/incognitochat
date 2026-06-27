import HelicalDriftBG from './helicalDriftBg';
import DoublePendulumBG from './doublePendulumBg';

// Registry of animated ("live") wallpapers → their canvas engine.
//
// Each vendored engine self-mounts a `position:absolute; inset:0;
// pointer-events:none; z-index:0` canvas into the host element, over the
// preset's themed CSS backdrop, and manages resize / off-screen + hidden-tab
// pause / reduced-motion / DPR caps itself. A handle exposes destroy() for
// React teardown on unmount or theme/preset change.
//
// Per-theme tuning lives here (not in the components) so ChatScreen stays
// engine-agnostic: it looks up ANIMATED_WALLPAPERS[preset] and mounts it.
//
// To add a new live wallpaper:
//   1. vendor its engine under lib/ (ESM default export, like the two below),
//   2. add a preset with `animated: true` in utils/roomBackgrounds.ts,
//   3. add a factory entry here under the SAME key,
//   4. extend the server gate (enforce_room_tier) to include the new key.
// Selecting any of these is an ULTRA feature (server-enforced); viewing a room
// already set to one is unrestricted, so the factory itself stays tier-agnostic.

export interface LiveWallpaperHandle {
  destroy(): void;
}

type LiveWallpaperFactory = (host: HTMLElement, isDark: boolean) => LiveWallpaperHandle;

export const ANIMATED_WALLPAPERS: Record<string, LiveWallpaperFactory> = {
  // Phyllotactic vortex — calm, ambient swirl. Additive 'lighter' glow on dark;
  // plain 'source-over' on light (a software blend like 'multiply' tanks FPS).
  vortex: (host, isDark) =>
    new HelicalDriftBG(host, {
      rotationSpeed: 0.022,
      mask: 'edges',
      ...(isDark
        ? { palette: ['#eaf2ff', '#3b6ef5', '#1b2b6b'], blend: 'lighter', opacity: 0.5 }
        : { palette: ['#0f1c56', '#2b4ed6', '#8fa9e0'], blend: 'source-over', opacity: 0.55, intensity: 1.05, spacing: 2.8 }),
    }),

  // Double-pendulum (deterministic chaos) — a coherent fan of swings that
  // diverges into long-exposure trails. Dark: additive glowing trails bloom on
  // a near-black field. Light: glow off so dark trails read on white.
  pendulum: (host, isDark) =>
    new DoublePendulumBG(host, {
      count: 6,
      simSpeed: 0.55,    // calm, ambient — it's a backdrop, not the focal point
      reach: 0.34,       // keep the swing centred, not edge-to-edge
      lineWidth: 1.4,
      colorMode: 'velocity',
      ...(isDark
        ? { bg: '#05060a', glow: true, fade: 0.05, opacity: 0.5, palette: ['#6ad7ff', '#5b8cff', '#b07bff'] }
        : { bg: '#f6f8ff', glow: false, fade: 0.07, opacity: 0.45, palette: ['#1e3a8a', '#2b4ed6', '#7c3aed'] }),
    }),
};
