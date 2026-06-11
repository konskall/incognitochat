# CALLS Subsystem — Audit Report (2026-06-11)

This audit covers the WebRTC calling subsystem (`hooks/useWebRTC.ts`, `components/CallManager.tsx`, `components/MinimizedCallBubble.tsx`, `components/PinchZoom.tsx`, `hooks/useDragResize.ts`, `utils/documentPip.ts`, `utils/helpers.ts`). After deduping near-duplicate findings (merging same-root-cause items and keeping the highest severity), **27 confirmed issues** remain: **1 Critical, 7 High, 11 Medium, 8 Low**. The dominant themes are (1) a complete lack of signaling sender-verification on a public broadcast channel, enabling a malicious room member to spoof/kick/DoS calls; (2) missing call-lifecycle exits (no ring timeout, no end-on-last-peer-leave, no leave-on-unmount, no polite-side ICE recovery); (3) iOS/Safari media compatibility gaps (suspended AudioContext, blocked autoplay, track-less renegotiation drops); and (4) a monolithic CallManager that re-renders the whole call tree on a 1 Hz timer.

---

## Critical

- **Signaling fully trusts attacker-controlled `fromUid`/`fromName`/`fromAvatar` — no sender verification** — `hooks/useWebRTC.ts` `handleSignal` (lines 412-517) + subscribe callback (lines 529-533).
  - **Problem:** The `calls:<roomKey>` channel is a plain Supabase Realtime broadcast channel (no `private: true`, no RLS-bound sender identity). Every inbound signal is processed using identity fields taken verbatim from the payload; the only guards are `data.fromUid === user.uid` (self-echo) and the `toUid` routing check. Neither verifies the payload's `fromUid` belongs to the actual sender.
  - **Impact:** This is the root enabler for the spoofed-leave (kick/DoS), spoofed-decline, offer-hijack (MITM), and ring-spam findings below. Any authenticated room member can act as any other user. Constrained to intra-room abuse (membership is RLS-gated), which is why the verdict pinned it at high/critical severity rather than an unauthenticated attack — but as the shared root cause it heads the list.
  - **Fix:** Bind signaling identity to a verified source: either move signaling onto a `{ config: { broadcast: { self: false }, private: true } }` channel with an RLS authorization policy that validates the sender's room-scoped identity, or attach a server-issued per-session token and verify `fromUid` against it before acting. At minimum, pin `fromUid` to the uid first seen for a peer connection and reject contradicting later signals.

---

## High

- **Spoofed `offer` can hijack/redirect an existing peer's media (MITM)** — `hooks/useWebRTC.ts` `handleSignal` case `'offer'` (lines 440-463).
  - **Problem:** Peer entries are keyed solely by `data.fromUid`. A malicious member can send `{ type:'offer', fromUid:<legit peer uid>, toUid:<victim uid>, payload:<attacker SDP> }`; the victim feeds the attacker SDP straight into `setRemoteDescription` and answers. With matching forged ICE candidates, the victim's media path can be renegotiated toward the attacker. The perfect-negotiation rollback path worsens it: an unsolicited offer forces the polite victim to roll back its own in-flight negotiation.
  - **Impact:** Call hijack / media redirection (MITM) on an established connection, or forced renegotiation churn.
  - **Fix:** Verify sender identity (Critical finding) before accepting renegotiation; only accept a mid-call `offer` for a peer whose state legitimately expects one; tie the peer entry to the identity established at setup.

- **Spoofed `leave` lets any member forcibly drop another participant (kick / persistent DoS)** — `hooks/useWebRTC.ts` `handleSignal` case `'leave'` (lines 490-498).
  - **Problem:** `leave` is processed with zero verification — it immediately `removePeer(data.fromUid)`, closing that RTCPeerConnection. A member can broadcast `{ type:'leave', fromUid:<victim uid> }` to make everyone tear down their connection to the victim. During `ringing`, a spoofed caller-uid `leave` cancels a legitimate incoming call (stops ringtone, resets to idle) before the callee can answer.
  - **Impact:** Repeatable kick = persistent targeted DoS; ringtone/incoming-call cancellation.
  - **Fix:** Require verified sender identity (Critical finding); a peer should only be removable by itself — ignore a `leave` whose `fromUid` differs from the authenticated sender.

