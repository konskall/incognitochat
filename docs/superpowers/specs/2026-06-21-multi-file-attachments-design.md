# Multiple File Attachments (Basic+) — Design

**Date:** 2026-06-21
**Status:** Approved (verbal), pending spec review
**Goal:** Let premium (Basic/Ultra) users pick and send several files at once; each file is sent as its own message, in order. Free users are unchanged (single file).

## Decisions (locked)

- **Display model:** each selected file becomes its **own message bubble**, sent in selection order. NO album/grid, NO DB or schema change. (User choice.)
- **Availability:** **Premium-only (Basic + Ultra).** Free stays single-file exactly as today.
- **Caption:** the composer text is attached to the **first** file's message only; the rest are caption-less.
- **Reply:** when replying, the reply quote is attached to the **first** message only.
- **Max files per send:** **10**.
- **Per-file size cap:** unchanged — each file must satisfy the tier's `maxFileBytes` (Basic 10 MB, Ultra 40 MB). Oversized files are skipped at selection with a toast naming them.
- **Notifications/push:** **one** notification per batch (e.g. "Sent 3 files"), not one per file.

## Global Constraints (from project)

- React 18 + TS + Vite + Tailwind. `noUnusedLocals`/`noUnusedParameters` are ON — no dead vars/params.
- App UI copy is **English**. Conversation with the user is Greek.
- Each file send is a normal `messages` row insert → it counts toward the server-enforced daily quota (`msgPerRoomPerDay`: free 10 [n/a here], Basic 100, Ultra unlimited). The DB raises `QT002` on the insert that exceeds the cap.
- NEVER change DB schema, RLS, edge functions, or storage layout for this feature — reuse the existing single-file pipeline N times.
- Image compression already runs per file in `handleFileSelect` (`compressImage`, skips GIF) — keep it, apply per file.

## Architecture

The existing single-file send pipeline is reused verbatim, once per file:

```
uploadFile(file): Promise<Attachment | null>      // existing (useChatMessages)
sendMessage(text, config, attachment, replyTo, location, type): Promise<void>  // existing
```

No new backend. The only changes are client-side:

1. **Entitlements** — add a `canMultiUpload` capability flag.
2. **ChatInput** — `selectedFile` (single) → `selectedFiles` (array); `<input multiple={canMultiUpload}>`; a chips tray (name + size + remove ✕ per file); upload-progress label on the send button.
3. **ChatScreen** — `selectedFile` state → `selectedFiles: File[]`; `handleSend` runs a sequential upload+send loop with quota pre-check, per-batch notification, and partial-failure recovery.
4. **A pure helper** — `canSendBatch(count, quotaLeft, maxFiles)` for client-side gating, unit-tested.

## Components & Interfaces

### 1. `utils/entitlements.ts`

- Add to the `TierEntitlements` interface:
  ```ts
  canMultiUpload: boolean; // select & send multiple files at once
  ```
- Set per tier: `free: false`, `basic: true`, `ultra: true`.
- Add an exported constant:
  ```ts
  export const MAX_FILES_PER_SEND = 10;
  ```
- Add a pure gating helper (testable, no React):
  ```ts
  // Returns whether `count` files can be sent right now.
  // quotaLeft: remaining messages today (null = unlimited).
  export function canSendBatch(
    count: number,
    quotaLeft: number | null,
    maxFiles: number = MAX_FILES_PER_SEND,
  ): { ok: true } | { ok: false; reason: 'empty' | 'max' | 'quota'; limit: number } {
    if (count <= 0) return { ok: false, reason: 'empty', limit: 0 };
    if (count > maxFiles) return { ok: false, reason: 'max', limit: maxFiles };
    if (quotaLeft != null && count > quotaLeft) return { ok: false, reason: 'quota', limit: quotaLeft };
    return { ok: true };
  }
  ```

### 2. `components/ChatInput.tsx`

**Props change:**
- Remove: `selectedFile: File | null`, `setSelectedFile`.
- Add: `selectedFiles: File[]`, `setSelectedFiles: (files: File[]) => void`, `canMultiUpload: boolean`, `uploadProgress?: { current: number; total: number } | null`.
- Keep: `maxFileBytes`, `isUploading`.

**`<input type="file">`:** add `multiple={canMultiUpload}`. (Free users physically cannot multi-select — this is the primary gate; no extra lock UI required. An optional upsell hint in `AttachmentSheet` is out of scope for v1.)

**`handleFileSelect` (rewrite for N files):**
- Read all of `e.target.files` into an array.
- Reset the input value immediately (so re-picking the same file fires `change`).
- For each picked file: if image and not GIF, `compressImage`; then check `file.size > (maxFileBytes ?? 40*MB)`. Collect valid files; collect names of oversized → skipped.
- Append valid files to existing `selectedFiles` (accumulate across multiple picks), then clamp to `MAX_FILES_PER_SEND`; if clamped or any skipped, `flashToast` (e.g. "Some files were too large and were skipped." / "You can attach up to 10 files.").
- `setSelectedFiles(next)`.

**Tray (replaces the single-file pill):** when `selectedFiles.length > 0 && !editingMessageId`, render a horizontally-scrollable row of chips, one per file: icon (`getFileIcon(file.type)`), truncated name, size in KB, and a per-chip remove ✕ that filters that file out of `selectedFiles`. A small "N files" count label.

