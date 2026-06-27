// Hand-written types for the vendored doublePendulumBg.js engine.
// Runtime lives in doublePendulumBg.js; this file is the type source TypeScript
// resolves for `import DoublePendulumBG from '../lib/doublePendulumBg'`.

export interface DoublePendulumBGOptions {
  /** Number of pendulums rendered (a near-identical fan that diverges into chaos). */
  count?: number;
  /** Radians spread of the initial angle across the set (tiny → long-coherent fan). */
  spread?: number;
  /** Initial θ1 (rad). Large ⇒ chaotic. */
  startAngle1?: number;
  /** Initial θ2 (rad). Large ⇒ chaotic. */
  startAngle2?: number;
  l1?: number; l2?: number; m1?: number; m2?: number; g?: number;
  /** Pendulum size on screen: (l1+l2) as a fraction of min(w,h). */
  reach?: number;
  /** Time scale (smaller = calmer). */
  simSpeed?: number;
  /** Trail decay per frame (smaller = longer trails). */
  fade?: number;
  lineWidth?: number;
  /** Draw the arms + bobs on a cleared overlay above the trails. */
  showRods?: boolean;
  /** Trail colour source. */
  colorMode?: 'index' | 'velocity' | 'mono';
  /** Colour stops sampled by colorMode. */
  palette?: string[];
  rodColor?: string;
  /** Field colour the trails fade toward (match the host backdrop). */
  bg?: string;
  /** Additive 'lighter' blending for blooming trails; best on dark backgrounds. */
  glow?: boolean;
  /** Layer opacity, 0–1. */
  opacity?: number;
  /** Seed for the deterministic initial conditions. */
  seed?: number;
  fps?: number;
  maxDPR?: number;
  pauseOffscreen?: boolean;
  respectReducedMotion?: boolean;
}

export default class DoublePendulumBG {
  constructor(target: string | Element, opts?: DoublePendulumBGOptions);
  /** Tweak options live; rebuilds geometry only when a geometry key changes. */
  update(opts: DoublePendulumBGOptions): void;
  /** Advance to the next deterministic seed and restart the unfolding. */
  reseed(): void;
  isRunning(): boolean;
  getStatus(): string;
  /** Stop the loop, disconnect observers/listeners, and remove the canvas layer. Call on unmount. */
  destroy(): void;
}