- **Voice-filter / screen-audio AudioContext is never `resume()`'d → silent outgoing audio on iOS** — `hooks/useWebRTC.ts` `buildOutgoingAudio` (lines 235-258).
  - **Problem:** When a voice filter is active or screen audio is mixed, outgoing audio is rebuilt through a brand-new `new Ctx()`. On iOS Safari a fresh AudioContext starts `suspended` and only advances on a user-gesture `resume()`. This code never calls `ctx.resume()`. The path is commonly reached outside a gesture (after async `getDisplayMedia` in start/stop screen share), so the `MediaStreamDestination` produces no samples and remote peers hear nothing.
  - **Impact:** Local user thinks the filter/share is live; peers receive silence.
  - **Fix:** Call `ctx.resume().catch(()=>{})` after `new Ctx()`, and add a one-time pointer-gesture listener that resumes `audioCtxRef.current` whenever its state is `suspended`.

- **Remote `AudioSink` `<audio>` elements are unmuted and rely on programmatic `play()` → blocked autoplay on iOS** — `components/CallManager.tsx` `AudioSink` (lines 131-135), mounted at line 503.
  - **Problem:** All remote call audio routes through hidden unmuted `<audio autoPlay>` sinks whose stream is set via `el.srcObject` then `el.play().catch(()=>{})` inside an effect that fires after the WebRTC track arrives (asynchronously, long after the accept/start tap). iOS Safari blocks audible autoplay outside a user gesture; the swallowed `.catch` hides the rejection, and there is no retry-on-gesture.
  - **Impact:** The single most likely cause of "I can't hear them on my iPhone."
  - **Fix:** Attach the sink stream synchronously in the accept/start handler where possible; on `play()` rejection register a one-time document `pointerdown`/`click` that re-calls `el.play()` for every sink; prime media playback in the existing ChatScreen unlock gesture.

- **Last remote peer leaving never ends my call — stuck on "Waiting for others…" forever** — `hooks/useWebRTC.ts` `removePeer` (lines 307-318) + `'leave'`/`'closed'` paths (490-498, 393-401); UI `CallManager.tsx` lines 363-369.
  - **Problem:** When the only other participant leaves (sends `leave` or their PC goes `closed`), `removePeer` deletes the entry and syncs but never transitions my own `status` out of `incall`. Only the pre-connect 1-on-1 `decline` path handles this; there is no equivalent for a peer who leaves *after* connecting, nor for the room emptying out.
  - **Impact:** Surviving side must manually hang up every time; group calls leave a ghost call running (camera/mic on, stats interval polling) after everyone is gone.
  - **Fix:** After `removePeer` in the `leave`/`closed` paths, if `status === 'incall' && peers.size === 0 && directTargetRef !== null`, call `cleanup()` (with an info notice). For group calls, surface a clear "call ended" state instead of "waiting."

- **Switching camera while video is OFF silently re-enables the camera, and the button shows the wrong state** — `hooks/useWebRTC.ts` `switchCamera` (lines 682-697).
  - **Problem:** `switchCamera` acquires a fresh `getUserMedia` video track (always `enabled=true`) and pushes it to the sender + preview, but never copies the current `isVideoOff` state onto it. There is no `isVideoOffRef` (only `isMutedRef`), and `isVideoOff` is excluded from the `useCallback` deps. So if the user turned the camera off then taps Switch Camera, video starts broadcasting again while the button still shows the crossed-out icon.
  - **Impact:** Unintended video broadcast; toggle button reports the opposite of reality. *(Merged with the lower-severity duplicate of the same bug.)*
  - **Fix:** Add an `isVideoOffRef` mirror and apply `newVideo.enabled = !isVideoOffRef.current` after acquisition.

