# Screen Sharing (with audio) — Design Spec

**Date:** 2026-06-11
**Status:** Approved (design); pending implementation plan
**Scope:** Add desktop + mobile screen sharing with audio to the existing mesh WebRTC calls.

## Goal

Let a participant in an existing audio or video call share their screen (with its
audio) to everyone else in the room. Built on the current mesh topology in
`hooks/useWebRTC.ts` + `components/CallManager.tsx`.

## Platform reality (drives the whole design)

- **Desktop (Chrome/Edge/Firefox):** full screen share + system/tab audio. ✓
- **Android Chrome/PWA:** screen video ✓; system audio usually unavailable (we
  degrade to mic-only audio automatically).
- **iOS Safari & iOS PWA:** `getDisplayMedia` is **not implemented in WebKit** —
  initiating a web screen share is impossible. iOS users can still **view** a
  screen shared by others (an incoming video track works fine).

So: **initiate** = desktop + Android; **view** = every platform incl. iOS.

## Decisions (from brainstorming)

1. **Unsupported devices (iOS):** show the share button everywhere; pressing it on
   a device without `getDisplayMedia` shows a clear info toast and no-ops. Everyone,
   including iOS, receives/sees others' shares normally.
2. **Camera vs screen:** the screen **replaces** the sharer's outgoing video
   (one tile, via `replaceTrack`). Camera returns when sharing stops. No dual tile.
3. **Call scope:** available in **both audio and video** calls. To avoid
   renegotiation, every call (incl. audio) sets up an always-present video sender.
4. **Audio:** the screen/system audio is **mixed with the mic** through one Web
   Audio graph (talk over the shared content). If there's no screen-audio track
   (e.g. Android), mic-only — no change.
5. **Concurrency:** **multiple simultaneous sharers** allowed. Each replaces only
   their own video; falls out of the replace model with zero coordination.

## Architecture

### A. Always-present video sender (no renegotiation)

The current code attaches all tracks in `createPeer` before the single offer and
never renegotiates (`replaceTrack` is used for camera switch + voice filter). To
let an **audio** call carry a screen video track without renegotiation, each peer
connection must already own a video sender.

- In `createPeer`, after attaching `sendStreamRef` tracks: if there is no outgoing
  video track, call `pc.addTransceiver('video', { direction: 'sendrecv' })` so a
  video m-line + sender exist from the initial offer/answer.
- Both peers run identical code → m-lines are symmetric; no media flows until a
  screen (or camera) track is attached via `replaceTrack`.
- **Cross-cutting effect:** audio calls now negotiate an inactive video m-line. The
  camera is never opened; only SDP gains a (sendrecv, no-track) video section.

### B. Start/stop screen share (`hooks/useWebRTC.ts`)

New state: `isScreenSharing: boolean`. New refs: `screenStreamRef` (the raw
getDisplayMedia stream), `cameraVideoTrackRef` (the camera track set aside during a
video-call share, for restore).

`startScreenShare()`:
1. Feature-detect `navigator.mediaDevices?.getDisplayMedia`. If absent →
   `setNotice({kind:'info', text:'Screen sharing isn't supported on this device (iPhone/iPad). It works on desktop and Android.'})` and return.
2. `const display = await getDisplayMedia({ video: true, audio: true })`.
   - User cancels (NotAllowedError / AbortError) → silent no-op (no error toast).
3. **Video:** for each peer, `videoSender.replaceTrack(display.getVideoTracks()[0])`.
   - Video call: hold the current camera track in `cameraVideoTrackRef` (do not stop it) for restore.
   - Audio call: the video sender previously had no track; now it sends the screen.
