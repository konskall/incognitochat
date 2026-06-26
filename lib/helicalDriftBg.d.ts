// Hand-written types for the vendored helicalDriftBg.js engine.
// Runtime lives in helicalDriftBg.js; this file is the type source TypeScript
// resolves for `import HelicalDriftBG from '../lib/helicalDriftBg'`.

export interface HelicalDriftBGOptions {
  /** Colour stops sampled across the radius (centre → edge). */
  palette?: string[];
  /** Layer opacity, 0–1. */
  opacity?: number;
  /** Brightness multiplier. */
  intensity?: number;
  /** Spiral coverage scale relative to the host's far corner. */
  scale?: number;
  /** Element (or selector) the vortex centres on; its bounding box also sizes the void. */
  centerEl?: string | Element | null;
  /** Extra px added around centerEl to size the clear void. */
  voidPad?: number;
  /** Void radius as a fraction of the host (used only when centerEl is absent). */
  voidSize?: number;
  /** Point spacing (smaller = denser). */
  spacing?: number;
  maxPoints?: number;
  mobileMaxPoints?: number;
  mobileBreakpoint?: number;
  /** Outer edge fade, 0–1. */
  edgeFeather?: number;
  rotationSpeed?: number;
  swirl?: number;
  shimmer?: number;
  shimmerSpeed?: number;
  ringAmount?: number;
  falloff?: number;
  pointSize?: number;
  /** Use the 'lighter' composite (additive glow); best on dark backgrounds. */
  glow?: boolean;
  /**
   * Explicit canvas globalCompositeOperation, overriding `glow` when set.
   * Use 'lighter' for additive glow on dark backgrounds and 'source-over' for
   * normal painting on light backgrounds. Avoid software blend modes such as
   * 'multiply' — they run on the CPU and collapse the frame rate.
   */
  blend?: string | null;
  seed?: number;
  mask?: 'none' | 'edges' | 'soft' | 'donut';
  fps?: number;
  maxDPR?: number;
  pauseOffscreen?: boolean;
  respectReducedMotion?: boolean;
}

export default class HelicalDriftBG {
  constructor(target: string | Element, opts?: HelicalDriftBGOptions);
  /** Tweak options live; geometry rebuilds only when a geometry key changes. */
  update(opts: HelicalDriftBGOptions): void;
  isRunning(): boolean;
  getStatus(): string;
  /** Stop the loop, disconnect observers/listeners, and remove the canvas layer. Call on unmount. */
  destroy(): void;
}