- **callDuration 1 s tick / `syncPeers` churn re-renders the ENTIRE un-memoized call tree** — `hooks/useWebRTC.ts` duration effect (775-780) + `syncPeers` (186-197); `components/CallManager.tsx` (consumed line 174/270; `CallTile`/`AudioSink`/`SelfViewPiP` unmemoized 41-135).
  - **Problem:** `setCallDuration(d=>d+1)` fires every 1000 ms; `callDuration` is consumed only in one timer chip but CallManager is monolithic with no `React.memo` boundaries, so every tick re-renders all tiles, the spotlight IIFE, `PinchZoom`, `SelfViewPiP` (re-instantiating `useDragResize`), all `AudioSink`s, and the PiP portal — re-running `getVideoTracks().some(...)` per tile. `syncPeers` compounds this by rebuilding an all-new `peers[]` (new object identities) on every track mute/unmute/ended and every ICE state change, with no diffing or batching.
  - **Impact:** Steady wasteful churn once/sec plus on every signaling event. *(Verdicts rated the individual pieces low/medium at the ~4-5 peer cap; grouped here because together they are the headline perf issue and the fix is shared.)*
  - **Fix:** Isolate the timer in a `<CallTimer/>` leaf that owns its own interval/state so the tick repaints only the chip; wrap `CallTile`/`AudioSink`/`SelfViewPiP` in `React.memo` (stream identity is stable); coalesce `syncPeers` via `queueMicrotask`/rAF batching and bail when nothing meaningful changed.

---

## Medium

- **Spoofed `decline` tears down a caller's pending 1-on-1 call (DoS)** — `hooks/useWebRTC.ts` `handleSignal` case `'decline'` (lines 507-515).
  - **Problem:** While a caller waits on a 1-on-1 ring (`directTargetRef` set, no peers yet), a `decline` whose `fromUid` equals the called uid runs `cleanup()`. With no sender verification, any member can spoof `{ type:'decline', fromUid:<callee>, toUid:<caller> }` and repeat it to prevent the two parties from ever connecting.
  - **Impact:** Targeted call-denial of pending 1-on-1 calls.
  - **Fix:** Honor `decline` only from the verified identity of the rung uid (Critical finding); until then, consider not auto-cleaning the whole call on a single unauthenticated decline.

- **Unauthenticated `join` forces ringtone + ringing UI with attacker-controlled name/avatar (spam / caller-ID spoof)** — `hooks/useWebRTC.ts` `handleSignal` case `'join'` (lines 417-431).
  - **Problem:** An idle client that receives a `join` immediately enters `ringing`, plays the ringtone, and renders `fromName`/`fromAvatar` from the unverified payload. Anyone who knows the roomKey can repeatedly broadcast `join` with arbitrary identity to ring the victim continuously and impersonate a trusted contact.
  - **Impact:** Nuisance-DoS plus social-engineering / caller-ID spoofing.
  - **Fix:** Verify sender identity before ringing; rate-limit/de-dupe ring events per `fromUid`; render caller name/avatar from the verified presence record, not the signal payload.

- **ICE `failed`/`disconnected` on the polite (larger-uid) side never recovers and never removes the dead peer** — `hooks/useWebRTC.ts` `oniceconnectionstatechange` (lines 393-401).
  - **Problem:** Only the smaller-uid side restarts ICE (`if (user.uid < uid) restartIce(entry)`). If the smaller-uid peer is the one that died ungracefully (no `leave`, e.g. mobile background kill), the larger-uid survivor never restarts and the connection can sit in `disconnected`/`failed` indefinitely without reaching `closed`, so `removePeer` never fires.
  - **Impact:** Survivor stuck on "Reconnecting…" forever with a zombie peer entry feeding the stats interval.
  - **Fix:** Add a failure timer — on `failed` (or unrecovered `disconnected` within N seconds), `removePeer(uid)` on the polite side too and re-evaluate call-end; optionally let the polite side restart ICE after a grace period.