4. **Audio:** rebuild the outgoing audio via the unified graph (section C) to include the screen-audio track (if any). `replaceTrack` the new audio track on every peer.
5. **Local view:** set `localStream`'s video to the screen track (no mirror) so the sharer sees what they share.
6. `display.getVideoTracks()[0].onended = () => stopScreenShare()` (handles the browser's native "Stop sharing").
7. Broadcast `screenshare {on:true}` on the `calls:` channel; set `isScreenSharing=true`.

`stopScreenShare()`:
1. Video call: `videoSender.replaceTrack(cameraVideoTrackRef)` to restore the camera; audio call: `videoSender.replaceTrack(null)` (tile reverts to avatar).
2. Stop all `screenStreamRef` tracks; clear refs.
3. Rebuild outgoing audio without screen audio (section C).
4. Restore `localStream` (camera or audio-only).
5. Broadcast `screenshare {on:false}`; set `isScreenSharing=false`.

### C. Unified outgoing-audio graph

Today voice filters build a filtered stream and screen-share would also touch the
outgoing audio — they must not clobber each other, and mute must not kill screen
audio. Introduce one builder that composes everything:

`buildOutgoingAudio()` produces the audio track sent to peers from:
- **mic source** → optional **voice-filter** nodes (existing deep/robot graph) → a **mic gain node** (gain 0 when muted, 1 when live)
- optional **screen-audio source** (when sharing and a screen-audio track exists) → its own gain (always 1)
- both → a single `MediaStreamDestination`; its track is the outgoing audio.

Consequences:
- `cycleVoiceFilter`, `startScreenShare`, `stopScreenShare`, and `toggleMute` all go
  through this one builder / gain, then `replaceTrack` the result on each peer.
- **Mute** sets the mic gain to 0 (screen audio still flows) instead of disabling
  the whole outgoing audio track.
- `normal` filter + not sharing + not muted = pass the raw mic track directly (no
  AudioContext), preserving current lightweight behavior.

### D. Receive-side rendering (`components/CallManager.tsx`)

- A tile shows video **whenever its stream has a live, enabled video track**, instead
  of gating on `callType === 'video'`. So an incoming screen share renders during an
  audio call and on iOS. Applies to remote tiles and the local tile.
- Listen for the `screenshare` broadcast; badge a sharing peer's tile with a monitor
  icon + name (e.g. "🖥 Kostas"). Cosmetic only.
- The local tile shows the screen (no mirror) with a "You · sharing" badge while sharing.

### E. UI (controls bar)

- New toggle button "Share screen" (lucide `MonitorUp` / `MonitorX`) in the in-call
  controls, shown in **both** audio and video calls, active-highlighted like the
  voice-filter button.
- While sharing, hide the switch-camera button (irrelevant).
- Pressing on an unsupported device shows the info toast (section B.1).

### F. Signaling (`types.ts`)

Extend `SignalData` with a `screenshare` event carrying `{ on: boolean }` (sent on
the existing `calls:<roomKey>` broadcast channel). `handleSignal` updates a
`sharingUids` set used by CallManager for the badge. Non-load-bearing (purely
cosmetic); delivery failure never affects media.

## Files touched

- `hooks/useWebRTC.ts` — main: always-present video sender; `startScreenShare`/
  `stopScreenShare`; `isScreenSharing`; unified `buildOutgoingAudio` (mic+filter+
  screen+mute-gain); screen `onended`; `screenshare` broadcast + `sharingUids`;
  cleanup stops screen tracks; export new bits.
- `components/CallManager.tsx` — share toggle button (both call types); unsupported
  toast; show-video-if-track-present; screen badge; local screen tile; hide
  switch-camera while sharing.
- `types.ts` — `SignalData` `screenshare` event + field.
- `utils/helpers.ts` (optional) — a small `getDisplayMedia` support check / error
  message helper, mirroring `mediaErrorMessage`.

## Out of scope (YAGNI)

- Spotlight/pinned-share layout (keep the equal grid).
- One-sharer-at-a-time enforcement.
- Simultaneous camera + screen from one person.
- Recording the shared screen.
- Native iOS broadcast extension (impossible in a PWA).
- Resolution/quality/frame-rate controls.

## Risks & verification

- **Main risk:** the unified audio graph could regress existing voice filters or
  mute. Test all combinations: normal/deep/robot × muted/unmuted × sharing/not.
- **Always-on video m-line** in audio calls: verify existing audio + video calls
  still connect (symmetric code, no media until share).
- **Verification:** `tsc` + `npm run build` clean; Playwright smoke with Chromium
  fake-display flags (`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`,
  `--auto-select-desktop-capture-source=...`) to exercise the toggle + track swap +
  remote receipt. **Full real-device confirmation (desktop + Android, with a second
  participant) by the user** — CI has no real media, same as the original calls
  feature.
