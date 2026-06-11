# Flexible Call Windows + iPhone Spotlight + Voice Presets — Design Spec

**Date:** 2026-06-11
**Status:** Approved (design)
**Scope:** Make the in-call UI flexible (drag/resize/minimize on desktop, OS-PiP),
add an iPhone-style spotlight layout for 1-on-1 video with a draggable self-view
PiP, add two voice presets + beef up the robot, and verify the reconnecting
indicator. Built on the existing mesh in `hooks/useWebRTC.ts` +
`components/CallManager.tsx`. **The WebRTC/mesh logic is NOT changed** — only the
audio-filter graph (presets) and the presentation layer.

## Decisions (from brainstorming)

1. **Drag / resize / minimize → desktop only.** Phones keep the optimized
   full-screen layout (free-floating windows are clumsy on touch). The draggable
   self-view PiP works on every platform.
2. **1-on-1 video → iPhone spotlight:** the remote peer fills the surface, the
   local camera is a small draggable PiP that snaps to corners. Group + audio
   calls keep the existing equal grid.
3. **Minimize → both:** an in-page floating **bubble** (all platforms) AND a real
   OS-level **Document Picture-in-Picture** pop-out where supported (Chrome/Edge
   desktop); unsupported browsers fall back to the bubble.
4. **Voice presets:** add **Monster** and **Alien**, and make the existing
   **Robot** more robotic. (Helium/Telephone explicitly NOT wanted.)
5. **Reconnecting:** verify + refine. Distinguish first-time "Connecting…" from a
   mid-call "Reconnecting…", and surface it in the spotlight and the bubble too.

## A. Window modes (`components/CallManager.tsx`)

The in-call UI is rendered by a mode-agnostic **call surface** wrapped by a
container chosen by `windowMode`:

- **`full`** (default): today's `fixed inset-0 z-[100]` overlay.
- **`window`** (desktop only): the surface lives inside a floating panel —
  absolutely positioned, **draggable by its top bar**, **resizable from the
  bottom-right corner**, with min size (e.g. 360×280) and clamped to the viewport.
- **`min`**: the surface is hidden; a small draggable **bubble** is shown via a
  portal so the rest of the app (chat, etc.) is usable and the OS can be Alt-Tabbed
  while the call (and any screen share) continues.

Plus an orthogonal **`pip`** flag: the surface (compact variant) is portalled into
a Document-PiP window. Closing the PiP window restores the previous mode.

**Platform gate:** `window`/resize is enabled only on a desktop-class device
(`matchMedia('(min-width: 768px) and (pointer: fine)')`). Phones expose only
full ↔ min (+ they never see the resize handle or the "windowed" button).

**Window-control buttons** (in the top bar): minimize (▾), windowed/full toggle
(⤢, desktop only), pop-out (⧉, only when Document PiP is supported), plus the
existing signal / timer / participant count.

## B. iPhone spotlight (1-on-1 video) + draggable self-view PiP

When `callType === 'video'` and there is exactly **one** remote peer, the surface
renders a **spotlight**: the remote tile fills the area (`object-cover`), and the
local camera renders as a **draggable PiP** (rounded, ~33% width on mobile / fixed
~180×240 on desktop) that:

- starts bottom-right, **snaps to the nearest corner** on release,
- has a small collapse/expand toggle (collapsed = a thin pill),
- stays a normal mirrored selfie; **hidden while screen-sharing** (avatar instead,
  consistent with the hall-of-mirrors fix).

Group calls (≥2 remotes) and audio calls keep the existing **equal grid** (which
already lives inside whatever window mode is active).

## C. Minimized bubble (`components/MinimizedCallBubble.tsx`)

A small portal card (~220×140), draggable (snaps to corners), showing the primary
video (spotlight remote, or the shared screen, or an avatar) + a compact control
row: restore, mute, hangup. Reuses `CallTile` for the video. Tapping the video
area (not a button) restores to the previous window mode.

## D. Document Picture-in-Picture (`utils/documentPip.ts`)

- `docPipSupported()` → `'documentPictureInPicture' in window`.
- `openDocPip({width,height})` → `documentPictureInPicture.requestWindow(...)`,
  then **copy all same-origin stylesheets** into the PiP document (clone
  `cssRules` into `<style>`; for cross-origin sheets append a `<link>` by href) so
  Tailwind classes render. Returns the PiP `Window`.