- **`switchCamera` stops the old track before acquiring the new one and has no rollback / degrade fallback** — `hooks/useWebRTC.ts` `switchCamera` (lines 682-697); `getMedia` constraint (line 556).
  - **Problem:** `switchCamera` stops the existing video track *first*, then awaits `getUserMedia({ video: { facingMode: newMode } })` as a hard constraint with no `ideal`. On a single-camera device (laptop/desktop/tablet) or a transient `NotReadableError`, this throws; the catch only `console.error`s — the old track is already dead, no new track replaces it, and nothing restores the sender. *(Merged compat "no degrade fallback" + critic "stop-before-acquire, no rollback" — same root cause.)*
  - **Impact:** Frozen black self-view and dead outgoing video sender for the rest of the call, with no UI recovery affordance.
  - **Fix:** Use `facingMode: { ideal: newMode }`; acquire the new track *before* stopping the old one; on failure keep the existing track and surface a notice.

- **1-on-1 caller can wait forever — no ring timeout and no failure path when the callee accepts but ICE never connects** — `hooks/useWebRTC.ts` `enterCall` (612-630) + `decline` (507-515); UI `CallManager.tsx` 363-369.
  - **Problem:** Starting a 1-on-1 call goes straight to `incall`/"Waiting for others…". The only automatic exit is an explicit `decline` from the exact target while `peers` is empty. No timeout exists, and ICE `failed` before `everConnected` only triggers `restartIce`, never cleanup.
  - **Impact:** Caller waits indefinitely if the target never responds, or if the callee accepts but TURN/ICE never connects — no "No answer"/"Call failed" feedback.
  - **Fix:** Add a 30–45 s ring/answer timeout for direct calls (show "No answer" + cleanup); optionally detect all-peers-failed-before-connect and surface "Call failed."

- **Component unmount mid-call (room deletion / leaving room) cleans up locally but never signals `leave` to peers** — `hooks/useWebRTC.ts` unmount effect (line 805); contrast `hangup` (650-653).
  - **Problem:** `hangup()` sends `leave` then `cleanup()`, but the unmount cleanup and the `enterCall` catch path call `cleanup()` *without* sending `leave`. When `roomDeleted` flips (ChatScreen gate, line 1138) or the user navigates away mid-call, CallManager unmounts and peers get no `leave`.
  - **Impact:** Remote tiles for the departed user linger on "Reconnecting…" for ~30 s until ICE times out, instead of disappearing promptly.
  - **Fix:** Send a best-effort `sendSignal({ type:'leave' })` before tearing down on unmount (channel is still open at that point; the broadcast is fire-and-forget).

- **Ringtone keeps playing through the `getUserMedia` permission prompt** — `hooks/useWebRTC.ts` `enterCall` (612-624) → `acceptCall` (634-640).
  - **Problem:** `enterCall` does `await getMedia(...)` first and only calls `stopRingtone()` after the media promise resolves. On the first call the browser permission dialog can stay open for seconds, during which the loud 45 s ringtone keeps playing despite the user already tapping Accept. (`declineCall` correctly stops it synchronously — confirming this is unintended.)
  - **Impact:** Ringtone continues for seconds after the user accepts.
  - **Fix:** Call `stopRingtone()` (and `setIncoming(null)` / optimistic status) at the very top of `enterCall`/`acceptCall`, before awaiting `getMedia`.

