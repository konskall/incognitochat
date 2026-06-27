// Hand-written types for the vendored blackHoleBg.js engine.
// Runtime lives in blackHoleBg.js; this file is the type source TypeScript
// resolves for `import BlackHoleBG from '../lib/blackHoleBg'`.

export interface BlackHoleBGOptions {
  /** Field colour behind the particles. */
  bg?: string;
  /** Event-horizon radius as a fraction of min(w,h). */
  shadowRadius?: number;
  /** Disk vertical squash (0 = edge-on, 1 = face-on). */
  tilt?: number;
  rotationSpeed?: number;
  /** Additive 'lighter' blending for blooming particles; best on dark backgrounds. */
  glow?: boolean;
  /** Layer opacity, 0–1. */
  opacity?: number;
  seed?: number;

  // Accretion disk (horizontal)
  diskCount?: number;
  mobileDiskCount?: number;
  mobileBreakpoint?: number;
  /** Inner disk radius as a multiple of the shadow radius. */
  diskInner?: number;
  /** Outer disk radius as a multiple of the shadow radius. */
  diskOuter?: number;
  /** Colour stops sampled across the disk (hot inner → cool rim). */
  palette?: string[];
  doppler?: number;
  dopplerAngle?: number;
  /** Inward spiral rate (0 = stable orbits). */
  inflow?: number;
  dotSize?: number;
  /** >0 ⇒ trail mode (flowing streamlines that fade toward bg). */
  fade?: number;
  /** >0 ⇒ draw each particle as an orbital filament arc (radians) instead of a dot. */
  streak?: number;
  streakWidth?: number;
  /** Brilliant bloom at the Doppler-boosted inner edge. */
  flare?: boolean;

  // Vertical (perpendicular) disk
  vDisk?: boolean;
  vDiskCount?: number;
  mobileVDiskCount?: number;
  /** Outer radius as a fraction of the horizontal outer radius. */
  vDiskScale?: number;
  /** Horizontal squash of the vertical disk (<1 ⇒ narrow upright disk). */
  vAspect?: number;
  photonRing?: boolean;

  // Background starfield
  stars?: number;
  lensing?: boolean;
  lensStrength?: number;
  starColor?: string;

  // Polar jets
  jets?: boolean;
  jetCount?: number;
  jetLen?: number;
  jetColor?: string[];
  jetSpeed?: number;

  fps?: number;
  maxDPR?: number;
  pauseOffscreen?: boolean;
  respectReducedMotion?: boolean;
}

export default class BlackHoleBG {
  constructor(target: string | Element, opts?: BlackHoleBGOptions);
  /** Tweak options live; rebuilds geometry only when a geometry/palette key changes. */
  update(opts: BlackHoleBGOptions): void;
  /** Advance to the next deterministic seed and rebuild. */
  reseed(): void;
  isRunning(): boolean;
  getStatus(): string;
  /** Stop the loop, disconnect observers/listeners, and remove the canvas layer. Call on unmount. */
  destroy(): void;
}