- CallManager portals the **bubble content** (or a compact surface) into
  `pipWindow.document.body` with `createPortal`; binds `pagehide`/close to restore.
- **Risk/fallback:** if `requestWindow` throws or styles fail, fall back to the
  in-page bubble. (A later, simpler fallback is native single-`<video>` PiP, but
  it loses controls — only used if Document PiP proves unworkable.)

## E. Voice presets (`hooks/useWebRTC.ts`)

`VoiceFilterType = 'normal' | 'deep' | 'robot' | 'monster' | 'alien'`. Cycle order:
normal → deep → robot → monster → alien → normal. All built inside the existing
unified `buildOutgoingAudio` graph (mic → [filter chain] → micGain(mute) → dest,
+ screen audio → dest), so mute (gain) and screen-audio mixing keep working. The
`normal` + no-screen-audio fast path (raw mic track) is unchanged.

Filter chains (Web Audio, no libraries):
- **deep** (unchanged): lowpass 400 Hz + gain 1.5.
- **robot** (beefed up): bandpass focus + **pure ring modulation** with a square
  carrier (~80 Hz, base gain 0 so it's true AM/ring), a short **comb/flanger**
  delay for metallic resonance, and a **waveshaper** (hard-ish clip) for digital
  grit. Distinctly more synthetic than today's mostly-dry version.
- **monster** (new): heavy lowpass (~220 Hz) + **waveshaper growl** (soft
  saturation) + a **low-frequency ring mod (~30 Hz)** sub-harmonic roughness +
  output boost. Deep, rough, scary — clearly different from "deep". *(This is a
  growl effect, not a formant pitch-shifter; a true AudioWorklet pitch-shift can
  be added later if desired.)*
- **alien** (new): **ring mod** with a sine carrier (~140 Hz) + a slow **LFO
  tremolo** (~6 Hz) on the output gain + a light highpass for a thin, metallic,
  otherworldly timbre.

Ring modulation = signal routed through a GainNode whose `.gain` base is **0** and
whose AudioParam is driven by the carrier oscillator (output = signal × carrier).

## F. Reconnecting indicator

`CallTile` already shows a "Reconnecting…" overlay from `peer.state`. Refine:
- `checking`/`new` on a peer that has **never connected** → "Connecting…"; after it
  has been `connected`/`completed` at least once, a drop (`disconnected`/`failed`)
  → "Reconnecting…". Track a per-peer "was connected" flag in the hook
  (`RemotePeer.everConnected`), set in `oniceconnectionstatechange`.
- Show the same overlay in the **spotlight** remote tile and the **bubble**.

## Files touched

- `hooks/useWebRTC.ts` — voice-filter type + cycle + graph (presets); add
  `everConnected` to `RemotePeer` and set it on connect.
- `hooks/useDragResize.ts` (new) — pointer-based drag + corner-resize, mouse+touch,
  viewport-clamped; pure helpers (`clampBox`, `nearestCorner`) unit-tested.
- `components/CallManager.tsx` — window modes, control buttons, spotlight layout,
  wiring; extract a mode-agnostic call surface.
- `components/MinimizedCallBubble.tsx` (new) — the floating bubble.
- `utils/documentPip.ts` (new) — Document PiP open + style copy + support check.
- `utils/helpers.ts` — (maybe) nothing; drag math lives in the hook.

## Out of scope (YAGNI)

- Per-tile independent windows for group calls (the grid lives inside ONE window).
- True formant/PSOLA pitch-shifting (growl approximation for now).
- Saving/restoring window position across calls/sessions.
- Picture-in-picture on the *remote* viewer's screen of a *grid*.
- Active-speaker auto-detection for the spotlight (1-on-1 has a single remote).

## Risks & verification

- **Document PiP + Tailwind:** styles must be copied into the PiP document; React
  portal into a foreign document. Graceful fallback to the bubble on any failure.
- **Voice graph regressions:** test every preset × muted/unmuted × sharing/not (the
  one graph drives all three). Fast path unchanged for normal+no-screen-audio.
- **Drag math:** clamp to viewport; pointer capture; touch vs mouse (Pointer
  Events). Unit-test the pure clamp/snap helpers.
- **Verification:** `tsc` + `npm run build` clean; unit tests for drag helpers +
  existing suite green; **real-device confirmation by the user** (desktop
  drag/resize/minimize/pop-out; iPhone spotlight + self-view PiP + presets) — CI
  has no media.
