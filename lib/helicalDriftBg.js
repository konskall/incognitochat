/*
 * helicalDriftBg.js — production build of the phyllotactic-vortex background.
 * ZERO dependencies (no p5). Pure Canvas2D. ~3 KB gzipped.
 *
 * ESM module (default export). Originally shipped as a `window.HelicalDriftBG`
 * global; vendored here unchanged except the wrapper so Vite bundles it as a
 * module and tree-shaking applies. Types live in helicalDriftBg.d.ts.
 *
 * Performance features baked in:
 *   • Pauses the loop when the host element scrolls off-screen (IntersectionObserver)
 *   • Pauses when the tab is hidden (visibilitychange)
 *   • Respects prefers-reduced-motion (renders one static frame, no loop)
 *   • Caps devicePixelRatio (maxDPR) so retina phones don't render 4–10 MP
 *   • Reduces point count on small viewports (mobileMaxPoints)
 *   • Frame-rate throttle (fps), time-based motion so speed is identical at any fps
 *   • Fully responsive: canvas, spiral centre, void and coverage recompute on resize
 *
 * Usage (React):
 *   import HelicalDriftBG from '../lib/helicalDriftBg';
 *   useEffect(() => {
 *     const bg = new HelicalDriftBG(heroEl, { centerEl: logoEl, opacity: 0.6, rotationSpeed: 0.03 });
 *     return () => bg.destroy();
 *   }, []);
 */
