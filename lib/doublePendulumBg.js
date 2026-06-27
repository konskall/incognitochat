/*
 * double-pendulum-bg.prod.js — animated double-pendulum (deterministic chaos) background.
 * ZERO dependencies. Pure Canvas2D. Same production architecture as helical-drift-bg.prod.js.
 *
 * Physics: 4th-order Runge–Kutta on the exact double-pendulum equations of motion,
 * stepped in fixed sub-frames (energy-faithful, frame-rate independent).
 * Render: glowing tip TRAILS on a near-black field that fade like a long exposure;
 * optional rods/bobs on a separate cleared layer.
 *
 * Performance / UX baked in:
 *   • Pauses when the host scrolls off-screen (IntersectionObserver) or the tab hides
 *   • Respects prefers-reduced-motion (one static frame, no loop)
 *   • Caps devicePixelRatio (maxDPR); fps throttle; fully responsive
 *   • Seeded initial conditions — same seed → same unfolding. reseed() for a new start.
 *
 * ESM module (default export). Originally shipped as a `window.DoublePendulumBG`
 * global; vendored here unchanged except the wrapper so Vite bundles it as a
 * module. Types live in doublePendulumBg.d.ts.
 *
 * Usage (React):
 *   import DoublePendulumBG from '../lib/doublePendulumBg';
 *   useEffect(() => {
 *     const dp = new DoublePendulumBG(host, { count: 6, palette: ['#6ad7ff','#5b8cff','#b07bff'] });
 *     return () => dp.destroy();
 *   }, []);
 */
