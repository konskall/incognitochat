# Incognito Chat — Full Application Audit (2026-06-13)

Multi-agent Workflow audit (10 area finders × all dimensions → adversarial per-finding verify → completeness critic). Scope: every source file, public/, dist, edge functions, live DB. The run was interrupted by session limits across three resumes; the **verify** stage failed for several areas (dashboard, presence-push, database, entry-shell, edge-functions partial) and the **critic** never ran — so findings whose verifier failed were dropped from the machine "confirmed" list and are recorded here under *Unverified (area-verdict referenced)* for manual confirmation.

Settled decisions excluded by design (NOT findings): hardcoded TURN creds, plaintext membership-gated PIN, public-read storage, key rotation, anon-key/VAPID-public in bundle, multilingual inco-ai, all-members room management, fromUid signaling trust (known residual), anon uid churn, English-only UI, session-scoped bell toggle.

---

## CONFIRMED (verified) — 25

### High
1. **useIncoAI bot permanently wedges** — `hooks/useIncoAI.ts:44-53,127`. Effect sets `isBusy.current=true` + `lastProcessedId` synchronously, schedules `handleBotResponse` on a 500ms timer, returns `clearTimeout` as cleanup. Deps include the whole `messages` array (new identity on ANY realtime event). Any event within 500ms cancels the timer → `handleBotResponse` never runs → `finally` never resets `isBusy` → every future trigger hits `if(isBusy.current) return`. Bot dead until remount. Residual of cddcd8f. FIX: reset isBusy in cleanup when cancelled, or drop the cancellable debounce.

### Medium
2. **File input value never reset** — `components/ChatInput.tsx:111-137`. Re-attaching the same file fires no change event; iOS captures all named image.jpg → second photo silently fails. FIX: `e.target.value=''` after capture.
3. **Unchecked Supabase update errors report fake success** — `components/ChatScreen.tsx:957-964,982-993,1008-1014`. Email subscribe/unsubscribe + AI toggle flip UI + post system message even on RLS/network failure. FIX: destructure `{error}`, bail + keep prior state.
4. **Room deletion orphans attachments >100** — `components/ChatScreen.tsx:874-878`. `storage.list()` defaults limit:100; files past page 1 stay publicly reachable forever. FIX: paginate list/remove (matches deleteRoomByKey in DashboardScreen).
5. **Voice-note player broken for webm (Infinity duration)** — `components/MessageList.tsx:88,106-115,137`. Chromium/FF webm/opus reports duration=Infinity; guard skips it, no durationchange listener → 0:00, seek restarts. FIX: durationchange + Infinity workaround.
6. **Loose YouTube regex swallows real links** — `utils/helpers.ts:278-283`, `components/MessageList.tsx:356,399`. `v\/` + `[^#&?]*` matches non-YT URLs → broken embed + the real link disappears. FIX: anchor to youtube.com/youtu.be host, id `[A-Za-z0-9_-]{11}`.
7. **Inco re-triggers on stale history after remount** — `hooks/useIncoAI.ts:18,23-45`. `lastProcessedId` null on mount → first render treated fresh → ghost/duplicate bot replies on re-entry. FIX: seed lastProcessedId on first non-empty render / mount-timestamp gate.
8. **Resync recovers only INSERTs** — `hooks/useChatMessages.ts:176-205,276-292`. `fetchNewer` is gte-latest only; deletes/edits/reactions/poll-votes missed while socket slept stay stale (deleted messages linger — privacy-relevant). FIX: reconcile loaded window (IN query) on refocus/reconnect.
9. **compressImage flattens transparent PNG→black** — `utils/helpers.ts:323-333`. canvas→JPEG, no alpha; used for messages + avatars + room bg. FIX: white-fill canvas before drawImage (or keep PNG output).
10. **Bubble drag→restore on mouse** — `components/MinimizedCallBubble.tsx:62-68` + `hooks/useDragResize.ts:59-72`. Full-cover restore button under pointer; preventDefault on pointerdown doesn't suppress click → desktop can't reposition. FIX: moved-threshold one-shot capture click swallow.
11. **leave-on-unmount is dead code** — `hooks/useWebRTC.ts:588-600 vs 888-891`. Channel-effect cleanup removes channel before leave-effect cleanup runs → `channelRef.current` null → leave no-ops. Peers wait for 15s ICE backstop. FIX: send leave inside channel effect's own cleanup before removeChannel.
12. **End-on-last-peer fires for GROUP calls** — `hooks/useWebRTC.ts:341-344`. Should be gated 1-on-1 only; group call ends while invitees still ringing (and no leave sent → ringers stuck). FIX: gate on directTargetRef, send leave.
13. **enterCall ringtone race** — `hooks/useWebRTC.ts:677-701 vs 468-487`. A 'join' during getUserMedia await sets ringing+ringtone; enterCall flips to incall without re-stopping → ringtone blasts into call up to 45s. FIX: enteringRef flag + re-stop after await.
14. **Non-string fromName crashes app (no ErrorBoundary)** — `hooks/useWebRTC.ts:462-487`. Object fromName rendered as React child → whole root unmounts to white screen for every recipient. Crash-DoS. FIX: coerce fromName/fromAvatar to string in handleSignal.
15. **Self-view PiP invisible in windowed mode** — `components/CallManager.tsx:97-113,453`. Positioned/clamped to window.inner* but lives in overflow-hidden DraggableWindow → clipped offscreen. FIX: measure offsetParent, clamp to container.
16. **No-answer ring-timeout leaves callee UI forever** — `hooks/useWebRTC.ts:692-700`. 40s timeout calls cleanup() without broadcasting leave → callee's fullscreen incoming overlay persists. FIX: sendSignal leave before cleanup.
17. **link-preview SSRF via redirect:follow** — `supabase/functions/link-preview/index.ts:77-84`. Guard validates only the user URL; 302→internal host followed unchecked. FIX: redirect:manual, re-validate each hop.
18. **notify-room action:"deleted" bypasses cooldown** — `supabase/functions/notify-room/index.ts:64,98-101`. Any member spams unlimited emails. FIX: apply cooldown/rate-limit to all actions.
19. **inco-ai no per-caller rate limit** — `supabase/functions/inco-ai/index.ts:34-110`. Member can spam expensive Gemini+Search → quota/cost DoS. FIX: per-uid/room cooldown.