const HelicalDriftBG = (function (global) {
  'use strict';

  var GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // 137.5077°
  var TWO_PI = Math.PI * 2;
  var NB = 72;

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function samplePalette(pal, t) {
    var n = pal.length;
    if (n === 1) return hexToRgb(pal[0]);
    var x = t * (n - 1);
    var i = Math.min(n - 2, Math.floor(x));
    var f = x - i;
    var a = hexToRgb(pal[i]), b = hexToRgb(pal[i + 1]);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  // Deterministic seeded PRNG (replaces p5's randomSeed/random)
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
    palette: ['#eaf2ff', '#3b6ef5', '#1b2b6b'],
    opacity: 0.6, intensity: 1.0, scale: 1.0,
    centerEl: null, voidPad: 2, voidSize: 0.02,
    spacing: 3.0, maxPoints: 30000, mobileMaxPoints: 14000, mobileBreakpoint: 640,
    edgeFeather: 0.30, rotationSpeed: 0.03, swirl: 1.7,
    shimmer: 0.45, shimmerSpeed: 1.4, ringAmount: 0.26, falloff: 0.78,
    pointSize: 1.7, glow: true, seed: 12345, mask: 'edges',
    fps: 30, maxDPR: 1.5, pauseOffscreen: true, respectReducedMotion: true
  };

  var MASKS = {
    none: '',
    edges: 'radial-gradient(circle at {POS}, #000 0%, #000 48%, transparent 88%)',
    soft: 'radial-gradient(circle at {POS}, #000 0%, #000 30%, transparent 70%)',
    donut: 'radial-gradient(circle at {POS}, transparent 0%, #000 22%, #000 55%, transparent 86%)'
  };

  function HelicalDriftBG(target, opts) {
    this.target = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.target) throw new Error('HelicalDriftBG: target element not found');
    this.O = Object.assign({}, DEFAULTS, opts || {});

    this.tAccum = 0; this.frames = 0;
    this._raf = null; this._last = 0;
    this._w = 1; this._h = 1; this._dpr = 1;
    this._onscreen = true;
    this._visible = !document.hidden;
    this._reduced = this.O.respectReducedMotion && global.matchMedia
      ? global.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

    this._frame = this._frame.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._onReducedChange = this._onReducedChange.bind(this);

    this._mount();
  }

  HelicalDriftBG.prototype._mount = function () {
    var O = this.O;
    if (getComputedStyle(this.target).position === 'static') this.target.style.position = 'relative';

    var wrap = document.createElement('div');
    wrap.className = 'hdbg-layer';
    wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;';
    wrap.style.opacity = O.opacity;
    this.target.appendChild(wrap);
    this.wrap = wrap;

    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    wrap.appendChild(canvas);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this._build();
    this._buildLUT();
    this._render();          // paint one frame immediately

    this._setupObservers();
    this._sync();            // start the loop only if it should run
  };

  HelicalDriftBG.prototype._W = function () { return Math.max(1, this.wrap.clientWidth); };
  HelicalDriftBG.prototype._H = function () { return Math.max(1, this.wrap.clientHeight); };

  HelicalDriftBG.prototype._resizeCanvas = function () {
    var w = this._W(), h = this._H();
    var dpr = Math.min(this.O.maxDPR, global.devicePixelRatio || 1);
    this._w = w; this._h = h; this._dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  HelicalDriftBG.prototype._effMaxPoints = function () {
    var O = this.O;
    return Math.min(this._W(), this._H()) <= O.mobileBreakpoint || this._W() <= O.mobileBreakpoint
      ? Math.min(O.maxPoints, O.mobileMaxPoints) : O.maxPoints;
  };

  HelicalDriftBG.prototype._computeGeom = function () {
    var O = this.O, w = this._W(), h = this._H();
    var cx = w / 2, cy = h / 2, voidR;
    var el = O.centerEl ? (typeof O.centerEl === 'string' ? document.querySelector(O.centerEl) : O.centerEl) : null;
    if (el) {
      var er = el.getBoundingClientRect();
      var wr = this.wrap.getBoundingClientRect();
      cx = er.left + er.width / 2 - wr.left;
      cy = er.top + er.height / 2 - wr.top;
      voidR = Math.min(er.width, er.height) / 2 + O.voidPad;
    } else {
      voidR = O.voidSize * (0.97 * Math.min(w, h) / 2);
    }
    var corner = Math.max(
      Math.hypot(cx, cy), Math.hypot(w - cx, cy),
      Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy)
    );
    this.CX = cx; this.CY = cy;
    return { voidR: Math.max(0, voidR), corner: corner };
  };

  HelicalDriftBG.prototype._applyMask = function () {
    var tpl = MASKS[this.O.mask] != null ? MASKS[this.O.mask] : MASKS.edges;
    if (!tpl) { this.wrap.style.webkitMaskImage = 'none'; this.wrap.style.maskImage = 'none'; return; }
    var pos = (this.CX / this._W() * 100).toFixed(1) + '% ' + (this.CY / this._H() * 100).toFixed(1) + '%';
    var m = tpl.replace('{POS}', pos);
    this.wrap.style.webkitMaskImage = m;
    this.wrap.style.maskImage = m;
  };

  HelicalDriftBG.prototype._buildLUT = function () {
    this._lut = [];
    for (var b = 0; b < NB; b++) {
      var c = samplePalette(this.O.palette, b / (NB - 1));
      this._lut.push('rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')');
    }
  };

  HelicalDriftBG.prototype._build = function () {
    this._resizeCanvas();
    var O = this.O;
    var g = this._computeGeom();
    var rng = mulberry32(O.seed);

    var c = O.spacing;
    var targetR = O.scale * g.corner;
    var Ndesired = Math.ceil((targetR / c) * (targetR / c));
    var N = Math.min(this._effMaxPoints(), Math.max(1500, Ndesired));
    this.MAXR = c * Math.sqrt(N);
    this.ringFreq = (8 * Math.PI) / this.MAXR;

    var ang = new Float32Array(N), rad = new Float32Array(N), nrA = new Float32Array(N),
        ph = new Float32Array(N), bd = new Int16Array(N);
    var k = 0;
    for (var i = 0; i < N; i++) {
      var r = c * Math.sqrt(i) + (rng() - 0.5) * c * 0.55;
      if (r < g.voidR) continue;
      var a = i * GOLDEN_ANGLE + (rng() - 0.5) * 0.025;
      var nr = Math.max(0, Math.min(1, r / this.MAXR));
      ang[k] = a; rad[k] = r; nrA[k] = nr; ph[k] = rng() * TWO_PI;
      bd[k] = Math.min(NB - 1, (nr * (NB - 1)) | 0);
      k++;
    }
    this._ang = ang; this._rad = rad; this._nr = nrA; this._phase = ph; this._band = bd; this._count = k;
    this._applyMask();
  };

  HelicalDriftBG.prototype._render = function () {
    var ctx = this.ctx, O = this.O, t = this.tAccum;
    ctx.clearRect(0, 0, this._w, this._h);
    ctx.globalCompositeOperation = O.glow ? 'lighter' : 'source-over';

    var CX = this.CX, CY = this.CY, sz = O.pointSize, half = sz / 2;
    var rotBase = t * O.rotationSpeed, swirl = O.swirl, falloff = O.falloff;
    var ringAmt = O.ringAmount, shim = O.shimmer, shimW = O.shimmerSpeed * 6;
    var ringDrift = t * 0.6, gain = O.intensity, ringFreq = this.ringFreq;
    var feStart = 1 - Math.max(0.02, Math.min(0.9, O.edgeFeather)), feSpan = 1 - feStart;
    var ang = this._ang, rad = this._rad, nrA = this._nr, ph = this._phase, band = this._band, count = this._count, lut = this._lut;
    var lastBand = -1;

    for (var i = 0; i < count; i++) {
      var nr = nrA[i], r = rad[i];
      var a = ang[i] + rotBase * (1 + swirl * (1 - nr));
      var x = CX + r * Math.cos(a), y = CY + r * Math.sin(a);
      var b = (0.12 + 0.95 * Math.pow(1 - nr, falloff));
      b *= 1 + ringAmt * Math.sin(r * ringFreq - ringDrift);
      var tw = 0.5 + 0.5 * Math.sin(t * shimW + ph[i]);
      b *= 1 - shim * (1 - tw);
      if (nr > feStart) {
        var e = 1 - (nr - feStart) / feSpan;
        e = e < 0 ? 0 : e * e * (3 - 2 * e);
        b *= e;
      }
      b *= gain;
      if (b <= 0.004) continue;
      if (b > 1) b = 1;
      var bb = band[i];
      if (bb !== lastBand) { ctx.fillStyle = lut[bb]; lastBand = bb; }
      ctx.globalAlpha = b;
      ctx.fillRect(x - half, y - half, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.frames++;
  };

  HelicalDriftBG.prototype._frame = function (now) {
    this._raf = global.requestAnimationFrame(this._frame);
    var interval = 1000 / this.O.fps;
    var elapsed = now - this._last;
    if (elapsed < interval) return;             // throttle to target fps
    this._last = now - (elapsed % interval);
    this.tAccum += Math.min(elapsed, 100) / 1000; // time-based; clamp to avoid jumps after a pause
    this._render();
  };

  HelicalDriftBG.prototype._shouldRun = function () {
    return !this._reduced && this._visible && (this._onscreen || !this.O.pauseOffscreen);
  };
  HelicalDriftBG.prototype._start = function () {
    if (this._raf || !this._shouldRun()) return;
    this._last = global.performance.now();
    this._raf = global.requestAnimationFrame(this._frame);
  };
  HelicalDriftBG.prototype._stop = function () {
    if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = null; }
  };
  HelicalDriftBG.prototype._sync = function () {
    if (this._shouldRun()) this._start(); else this._stop();
  };

  HelicalDriftBG.prototype._setupObservers = function () {
    var self = this;
    if (typeof ResizeObserver !== 'undefined') {
      this._rafResize = null;
      this._ro = new ResizeObserver(function () {
        if (self._rafResize) cancelAnimationFrame(self._rafResize);
        self._rafResize = requestAnimationFrame(self._onResize);
      });
      this._ro.observe(this.wrap);
    }
    if (this.O.pauseOffscreen && typeof IntersectionObserver !== 'undefined') {
      this._io = new IntersectionObserver(function (entries) {
        self._onscreen = entries[0].isIntersecting;
        self._sync();
      }, { threshold: 0 });
      this._io.observe(this.target);
    }
    document.addEventListener('visibilitychange', this._onVisibility);
    if (global.matchMedia) {
      this._mq = global.matchMedia('(prefers-reduced-motion: reduce)');
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onReducedChange);
      else if (this._mq.addListener) this._mq.addListener(this._onReducedChange);
    }
  };

  HelicalDriftBG.prototype._onResize = function () {
    this._build();
    this._render();          // keep a correct frame even while paused/reduced
  };
  HelicalDriftBG.prototype._onVisibility = function () {
    this._visible = !document.hidden;
    this._sync();
  };
  HelicalDriftBG.prototype._onReducedChange = function (e) {
    this._reduced = e.matches;
    if (this._reduced) { this._stop(); this.tAccum = 0; this._render(); }
    else this._sync();
  };

  HelicalDriftBG.prototype.update = function (opts) {
    var keys = Object.keys(opts || {});
    Object.assign(this.O, opts || {});
    this.wrap.style.opacity = this.O.opacity;
    if (keys.indexOf('palette') !== -1) this._buildLUT();
    var GEOM = ['spacing', 'maxPoints', 'mobileMaxPoints', 'mobileBreakpoint', 'scale', 'voidPad', 'voidSize', 'centerEl', 'seed', 'maxDPR'];
    if (keys.some(function (k) { return GEOM.indexOf(k) !== -1; })) this._build();
    if (!this._raf) this._render(); // reflect changes immediately when paused
  };

  HelicalDriftBG.prototype.isRunning = function () { return !!this._raf; };
  HelicalDriftBG.prototype.getStatus = function () {
    return this._reduced ? 'reduced-motion' : (this._raf ? 'running' : (this._onscreen ? 'paused' : 'paused (off-screen)'));
  };

  HelicalDriftBG.prototype.destroy = function () {
    this._stop();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._io) { this._io.disconnect(); this._io = null; }
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._mq) {
      if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onReducedChange);
      else if (this._mq.removeListener) this._mq.removeListener(this._onReducedChange);
    }
    if (this.wrap && this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
  };

  return HelicalDriftBG;
})(window);

export default HelicalDriftBG;