const DoublePendulumBG = (function (global) {
  'use strict';

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function samplePalette(pal, t) {
    var n = pal.length;
    if (n === 1) return hexToRgb(pal[0]);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var x = t * (n - 1), i = Math.min(n - 2, Math.floor(x)), f = x - i;
    var a = hexToRgb(pal[i]), b = hexToRgb(pal[i + 1]);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var DEFAULTS = {
    count: 5,                 // number of pendulums
    spread: 0.04,             // radians spread of initial angle across the set (tiny → long-coherent chaos fan)
    startAngle1: 2.2, startAngle2: 2.4, // initial θ1, θ2 (rad). Large ⇒ chaotic.
    l1: 1.0, l2: 1.0, m1: 1.0, m2: 1.0, g: 9.8, // physics (lengths in units; scaled to px)
    reach: 0.42,              // (l1+l2) as a fraction of min(w,h)/... pendulum size on screen
    simSpeed: 1.0,            // time scale
    fade: 0.045,              // trail decay per frame (smaller = longer trails)
    lineWidth: 1.6,
    showRods: false,          // draw the arms + bobs on a cleared overlay
    colorMode: 'index',       // 'index' | 'velocity' | 'mono'
    palette: ['#6ad7ff', '#5b8cff', '#b07bff'],
    rodColor: 'rgba(255,255,255,0.8)',
    bg: '#05060a',
    glow: true,               // additive blending for blooming trails
    opacity: 1.0,
    seed: 12345,
    fps: 60, maxDPR: 1.5, pauseOffscreen: true, respectReducedMotion: true
  };

  // ── exact double-pendulum derivatives: state [th1, th2, w1, w2] ──
  function deriv(th1, th2, w1, w2, P) {
    var m1 = P.m1, m2 = P.m2, l1 = P.l1, l2 = P.l2, g = P.g;
    var d = th1 - th2, cd = Math.cos(d), sd = Math.sin(d);
    var den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
    var a1 = (-g * (2 * m1 + m2) * Math.sin(th1)
              - m2 * g * Math.sin(th1 - 2 * th2)
              - 2 * sd * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cd)) / (l1 * den);
    var a2 = (2 * sd * (w1 * w1 * l1 * (m1 + m2)
              + g * (m1 + m2) * Math.cos(th1)
              + w2 * w2 * l2 * m2 * cd)) / (l2 * den);
    return [w1, w2, a1, a2];
  }
  function rk4(s, dt, P) {
    var k1 = deriv(s[0], s[1], s[2], s[3], P);
    var k2 = deriv(s[0] + 0.5 * dt * k1[0], s[1] + 0.5 * dt * k1[1], s[2] + 0.5 * dt * k1[2], s[3] + 0.5 * dt * k1[3], P);
    var k3 = deriv(s[0] + 0.5 * dt * k2[0], s[1] + 0.5 * dt * k2[1], s[2] + 0.5 * dt * k2[2], s[3] + 0.5 * dt * k2[3], P);
    var k4 = deriv(s[0] + dt * k3[0], s[1] + dt * k3[1], s[2] + dt * k3[2], s[3] + dt * k3[3], P);
    s[0] += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    s[1] += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    s[2] += dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    s[3] += dt / 6 * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);
  }

  function DoublePendulumBG(target, opts) {
    this.target = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.target) throw new Error('DoublePendulumBG: target not found');
    this.O = Object.assign({}, DEFAULTS, opts || {});
    this._raf = null; this._last = 0; this._acc = 0;
    this._onscreen = true; this._visible = !document.hidden;
    this._reduced = this.O.respectReducedMotion && global.matchMedia
      ? global.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    this._frame = this._frame.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._mount();
  }

  var DT = 0.005; // fixed physics sub-step (seconds-ish)

  DoublePendulumBG.prototype._mount = function () {
    var O = this.O;
    if (getComputedStyle(this.target).position === 'static') this.target.style.position = 'relative';

    var wrap = document.createElement('div');
    wrap.className = 'dpbg-layer';
    wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;';
    wrap.style.opacity = O.opacity;
    this.target.appendChild(wrap);
    this.wrap = wrap;

    this.trail = document.createElement('canvas');           // persistent, fading
    this.trail.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    wrap.appendChild(this.trail);
    this.tctx = this.trail.getContext('2d');

    if (O.showRods) {
      this.rods = document.createElement('canvas');          // cleared each frame
      this.rods.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
      wrap.appendChild(this.rods);
      this.rctx = this.rods.getContext('2d');
    }

    this._build();      // size + seed + clear
    this._renderRods(); // one frame of rods (if any) so a paused/reduced state still shows them
    if (this._reduced) this._prerollStatic(); // reduced-motion: paint a still chaos snapshot instead of a blank field

    this._setupObservers();
    if (!this._reduced) this._sync();
  };

  // Build a static trail snapshot (for prefers-reduced-motion): run the sim forward
  // synchronously once and leave the accumulated trails on screen, without animating.
  DoublePendulumBG.prototype._prerollStatic = function () {
    for (var k = 0; k < 360; k++) { this._step(1 / 60); this._renderTrails(); }
    this._renderRods();
  };

  DoublePendulumBG.prototype._W = function () { return Math.max(1, this.wrap.clientWidth); };
  DoublePendulumBG.prototype._H = function () { return Math.max(1, this.wrap.clientHeight); };

  DoublePendulumBG.prototype._sizeCanvas = function (cv) {
    var w = this._W(), h = this._H(), dpr = Math.min(this.O.maxDPR, global.devicePixelRatio || 1);
    this._w = w; this._h = h; this._dpr = dpr;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  DoublePendulumBG.prototype._build = function () {
    var O = this.O;
    this._sizeCanvas(this.trail);
    if (this.rods) this._sizeCanvas(this.rods);

    this.cx = this._w / 2; this.cy = this._h / 2;
    this.scale = (O.reach * Math.min(this._w, this._h)) / (O.l1 + O.l2); // units → px

    var rng = mulberry32(O.seed);
    this.states = [];
    this.prev = [];   // previous tip pixel position per pendulum
    for (var i = 0; i < O.count; i++) {
      var off = O.count > 1 ? (i / (O.count - 1) - 0.5) * O.spread : 0;
      var jitter = (rng() - 0.5) * O.spread * 0.15;
      this.states.push([O.startAngle1 + off + jitter, O.startAngle2 + off, 0, 0]);
      this.prev.push(null);
    }

    // clear trail to bg
    this.tctx.globalCompositeOperation = 'source-over';
    this.tctx.globalAlpha = 1;
    this.tctx.fillStyle = O.bg;
    this.tctx.fillRect(0, 0, this._w, this._h);
  };

  DoublePendulumBG.prototype._tip = function (s) {
    var O = this.O, sc = this.scale;
    var x1 = this.cx + sc * O.l1 * Math.sin(s[0]);
    var y1 = this.cy + sc * O.l1 * Math.cos(s[0]);
    var x2 = x1 + sc * O.l2 * Math.sin(s[1]);
    var y2 = y1 + sc * O.l2 * Math.cos(s[1]);
    return [x1, y1, x2, y2];
  };

  DoublePendulumBG.prototype._colorFor = function (i, s) {
    var O = this.O;
    if (O.colorMode === 'mono') return O.palette[0];
    if (O.colorMode === 'velocity') {
      var v = Math.min(1, (Math.abs(s[2]) + Math.abs(s[3])) / 18); // tip angular speed → 0..1
      var c = samplePalette(O.palette, v);
      return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
    }
    var ci = samplePalette(O.palette, O.count > 1 ? i / (O.count - 1) : 0.5);
    return 'rgb(' + (ci[0] | 0) + ',' + (ci[1] | 0) + ',' + (ci[2] | 0) + ')';
  };

  DoublePendulumBG.prototype._step = function (seconds) {
    var O = this.O;
    this._acc += Math.min(seconds, 0.05) * O.simSpeed;
    var steps = 0;
    while (this._acc >= DT && steps < 400) { // cap to avoid spiral of death
      for (var i = 0; i < this.states.length; i++) rk4(this.states[i], DT, O);
      this._acc -= DT; steps++;
    }
  };

  DoublePendulumBG.prototype._renderTrails = function () {
    var ctx = this.tctx, O = this.O;
    // fade the whole field toward bg
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = O.fade;
    ctx.fillStyle = O.bg;
    ctx.fillRect(0, 0, this._w, this._h);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = O.glow ? 'lighter' : 'source-over';
    ctx.lineWidth = O.lineWidth;
    ctx.lineCap = 'round';
    for (var i = 0; i < this.states.length; i++) {
      var s = this.states[i];
      var t = this._tip(s);
      var p = this.prev[i];
      if (p) {
        ctx.strokeStyle = this._colorFor(i, s);
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(t[2], t[3]);
        ctx.stroke();
      }
      this.prev[i] = [t[2], t[3]];
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  DoublePendulumBG.prototype._renderRods = function () {
    if (!this.rods) return;
    var ctx = this.rctx, O = this.O;
    ctx.clearRect(0, 0, this._w, this._h);
    ctx.globalCompositeOperation = O.glow ? 'lighter' : 'source-over';
    ctx.lineWidth = Math.max(2, O.lineWidth + 1);
    ctx.lineCap = 'round';
    for (var i = 0; i < this.states.length; i++) {
      var t = this._tip(this.states[i]);
      ctx.strokeStyle = O.rodColor;
      ctx.beginPath();
      ctx.moveTo(this.cx, this.cy); ctx.lineTo(t[0], t[1]); ctx.lineTo(t[2], t[3]);
      ctx.stroke();
      ctx.fillStyle = O.rodColor;
      ctx.beginPath(); ctx.arc(t[0], t[1], O.lineWidth + 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(t[2], t[3], O.lineWidth + 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  DoublePendulumBG.prototype._frame = function (now) {
    this._raf = global.requestAnimationFrame(this._frame);
    var interval = 1000 / this.O.fps;
    var elapsed = now - this._last;
    if (elapsed < interval) return;
    this._last = now - (elapsed % interval);
    this._step(elapsed / 1000);
    this._renderTrails();
    this._renderRods();
  };

  DoublePendulumBG.prototype._shouldRun = function () {
    return !this._reduced && this._visible && (this._onscreen || !this.O.pauseOffscreen);
  };
  DoublePendulumBG.prototype._start = function () {
    if (this._raf || !this._shouldRun()) return;
    this._last = global.performance.now(); this._acc = 0;
    this._raf = global.requestAnimationFrame(this._frame);
  };
  DoublePendulumBG.prototype._stop = function () {
    if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = null; }
  };
  DoublePendulumBG.prototype._sync = function () { if (this._shouldRun()) this._start(); else this._stop(); };

  DoublePendulumBG.prototype._setupObservers = function () {
    var self = this;
    if (typeof ResizeObserver !== 'undefined') {
      this._raf2 = null;
      this._ro = new ResizeObserver(function () {
        if (self._raf2) cancelAnimationFrame(self._raf2);
        self._raf2 = requestAnimationFrame(self._onResize);
      });
      this._ro.observe(this.wrap);
    }
    if (this.O.pauseOffscreen && typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver(function (e) { self._onscreen = e[0].isIntersecting; self._sync(); }, { threshold: 0 });
      this._io.observe(this.target);
    }
    document.addEventListener('visibilitychange', this._onVisibility);
  };

  DoublePendulumBG.prototype._onResize = function () {
    var running = !!this._raf;
    this._build();        // resize resets the trail (clean)
    this._renderRods();
    if (this._reduced) this._prerollStatic();
    else if (running) this._sync();
  };
  DoublePendulumBG.prototype._onVisibility = function () { this._visible = !document.hidden; this._sync(); };

  DoublePendulumBG.prototype.reseed = function () {
    this.O.seed = (this.O.seed * 1664525 + 1013904223) >>> 0; // next deterministic seed
    this._build(); this._renderRods();
    if (!this._raf && !this._reduced) this._sync();
  };

  DoublePendulumBG.prototype.update = function (opts) {
    var keys = Object.keys(opts || {});
    Object.assign(this.O, opts || {});
    this.wrap.style.opacity = this.O.opacity;
    var REBUILD = ['count', 'spread', 'startAngle1', 'startAngle2', 'l1', 'l2', 'reach', 'seed', 'maxDPR', 'bg'];
    if (keys.some(function (k) { return REBUILD.indexOf(k) !== -1; })) { this._build(); this._renderRods(); }
  };

  DoublePendulumBG.prototype.isRunning = function () { return !!this._raf; };
  DoublePendulumBG.prototype.getStatus = function () {
    return this._reduced ? 'reduced-motion' : (this._raf ? 'running' : (this._onscreen ? 'paused' : 'paused (off-screen)'));
  };

  DoublePendulumBG.prototype.destroy = function () {
    this._stop();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._io) { this._io.disconnect(); this._io = null; }
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.wrap && this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
  };

  return DoublePendulumBG;
})(window);

export default DoublePendulumBG;
