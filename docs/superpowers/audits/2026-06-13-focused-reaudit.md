# Focused re-audit — 6 areas not fully verified in the full-app audit (2026-06-13)

Workflow: 6 areas × **find → adversarial verify → completeness critic** (27 agents).
The critic phase — skipped in the first audit — surfaced the highest-impact
findings (DB authz holes, edge-function SSRF, SW cache poisoning).

Result: **15 confirmed** findings + **57 critic gaps**. Below: what shipped, what's
deferred, and the open decisions.

## Shipped & deployed

### DB authz hardening (live migrations `audit_2026_06_13b/_13c`)
- **messages**: table-level UPDATE revoked from anon/authenticated; only
  `(text, is_edited)` granted. Blocks direct PATCH of `poll.votes` (ballot
  stuffing), `poll.closed`, `reactions`, `uid`, `type` on one's own row — those
  go only through the SECURITY DEFINER RPCs. **(HIGH — poll/reaction integrity)**
- **rooms**: table-level UPDATE revoked; only cosmetic/settings columns granted.
  Blocks `pin` tampering, `created_by` ownership-hijack (→ delete-any-message),
  `room_key`/`created_at` edits, and the `room_name` rename-RPC bypass. **(HIGH)**
- `vote_poll` / `toggle_reaction` / `set_poll_closed`: `SELECT … FOR UPDATE`
  row locks (lost-update race dropped concurrent votes/reactions). **(MED)**
- `idx_room_settings_room_key` for the cascade FK. **(LOW perf)**

### Edge functions (redeployed)
- **link-preview v3**: blanket-reject `::ffff:` IPv4-mapped IPv6 (the dotted
  regex was dead code → loopback + `169.254.169.254` metadata reached fetch);
  + require auth + per-uid rate limit. **(HIGH SSRF + DoS)**
- **notify-room v7**: pin email link to APP_URL origin (anti-phishing);
  atomic cooldown pre-claim (double-send/quota race); validate `excludeUids`;
  clamp text; per-send timeout. **(MED + LOW×3)**
- **send-push v10**: validate `excludeUids`; clamp body under the ~4KB cap. **(MED)**
- **inco-ai v10**: cap bot reply 4000 chars; Gemini fetch timeout. **(MED)**

### Service worker (push-v11) + client
- Nav-cache poisoning guard (`res.ok && type==='basic'`). **(HIGH)**
- iPadOS detection in SW (`IS_IOS`) + InstallButton + `IS_IOS` divergence. **(MED)**
- `pushsubscriptionchange` handler + re-persist plumbing. **(MED)**
- `pushService.unsubscribe` checks the DB error + tears down the browser sub on
  last room (was leaving the device a live target while UI said OFF). **(MED)**
- False-"Seen": gate read-receipt advance on `document.visibility`. **(MED)**
- `useRoomPresence` config via ref (stale username/avatar after mid-session
  change). **(MED)**
- `getYouTubeId` host-validated URL parser + regression tests (host-spoof embed
  suppression). **(MED security)**
- `useIncoAI` AI avatar through https check. **(MED)**
- App back-nav history-aware (chat→dashboard/login, not landing) +
  `initSession` try/catch. **(MED + HIGH)**
- DashboardScreen: count only active presence tabs + freshest tab; prune stale
  online; `safeAvatarUrl` on profile imgs; logo via BASE_URL. **(LOW×4)**
- `useDragResize` pointercancel; `useModalA11y` focus-DOM-check; 3 modal
  async-after-close guards; PBKDF2 keyCache cap; manifest `id`. **(LOW/MED)**

## Open decisions (surfaced to user)
1. **notify-room plaintext body** — emails currently carry the decrypted message
   text to EmailJS (3rd party) + inboxes, while it's encrypted at rest.
2. **Room appearance authz** — icon/wallpaper/AI-avatar editable by ANY member
   (rename is owner-only). Keep, or owner-gate?
3. **AI impersonation (HIGH, architectural)** — any member can insert a message
   as the inco sentinel uid (AI insert is client-side because encryption is
   client-side). Accept as bounded deception, or invest in a signed/server path?

## Deferred (with rationale)
- link-preview DNS-rebinding + internal-DNS-name SSRF (string guard can't
  resolve; inherent to a "basic SSRF guard") and no membership gate (roomKey not
  threaded from `LinkPreview` — auth + rate-limit cover the abuse).
- link-preview gzip/non-UTF-8 body handling (preview just fails gracefully).
- Suppress-counter Cache-Storage read-modify-write race (non-atomic; bounded).
- LoginScreen PIN pre-verify; anon currentUser path divergence; archived-room
  unread accounting; EmojiPicker roving keys; MediaPreview download on iOS;
  RoomInfo share clipboard fallback; documentPip late styles; audioRecorder size
  cap; PinchZoom stuck state; alert()-on-iOS UX — all LOW, listed for a later pass.

## Verification
Build (tsc + vite) + 38 unit tests green. DB grants re-queried post-migration.
All edge functions report ACTIVE at the new versions. Commits `c4654f0` +
`01d186a` pushed to `main` (CI: npm ci → test → build → Pages deploy).
**Device re-test still needed** (CI has no real iOS/Android/desktop devices).