**Send button:**
- Enabled when `inputText.trim() || selectedFiles.length > 0` (and not uploading/offline/not-ready).
- Placeholder: "Add caption..." when `selectedFiles.length > 0`.
- While sending, if `uploadProgress`, show `Uploading {current}/{total}…` (or spinner) instead of the send icon.

### 3. `components/ChatScreen.tsx`

**State:** replace `const [selectedFile, setSelectedFile] = useState<File | null>(null)` with `const [selectedFiles, setSelectedFiles] = useState<File[]>([])`. Add `const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)`.

**Derive** `canMultiUpload` from entitlements (the same `useEntitlements`/`tier` source already used for `maxFileBytes`).

**`handleSend` (rewrite the non-editing branch):**
- Guard: `if ((!inputText.trim() && selectedFiles.length === 0) || !user || roomDeleted) return;`
- Snapshot `textToSend`, `filesToSend = selectedFiles`, `replyToSend`, `editingId`.
- Optimistically clear: `setInputText('')`, `setTyping(false)`, `setSelectedFiles([])`, `setReplyingTo(null)`.
- **Editing branch:** unchanged.
- **No files** (`filesToSend.length === 0`): unchanged single text send (current code path: `sendMessage(textToSend, config, null, replyToSend, null, 'text')`, `setQuotaBump`, `notifySubscribers`).
- **With files:**
  - Client pre-check: `const gate = canSendBatch(filesToSend.length, quotaLeft);` if `!gate.ok` → restore composer (`setInputText`, `setSelectedFiles(filesToSend)`, `setReplyingTo`), then: `reason==='quota'` → `promptUpgrade('A higher message limit', ..., "You've hit today's limit for this room.")`; `reason==='max'` → `flashToast('You can send up to 10 files at once.')`; return.
  - Sequential loop `for (let i = 0; i < filesToSend.length; i++)`:
    - `setUploadProgress({ current: i + 1, total: filesToSend.length })`.
    - `const attachment = await uploadFile(filesToSend[i]);`
    - `await sendMessage(i === 0 ? textToSend : '', config, attachment, i === 0 ? replyToSend : null, null, 'text');`
    - after the first success: `setQuotaBump(n => n + 1)`.
    - On throw: `setUploadProgress(null)`; restore the **unsent remainder** `setSelectedFiles(filesToSend.slice(i))`; if `i === 0` also restore `setInputText(textToSend)` + `setReplyingTo(replyToSend)`; run the existing `parseTierError` handling (QT002 → `promptUpgrade`; QT001 → toast; else generic toast `Sent ${i} of ${filesToSend.length} files.`); `return`.
  - After the loop: `setUploadProgress(null)`; `setQuotaBump(n => n + 1)`; `notifySubscribers('message', textToSend || \`Sent ${filesToSend.length} files\`)` — **once**.

**Voice-message path** (`uploadFile` + `sendMessage` at ~line 357) is independent of `selectedFiles` and stays as-is.

**Pass-through to `<ChatInput>`:** `selectedFiles`, `setSelectedFiles`, `canMultiUpload`, `uploadProgress` (and keep `maxFileBytes`, `isUploading`).

## Data Flow

```
pick files → handleFileSelect (compress + per-file size check + clamp 10) → selectedFiles[]
   → chips tray (remove individual)
send → canSendBatch(count, quotaLeft) pre-check
   → for each file: uploadFile → sendMessage (caption+reply only on #0)
   → progress 1/N..N/N
   → notifySubscribers once
realtime: recipients receive N inserts, render in order (existing pipeline)
```

## Error Handling

- **Oversized file at selection:** skipped, others kept, toast names the skipped ones.
- **> 10 files:** clamp to 10, toast.
- **Client quota pre-check fails:** block before any upload, restore composer, upsell (quota) or toast (max).
- **Upload/insert failure mid-batch (incl. server `QT002`):** stop, keep already-sent messages, restore unsent files (and caption/reply if the first never sent), surface tier-aware prompt/toast with "Sent X of N".
- **All existing single-file error semantics** are preserved for the 1-file case.

## Testing

- `utils/entitlements.test.ts`: assert `canMultiUpload` is `false` for free, `true` for basic and ultra.
- `utils/entitlements.test.ts` (or a focused test): `canSendBatch` —
  - `(0, null)` → `{ok:false, reason:'empty'}`
  - `(3, null)` → `{ok:true}` (unlimited)
  - `(11, null)` → `{ok:false, reason:'max', limit:10}`
  - `(5, 3)` → `{ok:false, reason:'quota', limit:3}`
  - `(3, 3)` → `{ok:true}` (boundary)
- ChatInput/ChatScreen wiring is verified via `tsc --noEmit`, `vitest run` (full suite green), and `npm run build`. DOM multi-select + chips tray are validated by the user on-device (no jsdom layout).

## Out of Scope (YAGNI)

- Album/grid rendering in a single bubble (the rejected option; would need DB + schema changes).
- Drag-and-drop / paste-to-attach multiple.
- Per-file upload progress bars (single aggregate "k/N" is enough).
- An AttachmentSheet upsell row for free users (the disabled `multiple` is the gate for v1).