- **An incoming `join` while already `ringing` is silently dropped — second caller invisible; first caller's `leave` then clears the ring** — `hooks/useWebRTC.ts` `'join'` (417-432) and `'leave'` (490-498).
  - **Problem:** The `join` arm handles only `incall` and `idle`. A second caller arriving while the user is already `ringing` falls through and is never stored. Worse, `incoming` still references caller A, so if A hangs up, the `leave` handler clears the ring to `idle` even though caller B is still actively calling.
  - **Impact:** In a busy room, two near-simultaneous calls collapse to one orphaned ring; caller B can never be answered.
  - **Fix:** Replace the single `incoming` with a small queue/set keyed by `fromUid`; on `join`-while-`ringing` add the caller; on `leave` remove that caller and only drop to idle when the queue is empty, otherwise promote the next caller.

- **`removePeer` never purges that peer's `pendingCandidates` — stale ICE candidates leak into the same uid's next connection** — `hooks/useWebRTC.ts` `removePeer` (307-318); drained in `createPeer` (404-405) and `candidate` (476-488).
  - **Problem:** `cleanup()` clears the whole `pendingCandidates` map, but `removePeer` (single peer leaving / ICE `closed`) never deletes the per-uid buffer. Orphaned candidates leak; and if the same uid rejoins, `createPeer` pushes stale candidates from the dead connection into the fresh PC.
  - **Impact:** Minor memory leak per churn; potential pollution/slowdown of a reconnecting peer's negotiation (mismatched-session candidates are usually rejected by the ICE stack, limiting harm).
  - **Fix:** In `removePeer`, also `pendingCandidates.current.delete(uid)` (and clear `entry.candidateQueue`) regardless of whether an entry existed.

