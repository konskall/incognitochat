import HelicalDriftBG from './helicalDriftBg';
import DoublePendulumBG from './doublePendulumBg';
import BlackHoleBG from './blackHoleBg';

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

  // Double-pendulum (deterministic chaos) — a dense fan of near-identical swings
  // (tiny spread) that diverges into long-exposure filament trails. Dark in both
  // themes (the config below has no theme branch).
  pendulum: (host) =>
    new DoublePendulumBG(host, {
      count: 300,
      spread: 0.0009,
      showRods: false,
      colorMode: 'index',
      palette: ['#b07bff', '#5b8cff', '#6ad7ff'],
      fade: 0.06,
      lineWidth: 0.8,
      simSpeed: 0.40,
      bg: '#05060a',
    }),

  // Black hole — a particle accretion disk (brushed orbital filaments) wrapping a
  // true-black event horizon, with a photon ring + lensed starfield. The field
  // (bg + stars) fills the window; the disk is the central object. ALWAYS dark
  // (both app themes): a black hole is a space scene, and on a pale field the
  // additive glow vanishes and the #000 horizon washes to grey — so it stays a
  // dark wallpaper regardless of theme (the preset's CSS backdrop is dark too).
  blackhole: (host) =>
    new BlackHoleBG(host, {
      // Small event horizon (shadowRadius 0.052 ≈ 5% of min(w,h)) under a large
      // filament accretion disk (diskOuter 7.5× the horizon) → a small centre,
      // big disk. fps:30 keeps the particle field light for a backdrop.
      bg: '#05060a',
      shadowRadius: 0.052,
      tilt: 0.28,
      diskInner: 1.35,
      diskOuter: 7.5,
      streak: 0.5,
      streakWidth: 0.9,
      diskCount: 3600,
      doppler: 0.8,
      vDisk: true,
      vDiskCount: 2000,
      vDiskScale: 0.44,
      vAspect: 0.26,
      photonRing: true,
      flare: false,
      stars: 170,
      rotationSpeed: 1.0,
      fps: 30,
      palette: ['#ffffff', '#dbe4f5', '#6b7892', '#161b24'],
    }),
};