### Low (verified)
20. Emoji/attachment focus-trap re-runs every render → steals focus, closes mobile keyboard — `EmojiPicker.tsx:30, AttachmentSheet.tsx:26, ChatInput.tsx:267-268`. FIX: useCallback onClose / ref in useModalA11y.
21. Escape closes every stacked modal — `hooks/useModalA11y.ts:34-39,65`. stopPropagation ≠ stopImmediatePropagation; outer modal runs first. FIX: module-level modal stack, topmost handles Escape.
22. loadOlderMessages strict `lt` skips same-timestamp boundary rows — `hooks/useChatMessages.ts:147-153`. FIX: `lte` + id-dedup + secondary order by id.
23. (dup of 21 from entry-shell lens)
24. link-preview IPv6 bracket bypass — `supabase/functions/link-preview/index.ts:34-37`. `new URL("http://[::1]/").hostname === "[::1]"` so checks never match. FIX: strip brackets, normalize IPv6 ranges.
25. (Escape stacked modal, messages lens — dup of 21)

---

## LOWS (unverified) — 47
(Recorded verbatim from finders; not adversarially verified. Grouped by area.)

**chat-core:** stale notifySubscribers in handleCreatePoll (poll emails ignore exclusion); pinned-banner tap no-op for older-than-page pins; dashboard lastRead baseline advances while tab hidden; 'deleted' push/email sent before delete confirmed; emoji picker viewport-anchored on wide desktop.

**messages:** gallery tab resets when new content arrives; TTL-expired media still in lightbox; poll reopen has no UI; copy reports success on clipboard failure; AudioPlayer isPlaying desync on play() reject; gallery video thumbnails blank on iOS (missing preload/muted/playsInline); sender avatar bypasses safeAvatarUrl; stale scroll-restore offset after no-op load-earlier; YouTube start time parsed from whole message.

**chat-data:** decryptMessage misroutes legacy plaintext containing ':' → wrong-PIN placeholder; duplicate fetchNewer on refocus (visibilitychange+focus); cipherCacheRef unbounded growth; getYouTubeId loose regex (link/embed mismatch); cleanUrl strips balanced trailing parens (Wikipedia links).

**calls:** mirror fix missed bubble + Document-PiP views; participants panel avatar without safeAvatarUrl; active screen-share state not replayed to late joiners.

**presence-push:** sw.js renotify:true+undefined tag TypeError (fallback dead); incognito-cache-v2 unbounded across deploys; state beacon shared last-writer-wins across tabs; presence cleanup uses bare unsubscribe() (StrictMode/fast-remount breaks presence).

**dashboard:** default ui-avatars URL not encoded; ephemeral 24h TTL fails silently; leave-room ignores subscribers delete error (room reappears); pb-25 invalid Tailwind class; install button dead after dismiss; member presence avatars unfiltered (DashboardScreen:254, UserProfileModal:86); room/AI avatar link inputs accept http:// (RoomAppearanceModal:124, AiAvatarModal:119); dashboard file inputs never reset.

**entry-shell:** CI hardening (npm install vs ci, mutable action tags, broad permissions, no concurrency, tests not run); room background URL unvalidated + unescaped in CSS url(); no CSP meta; landing flashes on refresh-in-room; footer LinkedIn http://.

**database:** duplicate UNIQUE indexes on push_subscriptions + subscribers; room_settings missing FK to rooms (orphans); push_subscriptions INSERT/DELETE policies use bare auth.uid(); leaked-password protection disabled.

**secrets-bundle:** SW renotify TypeError (dup); notificationclick can hijack unrelated same-origin GH Pages tab; cache unbounded (dup); footer LinkedIn http:// (dup).

---

## UNVERIFIED — area-verdict referenced but verifier failed (CONFIRM MANUALLY)
These were raised by finders whose verify agent died on a session limit; investigate directly:
- **dashboard (high):** AiAvatarModal silently overwriting custom AI avatars with the default.
- **dashboard:** inactive members counted as online; non-compliant new dialogs (a11y); cold-PBKDF2 stall; iPad install detection.
- **presence-push (high):** false-"Seen" / false-active presence bug; iPadOS detection; error-response cache poisoning (fetch handler caches non-200?); suppress-counter race under bursts.
- **database:** dead message-insert trigger 404ing on every insert; **three RLS-bypassing maintenance DELETE functions exposed to anon** (security — verify exposure/grants).
- **entry-shell:** logout privacy gaps; back-from-chat state corruption; portrait-locked PWA vs video calls.