- **openDocPip never closes the PiP window on component unmount — orphaned always-on-top OS window** — `components/CallManager.tsx` `pipWindow` effect (188-194).
  - **Problem:** The PiP window is closed only by the effect keyed on `[status, pipWindow]` when status leaves `incall`. If CallManager unmounts while still `incall` (room deleted, route unmount), the `setStatus('idle')` inside the unmounting hook is a no-op and never re-triggers that effect. No unmount-only cleanup closes the window. *(Merged the low-severity duplicate of the same finding; kept the medium-severity critic verdict.)*
  - **Impact:** Stranded always-on-top OS PiP window showing a frozen frame; the portal target (`pipWindow.document.body`) holds references to the dead React tree. (Media itself is stopped by the hook's `cleanup()`.)
  - **Fix:** Add a ref-backed unmount cleanup: `useEffect(() => () => { try { pipWindowRef.current?.close(); } catch {} }, [])`.

- **Screen-share renegotiation silently dropped when a peer is mid-negotiation (no retry) → black tile on iOS** — `hooks/useWebRTC.ts` `startScreenShare` (765) / `stopScreenShare` (717) → `makeOffer` (320-333).
  - **Problem:** Both screen-share paths do `peers.forEach(makeOffer)`. `makeOffer` early-returns when `entry.makingOffer || pc.signalingState !== 'stable'` with no retry/queue. If a peer is mid-negotiation (ICE restart in flight, initial answer not yet applied) when share starts, the iOS-required renegotiation for the track-less→active video m-line never happens. There is no `onnegotiationneeded`/`signalingstatechange` retry anywhere. *(Merged bugs + compat findings on the same code.)*
  - **Impact:** That iPhone viewer shows an avatar/black tile for the whole share until some unrelated future renegotiation.
  - **Fix:** Set a per-peer `needsRenegotiation` flag when `makeOffer` is skipped and re-attempt on the `signalingstatechange → stable` transition (or use `onnegotiationneeded`).

- **`CallTile` binds the stream only on stream-reference change; `replaceTrack`/unmute never re-fires `play()` → frozen/black video on iOS** — `components/CallManager.tsx` `CallTile` effect (54-60); `useWebRTC` `ontrack` (line 381).
  - **Problem:** `CallTile`'s effect depends only on `[stream]`. Remote streams are a stable `MediaStream` that has tracks *added* to it (`entry.stream.addTrack`), so the effect re-runs only on first bind. When a screen-share/camera track becomes active later, `showVideo` flips via the mute listener but `el.play()` is never called again — and iOS Safari often needs an explicit `play()` after a new track activates or the element was hidden (minimize/restore).
  - **Impact:** Tiles mounted before frames arrive can stay frozen/black on iOS even though `showVideo` is true.
  - **Fix:** Key the effect on live track identity (include the video track id in deps) or call `el.play()` in a small effect on `showVideo` to cover camera/screen/unmute transitions.

---

## Low

- **Untrusted remote SDP/ICE fed directly into `setRemoteDescription`/`addIceCandidate` with no shape validation; `pendingCandidates` is unbounded** — `hooks/useWebRTC.ts` `answer` (469), `candidate` (476-489), `drainCandidates` (300-305).
  - **Problem:** `data.payload` is cast (`as RTCSessionDescriptionInit`/`as RTCIceCandidateInit`) with no runtime checks. Per-call try/catch prevents crashes, but a spoofed `fromUid` (Critical finding) can inject crafted answers/candidates, and `pendingCandidates`/`candidateQueue` accept arbitrary candidates for a not-yet-existing peer with no cap.
  - **Impact:** Connection disruption/steering for an existing peer; unbounded memory growth under a candidate flood.
  - **Fix:** Validate payload shape before constructing RTC objects; gate on verified sender identity; cap `pendingCandidates`/`candidateQueue` size per uid.

- **Attacker-controlled `fromAvatar` used directly as `<img src>` (outbound fetch / identity spoof)** — `components/CallManager.tsx` ringing UI (line 219); `CallTile`/PiP avatars (309, 337-348, 73).
  - **Problem:** `incoming.fromAvatar` and each peer's `avatar` come from the unverified payload and are assigned straight to `<img src>`. React escapes the attribute (no XSS), but the victim's browser fetches an attacker-chosen URL the instant a spoofable `join`/`present` arrives.
  - **Impact:** IP/online-status beacon (tracking pixel), arbitrary remote content load, forged avatar for impersonation. `fromName` is escaped text (display-spoof only).
  - **Fix:** Resolve avatar/name from the verified presence/member list by uid; or validate URL scheme+host against an allowlist before binding.

- **`facingMode` is never reset by `cleanup()` — a rear-camera call leaks into the next call** — `hooks/useWebRTC.ts` `cleanup` (577-607); `switchCamera` (693); `getMedia` (556-558).
  - **Problem:** `cleanup()` resets every other call state (`isMuted`, `isVideoOff`, `voiceFilter`, etc.) but not `facingMode`. Since `getMedia` reads `facingMode` (in its deps), a prior rear-camera flip persists into the next video call.
  - **Impact:** New call unexpectedly opens on the rear camera.
  - **Fix:** Add `setFacingMode('user')` to `cleanup()` (or document deliberate cross-call persistence).

- **`stopScreenShare` catch path can leave a muted mic live (graph-build failure loses mute state)** — `hooks/useWebRTC.ts` `buildOutgoingAudio` (229-258); `toggleMute` (655-664).
  - **Problem:** `buildOutgoingAudio` sets `mic.enabled = true` (line 242) before building the graph. If construction throws, the catch (line 256) returns `mic` with `enabled = true` while `micGainRef` is null — so a muted user becomes audible until the next `toggleMute`.
  - **Impact:** Muted mic briefly goes live after a filter/screen rebuild failure (uncommon error path).
  - **Fix:** In the catch branch set `if (mic) mic.enabled = !isMutedRef.current;` before returning.

- **Video on/off button stays active during screen share and corrupts the camera's restored state** — `components/CallManager.tsx` controls bar (376-380); `stopScreenShare` (704).
  - **Problem:** The camera toggle is rendered on `isVideo && hasLocalVideo` with no `!isScreenSharing` gate (unlike the adjacent Switch-camera button). During a screen share, `toggleVideo` flips `.enabled` on the camera track stored in `cameraVideoTrackRef` (no visible effect to peers) while flipping `isVideoOff`. On stop, `stopScreenShare` restores that track without re-syncing `.enabled`.
  - **Impact:** Control appears to do nothing mid-share and leaves the camera disabled/black (or inconsistent with `isVideoOff`) afterward.
  - **Fix:** Gate the button on `&& !isScreenSharing` (or no-op `toggleVideo` while sharing), and re-sync `cameraVideoTrackRef`'s `.enabled` to `!isVideoOff` on restore.

- **Rear-facing camera is mirrored in self-view, making text/scenes appear reversed** — `components/CallManager.tsx` `showLocalVideo` (256) used as `mirror` for grid local tile (356) and `SelfViewPiP` (323).
  - **Problem:** The `mirror` flag is derived purely from `showLocalVideo`, independent of `facingMode` (which isn't even exported from `useWebRTC`). Mirroring is correct for the front camera but wrong for the rear camera after Switch Camera. Remote peers are unaffected.
  - **Impact:** Rear-camera self-view is horizontally flipped (text reads backwards) for the local user.
  - **Fix:** Export `facingMode` and compute `mirror = showLocalVideo && facingMode === 'user'`.

- **Floating windows/PiP/self-view are not re-clamped on viewport resize/orientation change, and drag listeners leak on unmount mid-drag** — `hooks/useDragResize.ts` (35-69); consumers `SelfViewPiP` (CallManager 95-99), `MinimizedCallBubble` (53-56), `DraggableWindow` (159-160).
  - **Problem:** `clampBox` is applied only during an active pointer drag; initial positions are set once at mount from `window.innerWidth/Height`, with no `resize`/`orientationchange` listener. Rotating the phone can strand the bubble (and its only Restore/Hang-up controls) off-screen. Separately, `startDrag`/`startResize` add window `pointermove`/`pointerup` listeners removed only inside the `up` handler — if the component unmounts mid-drag (call ends while dragging) those listeners leak. *(Merged the two drag-resize findings.)*
  - **Impact:** Off-screen, unrecoverable floating controls after rotation; leaked window-level listeners.
  - **Fix:** Add a `useDragResize` effect listening for `resize`/`orientationchange` that re-applies `clampBox(boxRef.current, …)`; track the active move/up handlers in a ref and remove them in an unmount cleanup.

- **Floating-surface geometry resets on every window-mode toggle / spotlight↔grid flip, and ignores safe-area insets** — `components/CallManager.tsx` `SelfViewPiP` (91-109), `MinimizedCallBubble` mount (406-422), `DraggableWindow` init (159); `MinimizedCallBubble.tsx` (54-56).
  - **Problem:** Each floating surface computes its initial box once at mount from `window.innerWidth/Height` minus hardcoded constants. `SelfViewPiP` mounts only in the spotlight branch, so a peer joining (grid) then leaving (spotlight) remounts it and snaps it back to the corner, discarding the user's dragged position; the same remount-resets-position hits the minimized bubble on restore↔minimize and `DraggableWindow` on full↔window. None of the offsets account for `env(safe-area-inset-*)`, so `y = innerHeight - h - 158` can sit under the notch/home indicator. *(Merged the safe-area-insets finding, the bounds-mismatch finding, and the geometry-not-re-derived finding.)*
  - **Impact:** Lost drag position on layout changes; PiP overlapping timer/controls or hiding behind the notch/Dynamic Island on iPhones.
  - **Fix:** Persist each surface's box in state/ref held above the conditional render so remounts restore position; derive top/bottom offsets from resolved `env(safe-area-inset-*)` values rather than hardcoded 72/150/158/90 px constants.

- **Shared screen is cropped (`object-cover`) in the Document-PiP and minimized bubble** — `components/CallManager.tsx` `PipCallView` (line 145); `components/MinimizedCallBubble.tsx` `BubbleVideo` (line 22).
  - **Problem:** The spotlight honors a Fit/Fill toggle and defaults to `object-contain` when a peer is sharing, but the PiP popout and minimized bubble hardcode `object-cover` and never receive a sharing flag (the bubble's outer component has `sharing` but doesn't forward it to `BubbleVideo`).
  - **Impact:** A remote 16:9 screen capture is center-cropped (toolbars/content edges cut off) in compact views, with no fit option.
  - **Fix:** Pass a sharing flag into `PipCallView`/`MinimizedCallBubble` (reuse `sharingUids.has(peers[0].uid)`) and use `object-contain` when sharing.

- **On-tap ringtone won't sound when the incoming-call signal arrives before any user gesture (AudioContext suspended)** — `utils/helpers.ts` `startRingtone` (184-214)/`initAudio` (133-152), called from `useWebRTC` `'join'` (428-429).
  - **Problem:** The ringtone uses the shared Web Audio context; `startRingtone` calls `resume()`, but autoplay policy keeps it suspended until a gesture. The `join` handler fires from a Realtime callback (not a gesture). A returning user landing directly on ChatScreen before their first `pointerdown` rings silently.
  - **Impact:** Incoming-call UI appears but rings silently on a fresh/backgrounded tab before first interaction.
  - **Fix:** Acceptable browser limitation, but add a fallback `<audio>` element with a real ringtone asset and/or `navigator.vibrate` as a non-audio cue.

- **getDisplayMedia guard works but the Share-screen button is always rendered on iOS** — `components/CallManager.tsx` share button (386-393) vs `startScreenShare` gate (useWebRTC 726-729).
  - **Problem:** On iPhone/iPad the screen-share button is fully rendered and looks actionable; only after the tap does `startScreenShare` check `getDisplayMediaSupported()` and surface a "not supported" toast.
  - **Impact:** Poor mobile UX — an always-failing control; the toast competes for the `z-[200]` notice slot.
  - **Fix:** Import `getDisplayMediaSupported` into CallManager and render the button only when true (or disabled with a tooltip).

---

## Recommended fix order

1. **Signaling sender-verification (Critical).** It is the single root cause behind the spoofed-offer/leave/decline/join and SDP/ICE-injection findings. Move signaling to a `private` channel with an RLS-validated sender identity (or per-session token), and pin peer entries to the identity seen at setup. This collapses six security findings at once.
2. **iOS audio compatibility (High×2).** `ctx.resume()` for the outgoing-audio AudioContext, and a gesture-fallback `play()` for the unmuted `AudioSink` elements — these are the "can't hear them on iPhone" / "filter is silent" reports.
3. **Call-lifecycle exits (High + Medium cluster).** End-on-last-peer-leave, leave-on-unmount, polite-side ICE failure recovery, and a 1-on-1 ring/answer timeout — all close "stuck forever" / ghost-call states.
4. **switchCamera correctness (High + Medium).** Apply `isVideoOff` to the new track, acquire-before-stop with rollback, and `{ ideal: facingMode }`.
5. **Performance churn (High).** Isolate the call timer into a leaf, `React.memo` the tiles/sinks/PiP, batch `syncPeers`, and move `PinchZoom` pan/pinch to imperative refs.
6. **Screen-share renegotiation + iOS `play()` re-fire (Medium).** Per-peer renegotiation retry on return-to-`stable`; re-`play()` on `showVideo`/track activation.
7. **Remaining Medium/Low UX & hardening.** Ring-while-ringing queue, `pendingCandidates` purge on `removePeer`, PiP unmount cleanup, floating-surface re-clamp + safe-area + position persistence, mirror-by-facingMode, mute-on-rebuild-failure, video-toggle-during-share gate, payload validation, avatar allowlisting, compact-view fit, iOS share-button hide.
