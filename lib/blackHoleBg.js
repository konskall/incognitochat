/*
 * black-hole-bg.prod.js — animated black hole rendered as a PARTICLE SYSTEM.
 * ZERO dependencies, pure Canvas2D. Same particle/colour logic as the vortex engine:
 * thousands of seeded glowing dots, additive light, colour by a palette LUT, per-dot shimmer.
 *
 * The particles ARE the black hole:
 *   • Accretion disk = thousands of dots on tilted Keplerian orbits (inner faster), coloured
 *     by temperature (hot white inner → cool red rim), Doppler-beamed, front/back-wrapped
 *     around the event horizon, optionally spiralling inward (accretion).
 *   • Lensed halo + photon ring = dot bands hugging the shadow, brightest top & bottom.
 *   • Starfield = background dots, gravitationally displaced (lensing).
 *   • Jets = dot streams from the poles.
 *   • Event horizon = a void where no dot is allowed — true black.
 *
 * UX/perf: off-screen + hidden-tab pause, prefers-reduced-motion (static frame), DPR cap,
 * fps throttle, responsive, mobile particle-reduction, seeded (same seed → same sky).
 *
 * ESM module (default export). Originally shipped as a `window.BlackHoleBG`
 * global; vendored here unchanged except the wrapper so Vite bundles it as a
 * module. Types live in blackHoleBg.d.ts.
 *
 * Usage (React):
 *   import BlackHoleBG from '../lib/blackHoleBg';
 *   useEffect(() => {
 *     const bh = new BlackHoleBG(host, { diskCount: 4200, palette: [...] });
 *     return () => bh.destroy();
 *   }, []);
 */
const BlackHoleBG = (function (global) {
  'use strict';
  var TAU = Math.PI * 2, NB = 80;

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function samplePalette(pal, t) {
    var n = pal.length; if (n === 1) return hexToRgb(pal[0]);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var x = t * (n - 1), i = Math.min(n - 2, Math.floor(x)), f = x - i;
    var a = hexToRgb(pal[i]), b = hexToRgb(pal[i + 1]);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  var DEFAULTS = {
    bg: '#05060a',
    shadowRadius: 0.085,         // fraction of min(w,h) — small event horizon
    tilt: 0.26,                  // disk vertical squash (0=edge-on, 1=face-on)
    rotationSpeed: 1.0,
    glow: true, opacity: 1.0, seed: 12345,

    // accretion-disk particles
    diskCount: 6000, mobileDiskCount: 2600, mobileBreakpoint: 640,
    diskInner: 1.12, diskOuter: 4.2,
    palette: ['#ffffff', '#dbe4f5', '#6b7892', '#161b24'], // MONOCHROME: bright white inner → faint grey rim
    doppler: 0.85, dopplerAngle: Math.PI, inflow: 0.0,
    dotSize: 1.2, fade: 0.0,     // fade>0 ⇒ trail mode (flowing streamlines)
    streak: 0.42, streakWidth: 0.85, // streak>0 ⇒ draw each particle as a fine ORBITAL FILAMENT arc (radians) instead of a dot — the brushed Gargantua look
    flare: false,                // brilliant bloom at the approaching inner edge (the Doppler flare)

    // vertical (perpendicular) accretion disk — same filament style, from the hole edge outward
    vDisk: true, vDiskCount: 2400, mobileVDiskCount: 1100, vDiskScale: 0.44, // outer radius = vDiskScale × horizontal outer (≈ a bit less than half)
    vAspect: 0.26,               // horizontal squash of the vertical disk (<1 ⇒ a narrow upright disk)
    photonRing: true,

    // background starfield
    stars: 150, lensing: true, lensStrength: 1.0, starColor: '#cdd7ff',

    // polar jets (dot streams)
    jets: false, jetCount: 500, jetLen: 2.4, jetColor: ['#eaf2ff', '#7df9ff', '#16235e'], jetSpeed: 0.5,

    fps: 60, maxDPR: 1.5, pauseOffscreen: true, respectReducedMotion: true
  };

  function BlackHoleBG(target, opts) {
    this.target = typeof target === 'string' ? document.querySelector(target) : target;
    if (!this.target) throw new Error('BlackHoleBG: target not found');
    this.O = Object.assign({}, DEFAULTS, opts || {});
    this._raf = null; this._last = 0; this.t = 0;
    this._onscreen = true; this._visible = !document.hidden;
    this._reduced = this.O.respectReducedMotion && global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    this._frame = this._frame.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._mount();
  }

  BlackHoleBG.prototype._mount = function () {
    var O = this.O;
    if (getComputedStyle(this.target).position === 'static') this.target.style.position = 'relative';
    var wrap = document.createElement('div');
    wrap.className = 'bhbg-layer';
    wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;';
    wrap.style.opacity = O.opacity; this.target.appendChild(wrap); this.wrap = wrap;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    wrap.appendChild(this.canvas); this.ctx = this.canvas.getContext('2d');
    this._build(); this._render();
    this._setupObservers();
    if (!this._reduced) this._sync();
  };

  BlackHoleBG.prototype._W = function () { return Math.max(1, this.wrap.clientWidth); };
  BlackHoleBG.prototype._H = function () { return Math.max(1, this.wrap.clientHeight); };

  BlackHoleBG.prototype._buildLUT = function () {
    this.lut = [];
    for (var b = 0; b < NB; b++) { var c = samplePalette(this.O.palette, b / (NB - 1)); this.lut.push('rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'); }
    var hc = samplePalette(this.O.palette, 0); this.hotStr = 'rgb(' + (hc[0] | 0) + ',' + (hc[1] | 0) + ',' + (hc[2] | 0) + ')';
  };

  BlackHoleBG.prototype._build = function () {
    var O = this.O, w = this._W(), h = this._H();
    var dpr = Math.min(O.maxDPR, global.devicePixelRatio || 1);
    this._w = w; this._h = h; this._dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = w / 2; this.cy = h / 2;
    this.Rs = O.shadowRadius * Math.min(w, h);
    this._buildLUT();

    var rng = mulberry32(O.seed); this._rng = rng;
    var ri = O.diskInner * this.Rs, ro = O.diskOuter * this.Rs;
    this.ri = ri; this.ro = ro;

    var N = (w <= O.mobileBreakpoint) ? Math.min(O.diskCount, O.mobileDiskCount) : O.diskCount;
    this.dr = new Float32Array(N); this.da = new Float32Array(N); this.dw = new Float32Array(N); this.dph = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      this.dr[i] = ri + (ro - ri) * Math.pow(rng(), 1.7);  // inner-biased density
      this.da[i] = rng() * TAU;
      this.dw[i] = 0.55 + rng() * 0.85;
      this.dph[i] = rng() * TAU;
    }
    this.dN = N;

    // vertical accretion disk (perpendicular) — same filaments, from the hole edge out to vDiskScale × horizontal outer
    var VN = O.vDisk ? ((w <= O.mobileBreakpoint) ? Math.min(O.vDiskCount, O.mobileVDiskCount) : O.vDiskCount) : 0;
    this.vri = O.diskInner * this.Rs;
    this.vro = O.vDiskScale * this.ro;
    this.vdr = new Float32Array(VN); this.vda = new Float32Array(VN); this.vdw = new Float32Array(VN); this.vdph = new Float32Array(VN);
    for (var k = 0; k < VN; k++) {
      this.vdr[k] = this.vri + (this.vro - this.vri) * Math.pow(rng(), 1.7);
      this.vda[k] = rng() * TAU; this.vdw[k] = 0.55 + rng() * 0.85; this.vdph[k] = rng() * TAU;
    }
    this.vdN = VN;

    // photon-ring streaks (light racing around the photon sphere)
    var PN = O.photonRing ? Math.max(240, Math.round(this.Rs * 4)) : 0;
    this.pa = new Float32Array(PN); this.pph = new Float32Array(PN);
    for (var q = 0; q < PN; q++) { this.pa[q] = rng() * TAU; this.pph[q] = rng() * TAU; }
    this.pN = PN;

    // jets
    var JN = O.jets ? O.jetCount : 0;
    this.jf = new Float32Array(JN); this.jx = new Float32Array(JN); this.js = new Float32Array(JN); this.jw = new Float32Array(JN);
    for (var j = 0; j < JN; j++) { this.jf[j] = rng(); this.jx[j] = (rng() - 0.5); this.js[j] = rng() < 0.5 ? -1 : 1; this.jw[j] = 0.5 + rng() * 0.8; }
    this.jN = JN;

    // starfield
    var SN = O.stars; this.sx = new Float32Array(SN); this.sy = new Float32Array(SN); this.sb = new Float32Array(SN); this.sph = new Float32Array(SN);
    var sr = mulberry32(O.seed ^ 0x9e3779b9);
    for (var s = 0; s < SN; s++) { this.sx[s] = sr(); this.sy[s] = sr(); this.sb[s] = 0.3 + sr() * 0.7; this.sph[s] = sr() * TAU; }
    this.sN = SN;
  };

  BlackHoleBG.prototype._step = function (dt) {
    var O = this.O, Rs = this.Rs, ro = this.ro, rng = this._rng, rs = O.rotationSpeed;
    // disk orbits (Keplerian, inner faster) + optional inflow
    for (var i = 0; i < this.dN; i++) {
      var r = this.dr[i];
      var omega = (0.6 / Math.pow(r / Rs, 1.5)) * rs;
      this.da[i] += omega * dt;
      if (O.inflow > 0) {
        r -= O.inflow * Rs * dt * (Rs / r);
        if (r <= Rs * 1.07) { r = ro * (0.82 + rng() * 0.18); this.da[i] = rng() * TAU; this.dph[i] = rng() * TAU; }
        this.dr[i] = r;
      }
    }
    // halo + photon ring slow spin
    for (var k = 0; k < this.vdN; k++) {        // vertical disk: same Keplerian orbits + optional inflow
      var vr = this.vdr[k];
      this.vda[k] += (0.6 / Math.pow(vr / Rs, 1.5)) * rs * dt;
      if (O.inflow > 0) { vr -= O.inflow * Rs * dt * (Rs / vr); if (vr <= Rs * 1.07) { vr = this.vro * (0.82 + rng() * 0.18); this.vda[k] = rng() * TAU; } this.vdr[k] = vr; }
    }
    for (var q = 0; q < this.pN; q++) this.pa[q] += (1.5 * rs) * dt; // photon sphere: light races fastest
    // jets
    for (var j = 0; j < this.jN; j++) { this.jf[j] += O.jetSpeed * dt; if (this.jf[j] > 1) { this.jf[j] -= 1; this.jx[j] = (rng() - 0.5); } }
  };

  BlackHoleBG.prototype._render = function () {
    var ctx = this.ctx, O = this.O, t = this.t, cx = this.cx, cy = this.cy, Rs = this.Rs, tilt = O.tilt;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    if (O.fade > 0) {                                  // trail mode → flowing streamlines
      ctx.fillStyle = O.bg; ctx.globalAlpha = O.fade; ctx.fillRect(0, 0, this._w, this._h); ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = O.bg; ctx.fillRect(0, 0, this._w, this._h);
      var neb = ctx.createRadialGradient(cx, cy, Rs, cx, cy, Math.max(this._w, this._h) * 0.7);
      neb.addColorStop(0, 'rgba(28,30,44,0.14)'); neb.addColorStop(1, 'rgba(5,6,10,0)');
      ctx.fillStyle = neb; ctx.fillRect(0, 0, this._w, this._h);
    }

    var add = O.glow ? 'lighter' : 'source-over';
    if (this.sN && O.fade <= 0) this._drawStars(t);   // stars only in stipple mode (would smear under trails)

    this._drawDisk(t, false);                 // horizontal disk — back half (behind shadow)
    if (O.vDisk) this._drawVDisk(t, false);   // vertical disk — back half

    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, Rs, 0, TAU); ctx.fill();

    if (O.vDisk) this._drawVDisk(t, true);    // vertical disk — front half (would spill over the shadow)

    // re-cover the shadow so the VERTICAL disk never shows inside the hole
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(cx, cy, Rs, 0, TAU); ctx.fill();

    this._drawDisk(t, true);                  // horizontal disk — front half: passes IN FRONT, covering the hole
    if (O.flare) this._drawFlare(t);
    if (O.photonRing) this._drawHalo(t);      // animated photon ring on the rim
    if (this.jN) this._drawJets(t);

    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  // Brilliant white bloom where the approaching inner edge of the disk is Doppler-boosted.
  BlackHoleBG.prototype._drawFlare = function (t) {
    var ctx = this.ctx, O = this.O, cx = this.cx, cy = this.cy, Rs = this.Rs, tilt = O.tilt;
    var a = O.dopplerAngle, r = this.ri * 1.0;
    var fx = cx + r * Math.cos(a), fy = cy + tilt * r * Math.sin(a) + Rs * 0.18;
    var rad = Rs * (1.15 + 0.06 * Math.sin(t * 3));
    var g = ctx.createRadialGradient(fx, fy, 0, fx, fy, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.4)');
    g.addColorStop(0.55, 'rgba(220,230,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1;
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, fy, rad, 0, TAU); ctx.fill();
  };

  BlackHoleBG.prototype._hotRGB = function () { var c = samplePalette(this.O.palette, 0.08); return (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0); };

  BlackHoleBG.prototype._drawDisk = function (t, front) {
    var ctx = this.ctx, O = this.O, cx = this.cx, cy = this.cy, tilt = O.tilt, ri = this.ri, ro = this.ro;
    var dopA = O.dopplerAngle, dop = O.doppler, base = O.dotSize, lut = this.lut;
    var streak = O.streak, half = streak * 0.5;
    ctx.globalCompositeOperation = O.glow ? 'lighter' : 'source-over';
    if (streak > 0) { ctx.lineWidth = O.streakWidth; ctx.lineCap = 'round'; }
    var lastBand = -1;
    for (var i = 0; i < this.dN; i++) {
      var a = this.da[i], sn = Math.sin(a);
      if ((sn > 0) !== front) continue;                 // bottom half = front (nearer viewer)
      var r = this.dr[i];
      var tr = (r - ri) / (ro - ri); if (tr < 0) tr = 0; else if (tr > 1) tr = 1;
      var dopp = 1 + dop * Math.cos(a - dopA); if (dopp < 0.1) dopp = 0.1;
      var tw = 0.74 + 0.26 * Math.sin(t * 2.5 + this.dph[i]);
      var b = (0.14 + 0.86 * Math.pow(1 - tr, 1.35)) * dopp * tw * this.dw[i];
      if (b <= 0.01) continue; if (b > 1) b = 1;
      var bd = (tr * (NB - 1)) | 0;
      if (streak > 0) {
        if (bd !== lastBand) { ctx.strokeStyle = lut[bd]; lastBand = bd; }
        ctx.globalAlpha = b * 0.42;                      // arcs overlap heavily → keep each faint
        var a1 = a - half, a2 = a + half;                // cheap 3-point polyline ≈ orbital arc
        ctx.beginPath();
        ctx.moveTo(cx + r * Math.cos(a1), cy + tilt * r * Math.sin(a1));
        ctx.lineTo(cx + r * Math.cos(a), cy + tilt * r * Math.sin(a));
        ctx.lineTo(cx + r * Math.cos(a2), cy + tilt * r * Math.sin(a2));
        ctx.stroke();
      } else {
        if (bd !== lastBand) { ctx.fillStyle = lut[bd]; lastBand = bd; }
        ctx.globalAlpha = b;
        var x = cx + r * Math.cos(a), y = cy + tilt * r * Math.sin(a);
        var sz = base + (1 - tr) * 1.1;
        ctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  };

  // Vertical (perpendicular) disk — same filament style as the horizontal one, projected upright.
  BlackHoleBG.prototype._drawVDisk = function (t, front) {
    var ctx = this.ctx, O = this.O, cx = this.cx, cy = this.cy, asp = O.vAspect, ri = this.vri, ro = this.vro, lut = this.lut;
    var dopA = O.dopplerAngle, dop = O.doppler, streak = O.streak, half = streak * 0.5;
    ctx.globalCompositeOperation = O.glow ? 'lighter' : 'source-over';
    ctx.lineWidth = O.streakWidth; ctx.lineCap = 'round';
    var lastBand = -1;
    for (var i = 0; i < this.vdN; i++) {
      var a = this.vda[i], sn = Math.sin(a);
      if ((sn > 0) !== front) continue;                  // lower half (nearer viewer) = front
      var r = this.vdr[i];
      var tr = (r - ri) / (ro - ri); if (tr < 0) tr = 0; else if (tr > 1) tr = 1;
      var dopp = 1 + dop * 0.3 * Math.cos(a - dopA); if (dopp < 0.2) dopp = 0.2;
      var tw = 0.74 + 0.26 * Math.sin(t * 2.5 + this.vdph[i]);
      var b = (0.14 + 0.86 * Math.pow(1 - tr, 1.35)) * dopp * tw * this.vdw[i];
      if (b <= 0.01) continue; if (b > 1) b = 1;
      var bd = (tr * (NB - 1)) | 0;
      if (bd !== lastBand) { ctx.strokeStyle = lut[bd]; lastBand = bd; }
      ctx.globalAlpha = b * 0.42;
      var a1 = a - half, a2 = a + half;                   // upright projection: x squashed, y full
      ctx.beginPath();
      ctx.moveTo(cx + asp * r * Math.cos(a1), cy + r * Math.sin(a1));
      ctx.lineTo(cx + asp * r * Math.cos(a), cy + r * Math.sin(a));
      ctx.lineTo(cx + asp * r * Math.cos(a2), cy + r * Math.sin(a2));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  BlackHoleBG.prototype._drawHalo = function (t) {
    var ctx = this.ctx, O = this.O, cx = this.cx, cy = this.cy, Rs = this.Rs, dopA = O.dopplerAngle, dop = O.doppler;
    ctx.globalCompositeOperation = O.glow ? 'lighter' : 'source-over';
    // photon ring: ANIMATED flowing light — bright streaks racing around the photon sphere
    if (O.photonRing) {
      ctx.strokeStyle = this.hotStr;
      // faint continuous base ring + soft glow (keeps the circle whole between streaks)
      ctx.globalAlpha = 0.5; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, Rs * 1.015, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.18; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, Rs * 1.05, 0, TAU); ctx.stroke();
      // racing light: short bright arcs whose brightness travels around the ring
      ctx.lineWidth = 1.7; ctx.lineCap = 'round';
      var rr = Rs * 1.02, hh = 0.085;
      for (var q = 0; q < this.pN; q++) {
        var pa = this.pa[q];
        var dpp = 1 + dop * 0.5 * Math.cos(pa - dopA); if (dpp < 0.2) dpp = 0.2;
        var wave = 0.5 + 0.5 * Math.sin(pa * 3 + t * 5 + this.pph[q]);
        var b = (0.3 + 0.7 * wave * wave) * dpp;
        if (b <= 0.04) continue; if (b > 1) b = 1;
        ctx.globalAlpha = b * 0.5;
        ctx.beginPath();
        ctx.moveTo(cx + rr * Math.cos(pa - hh), cy + rr * Math.sin(pa - hh));
        ctx.lineTo(cx + rr * Math.cos(pa + hh), cy + rr * Math.sin(pa + hh));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };

  BlackHoleBG.prototype._drawStars = function (t) {
    var ctx = this.ctx, O = this.O, cx = this.cx, cy = this.cy, Rs = this.Rs, W = this._w, H = this._h;
    var sc = hexToRgb(O.starColor), lensK = Rs * 2.6 * O.lensStrength;
    ctx.globalCompositeOperation = O.glow ? 'lighter' : 'source-over';
    ctx.fillStyle = 'rgb(' + (sc[0] | 0) + ',' + (sc[1] | 0) + ',' + (sc[2] | 0) + ')';
    for (var i = 0; i < this.sN; i++) {
      var x = this.sx[i] * W, y = this.sy[i] * H;
      if (O.lensing) {
        var dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) + 0.001;
        if (d < Rs * 1.05) continue;
        var disp = (lensK * Rs) / d; x = cx + dx / d * (d + disp); y = cy + dy / d * (d + disp);
      }
      ctx.globalAlpha = this.sb[i] * (0.6 + 0.4 * Math.sin(t * 1.6 + this.sph[i]));
      ctx.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
  };

  BlackHoleBG.prototype._drawJets = function (t) {
    var ctx = this.ctx, O = this.O, cx = this.cx, cy = this.cy, Rs = this.Rs;
    var len = Rs * O.jetLen * 3;
    ctx.globalCompositeOperation = O.glow ? 'lighter' : 'source-over';
    for (var j = 0; j < this.jN; j++) {
      var f = this.jf[j], side = this.js[j];
      var spread = (0.12 + f * 0.9) * Rs;
      var x = cx + this.jx[j] * spread + Math.sin(t * 3 + f * 8 + j) * Rs * 0.05 * f;
      var y = cy + side * (Rs * 0.5 + f * len);
      var col = samplePalette(O.jetColor, f);
      ctx.fillStyle = 'rgb(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ')';
      ctx.globalAlpha = (1 - f) * 0.6 * this.jw[j];
      var sz = 1 + (1 - f) * 1.6;
      ctx.fillRect(x - sz * 0.5, y - sz * 0.5, sz, sz);
    }
    ctx.globalAlpha = 1;
  };

  BlackHoleBG.prototype._frame = function (now) {
    this._raf = global.requestAnimationFrame(this._frame);
    var interval = 1000 / this.O.fps, elapsed = now - this._last;
    if (elapsed < interval) return;
    this._last = now - (elapsed % interval);
    var dt = Math.min(elapsed, 50) / 1000; this.t += dt;
    this._step(dt); this._render();
  };

  BlackHoleBG.prototype._shouldRun = function () { return !this._reduced && this._visible && (this._onscreen || !this.O.pauseOffscreen); };
  BlackHoleBG.prototype._start = function () { if (this._raf || !this._shouldRun()) return; this._last = global.performance.now(); this._raf = global.requestAnimationFrame(this._frame); };
  BlackHoleBG.prototype._stop = function () { if (this._raf) { global.cancelAnimationFrame(this._raf); this._raf = null; } };
  BlackHoleBG.prototype._sync = function () { if (this._shouldRun()) this._start(); else this._stop(); };
  BlackHoleBG.prototype._setupObservers = function () {
    var self = this;
    if (typeof ResizeObserver !== 'undefined') { this._raf2 = null; this._ro = new ResizeObserver(function () { if (self._raf2) cancelAnimationFrame(self._raf2); self._raf2 = requestAnimationFrame(self._onResize); }); this._ro.observe(this.wrap); }
    if (this.O.pauseOffscreen && typeof IntersectionObserver !== 'undefined') { this._io = new IntersectionObserver(function (e) { self._onscreen = e[0].isIntersecting; self._sync(); }, { threshold: 0 }); this._io.observe(this.target); }
    document.addEventListener('visibilitychange', this._onVisibility);
  };
  BlackHoleBG.prototype._onResize = function () { var run = !!this._raf; this._build(); this._render(); if (run && !this._reduced) this._sync(); };
  BlackHoleBG.prototype._onVisibility = function () { this._visible = !document.hidden; this._sync(); };
  BlackHoleBG.prototype.reseed = function () { this.O.seed = (this.O.seed * 1664525 + 1013904223) >>> 0; this._build(); this._render(); if (!this._raf && !this._reduced) this._sync(); };
  BlackHoleBG.prototype.update = function (opts) {
    var keys = Object.keys(opts || {}); Object.assign(this.O, opts || {}); this.wrap.style.opacity = this.O.opacity;
    var REBUILD = ['shadowRadius', 'diskCount', 'mobileDiskCount', 'diskInner', 'diskOuter', 'vDisk', 'vDiskCount', 'vDiskScale', 'photonRing', 'stars', 'jets', 'jetCount', 'seed', 'maxDPR', 'palette'];
    if (keys.some(function (k) { return REBUILD.indexOf(k) !== -1; })) this._build();
    if (!this._raf) this._render();
  };
  BlackHoleBG.prototype.isRunning = function () { return !!this._raf; };
  BlackHoleBG.prototype.getStatus = function () { return this._reduced ? 'reduced-motion' : (this._raf ? 'running' : (this._onscreen ? 'paused' : 'paused (off-screen)')); };
  BlackHoleBG.prototype.destroy = function () {
    this._stop();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._io) { this._io.disconnect(); this._io = null; }
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.wrap && this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
  };

  return BlackHoleBG;
})(window);

export default BlackHoleBG;
