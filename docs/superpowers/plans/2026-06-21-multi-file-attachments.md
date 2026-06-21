# Multiple File Attachments (Basic+) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Basic/Ultra users select and send several files at once, each as its own message; free users stay single-file.

**Architecture:** Reuse the existing single-file pipeline (`uploadFile` → `sendMessage`) once per file in a sequential loop. Gate multi-select behind a new `canMultiUpload` entitlement (the `<input multiple>` attribute is the gate). No DB/schema/edge/storage changes.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind; vitest 2.x. Spec: `docs/superpowers/specs/2026-06-21-multi-file-attachments-design.md`.

## Global Constraints

- `tsconfig` has `noUnusedLocals` + `noUnusedParameters` ON — no dead vars/params.
- App UI copy is **English** (conversation with the user is Greek).
- Caption + reply attach to the **first** file's message only; the rest are bare.
- **Max 10** files per send (`MAX_FILES_PER_SEND`).
- Each file respects the tier's `maxFileBytes` (Basic 10 MB, Ultra 40 MB); oversized files skipped at selection.
- Each file = one `messages` insert → counts toward the daily quota; the DB raises `QT002` on the over-limit insert. One notification per batch.
- NEVER change DB schema, RLS, edge functions, or storage layout.
- Commit footer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Verify commands (Windows, run from repo root): `npx tsc --noEmit`, `npx vitest run`, `npm run build`.

---

### Task 1: Entitlement flag + batch-gate helper

**Files:**
- Modify: `utils/entitlements.ts` (interface ~7-19, `TIER_CONFIG` ~23-39; append `MAX_FILES_PER_SEND` + `canSendBatch` after `messagesRemaining` ~67)
- Test: `utils/entitlements.test.ts`

**Interfaces:**
- Consumes: existing `Tier` type, `TIER_CONFIG`.
- Produces:
  - `TierEntitlements.canMultiUpload: boolean`
  - `export const MAX_FILES_PER_SEND = 10`
  - `export function canSendBatch(count: number, quotaLeft: number | null, maxFiles?: number): { ok: true } | { ok: false; reason: 'empty' | 'max' | 'quota'; limit: number }`

- [ ] **Step 1: Write the failing tests**

Append to `utils/entitlements.test.ts` (inside the existing top-level `describe`, or as a new `describe`). Add the import at the top if missing: `import { canSendBatch, MAX_FILES_PER_SEND } from './entitlements';` (extend the existing import line from `./entitlements`).

```ts
describe('canMultiUpload', () => {
  it('is premium-only', () => {
    expect(entitlements('free').canMultiUpload).toBe(false);
    expect(entitlements('basic').canMultiUpload).toBe(true);
    expect(entitlements('ultra').canMultiUpload).toBe(true);
  });
});

describe('canSendBatch', () => {
  it('rejects empty selections', () => {
    expect(canSendBatch(0, null)).toEqual({ ok: false, reason: 'empty', limit: 0 });
  });
  it('allows within the file ceiling when quota is unlimited', () => {
    expect(canSendBatch(3, null)).toEqual({ ok: true });
    expect(canSendBatch(MAX_FILES_PER_SEND, null)).toEqual({ ok: true });
  });
  it('rejects more than the file ceiling', () => {
    expect(canSendBatch(MAX_FILES_PER_SEND + 1, null)).toEqual({ ok: false, reason: 'max', limit: MAX_FILES_PER_SEND });
  });
  it('rejects when the batch exceeds remaining daily quota', () => {
    expect(canSendBatch(5, 3)).toEqual({ ok: false, reason: 'quota', limit: 3 });
  });
  it('allows when the batch exactly fits remaining quota', () => {
    expect(canSendBatch(3, 3)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run utils/entitlements.test.ts`
Expected: FAIL — `canMultiUpload`/`canSendBatch`/`MAX_FILES_PER_SEND` do not exist (compile/assertion errors).

- [ ] **Step 3: Add the entitlement flag**

In `utils/entitlements.ts`, add to the `TierEntitlements` interface (after `canAI: boolean;`, line ~18):

```ts
  canMultiUpload: boolean; // select & send multiple files at once
```

Then set it in each tier of `TIER_CONFIG`:
- `free`: add `canMultiUpload: false,` to that object.
- `basic`: add `canMultiUpload: true,`.
- `ultra`: add `canMultiUpload: true,`.

(Place each on the existing `canRoomAppearance: …, canAI: …,` line, e.g. free becomes:
`canRoomAppearance: false, canDisappearing: false, canEmailAlerts: false, canAI: false, canMultiUpload: false,`)

- [ ] **Step 4: Add the constant + helper**

Append to the end of `utils/entitlements.ts`:

```ts
// Hard ceiling on how many files one send can attach.
export const MAX_FILES_PER_SEND = 10;

// Can `count` files be sent right now? quotaLeft = remaining messages today
// (null = unlimited). Pure + UI-agnostic so it can be unit-tested.
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run utils/entitlements.test.ts`
Expected: PASS (all new + existing entitlement tests green).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no errors — the new interface field will NOT yet break ChatScreen because ChatScreen reads `ent.maxFileBytes` etc. via the object; adding a field is non-breaking).

- [ ] **Step 7: Commit**

```bash
git add utils/entitlements.ts utils/entitlements.test.ts
git commit -m "feat(entitlements): canMultiUpload flag + canSendBatch batch-gate helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Multi-file composer + sequential batch send

**Files:**
- Modify: `components/ChatInput.tsx` (props ~9-47 & destructure ~49-75; import ~6; `handleFileSelect` ~117-148; `clearFile` ~150-153; tray JSX ~249-262; `<input>` ~292-298; attach-button class ~305; textarea placeholder ~319; mic/send toggle ~333; send button ~343-354)
- Modify: `components/ChatScreen.tsx` (state ~258; import for `canSendBatch`; `handleSend` ~998-1048; `<ChatInput>` props ~1544-1558)

**Interfaces:**
- Consumes (from Task 1): `entitlements(...).canMultiUpload`, `MAX_FILES_PER_SEND`, `canSendBatch(count, quotaLeft)`.
- Consumes (existing, unchanged signatures): `uploadFile(file): Promise<Attachment | null>`, `sendMessage(text, config, attachment, replyTo, location, type): Promise<void>`, `parseTierError(err, tier)`, `promptUpgrade(feature, requiredTier, message?)`, `flashToast(msg)`, `notifySubscribers(kind, text)`, `quotaLeft: number | null`, `ent.maxFileBytes`, `useEntitlements` (`ent`).
- Produces: new `<ChatInput>` prop contract: `selectedFiles: File[]`, `setSelectedFiles: (f: File[]) => void`, `canMultiUpload: boolean`, `uploadProgress?: { current: number; total: number } | null` (replacing `selectedFile`/`setSelectedFile`).

> No unit test: the batch logic lives in a React event handler and the UI is DOM-driven (jsdom has no layout). The pure decision is already covered by `canSendBatch` (Task 1). This task is verified by `tsc` + full `vitest` suite + `npm run build`, and validated on-device by the user. ChatInput and ChatScreen change together because the prop contract swap breaks compilation until both are updated.

- [ ] **Step 1: ChatInput — import the ceiling constant**

In `components/ChatInput.tsx`, change the helpers/entitlements imports. The file imports `compressImage` from `'../utils/helpers'` (line 6). Add a new import line after it:

```ts
import { MAX_FILES_PER_SEND } from '../utils/entitlements';
```

- [ ] **Step 2: ChatInput — swap the props**

Replace the three prop lines (currently `selectedFile`, `setSelectedFile`, `isUploading`, lines ~22-24) with:

```ts
  selectedFiles: File[];
  setSelectedFiles: (files: File[]) => void;
  canMultiUpload: boolean;
  uploadProgress?: { current: number; total: number } | null;
  isUploading: boolean;
```

And in the destructure (lines ~60-62), replace `selectedFile, setSelectedFile, isUploading,` with:

```ts
  selectedFiles,
  setSelectedFiles,
  canMultiUpload,
  uploadProgress,
  isUploading,
```

- [ ] **Step 3: ChatInput — rewrite `handleFileSelect` + `clearFile`**

Replace `handleFileSelect` (lines ~117-148) and `clearFile` (lines ~150-153) with:

```ts
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // Reset NOW so re-picking the same file(s) fires change again. iOS names
    // every camera/library capture "image.jpg", so without this the 2nd pick
    // silently no-ops.
    e.target.value = '';
    if (picked.length === 0) return;

    const limitBytes = maxFileBytes ?? 40 * 1024 * 1024;
    const limitMb = Math.round(limitBytes / (1024 * 1024));
    const accepted: File[] = [];
    const tooBig: string[] = [];

    for (let f of picked) {
      // Always downscale/compress images (GIFs skipped so animation survives).
      if (f.type.startsWith('image/') && f.type !== 'image/gif') {
        try { f = await compressImage(f); } catch (err) { console.error('Compression failed, sending original:', err); }
      }
      if (f.size > limitBytes) { tooBig.push(f.name); continue; }
      accepted.push(f);
    }

    // Accumulate across picks, then clamp to the per-send ceiling.
    const merged = [...selectedFiles, ...accepted];
    const clamped = merged.slice(0, MAX_FILES_PER_SEND);
    const droppedForCap = merged.length - clamped.length;

    setSelectedFiles(clamped);

    if (tooBig.length || droppedForCap > 0) {
      const parts: string[] = [];
      if (tooBig.length) parts.push(`${tooBig.length} file(s) over ${limitMb}MB were skipped.`);
      if (droppedForCap > 0) parts.push(`You can attach up to ${MAX_FILES_PER_SEND} files at once.`);
      alert(parts.join(' '));
    }
  };

  const removeFileAt = (idx: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== idx));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
```

- [ ] **Step 4: ChatInput — replace the single-file pill with a chips tray**

Replace the `{selectedFile && !editingMessageId && ( … )}` block (lines ~249-262) with:

```tsx
             {selectedFiles.length > 0 && !editingMessageId && (
               <div className="flex items-center gap-2 mb-2 w-full overflow-x-auto pb-1 self-start">
                  {selectedFiles.map((file, idx) => (
                    <div key={`${file.name}-${file.size}-${idx}`} className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-slate-800 border border-blue-100 dark:border-slate-700 rounded-xl shrink-0 animate-in slide-in-from-bottom-2">
                       <div className="w-9 h-9 bg-blue-100 dark:bg-slate-700 rounded-lg flex items-center justify-center text-blue-500 dark:text-blue-400">
                         {getFileIcon(file.type)}
                       </div>
                       <div className="flex flex-col">
                         <span className="text-xs font-bold text-slate-700 dark:text-slate-200 max-w-[120px] truncate">{file.name}</span>
                         <span className="text-[10px] text-slate-500 dark:text-slate-400">{(file.size / 1024).toFixed(1)} KB</span>
                       </div>
                       <button onClick={() => removeFileAt(idx)} className="p-1 hover:bg-blue-200 dark:hover:bg-slate-600 rounded-full text-slate-500 transition" aria-label={`Remove ${file.name}`}>
                         <X size={16} />
                       </button>
                    </div>
                  ))}
               </div>
             )}
```

- [ ] **Step 5: ChatInput — enable multi-select + fix the `selectedFile` references**

(a) Add `multiple={canMultiUpload}` to the file `<input>` (lines ~292-298), e.g.:

```tsx
                     <input 
                        type="file" 
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        multiple={canMultiUpload}
                        className="hidden"
                        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.zip,.rar,.7z,.tar"
                     />
```

(b) Attach-button className (line ~305): change `${selectedFile || showAttach ?` to `${selectedFiles.length > 0 || showAttach ?`.

(c) Textarea placeholder (line ~319): change `placeholder={selectedFile ? "Add caption..." :` to `placeholder={selectedFiles.length > 0 ? "Add caption..." :`.

(d) Mic/send toggle condition (line ~333): change `!inputText.trim() && !selectedFile && !editingMessageId && !isUploading` to `!inputText.trim() && selectedFiles.length === 0 && !editingMessageId && !isUploading`.

- [ ] **Step 6: ChatInput — show batch progress on the send button**

Replace the send button's inner content (lines ~343-354) with:

```tsx
                         <button
                            onClick={() => handleSend()}
                            disabled={isOffline || isUploading || !isRoomReady || !!uploadProgress}
                            aria-label="Send message"
                            className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-full shadow-lg shadow-blue-500/30 transition-all transform active:scale-95 flex items-center justify-center flex-shrink-0"
                         >
                             {uploadProgress ? (
                                 <span className="text-[11px] font-bold tabular-nums">{uploadProgress.current}/{uploadProgress.total}</span>
                             ) : isUploading ? (
                                 <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                             ) : (
                                 <Send size={20} className="ml-0.5" />
                             )}
                         </button>
```

- [ ] **Step 7: ChatScreen — state + import**

(a) Replace the file state line (~258) `const [selectedFile, setSelectedFile] = useState<File | null>(null);` with:

```ts
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
```

(b) Add an import near the other util imports (the file already imports hooks; add this line with the entitlements helpers):

```ts
import { canSendBatch } from '../utils/entitlements';
```

- [ ] **Step 8: ChatScreen — rewrite `handleSend`**

Replace the entire `handleSend` function (lines ~998-1048) with:

```ts
  const handleSend = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if ((!inputText.trim() && selectedFiles.length === 0) || !user || roomDeleted) return;

      // Snapshot so a failed send can restore the composer (optimistic clear
      // must not silently eat the user's text/files/reply).
      const textToSend = inputText.trim();
      const filesToSend = selectedFiles;
      const replyToSend = replyingTo;
      const editingId = editingMessageId;

      setInputText('');
      setTyping(false);
      setSelectedFiles([]);
      setReplyingTo(null);

      try {
          if (editingId) {
              await editMessage(editingId, textToSend);
              setEditingMessageId(null);
          } else if (filesToSend.length === 0) {
              // Plain text message (no attachments) — unchanged single-send path.
              await sendMessage(textToSend, config, null, replyToSend, null, 'text');
              setQuotaBump((n) => n + 1);
              notifySubscribers('message', textToSend || 'Sent a file');
          } else {
              // Multi-file: client-side gate first (the DB also enforces the
              // daily quota and raises QT002 on the over-limit insert).
              const gate = canSendBatch(filesToSend.length, quotaLeft);
              if (!gate.ok) {
                  setInputText(textToSend);
                  setSelectedFiles(filesToSend);
                  setReplyingTo(replyToSend);
                  if (gate.reason === 'quota') promptUpgrade('A higher message limit', 'ultra', "You've hit today's limit for this room.");
                  else if (gate.reason === 'max') flashToast(`You can send up to ${gate.limit} files at once.`);
                  return;
              }
              // Send each file as its own message, in order. Caption + reply
              // attach to the FIRST message only; the rest are bare.
              for (let i = 0; i < filesToSend.length; i++) {
                  setUploadProgress({ current: i + 1, total: filesToSend.length });
                  try {
                      const attachment = await uploadFile(filesToSend[i]);
                      await sendMessage(i === 0 ? textToSend : '', config, attachment, i === 0 ? replyToSend : null, null, 'text');
                      if (i === 0) setQuotaBump((n) => n + 1);
                  } catch (err) {
                      // Keep what's already sent; restore the unsent remainder
                      // (plus caption/reply if the first never went) for retry.
                      setUploadProgress(null);
                      setSelectedFiles(filesToSend.slice(i));
                      if (i === 0) { setInputText(textToSend); setReplyingTo(replyToSend); }
                      const tierErr = parseTierError(err, tier);
                      if (tierErr?.code === 'QT002') promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
                      else if (tierErr) flashToast(tierErr.message);
                      else flashToast(`Sent ${i} of ${filesToSend.length} files. Tap send to retry the rest.`);
                      return;
                  }
              }
              setUploadProgress(null);
              setQuotaBump((n) => n + 1);
              notifySubscribers('message', textToSend || `Sent ${filesToSend.length} files`);
          }
      } catch (err) {
          console.error('Send failed', err);
          // Restore composer (covers the editing + text-only paths; the
          // multi-file loop restores its own remainder above before returning).
          setInputText(textToSend);
          if (filesToSend.length === 0) setSelectedFiles(filesToSend);
          setReplyingTo(replyToSend);
          if (editingId) setEditingMessageId(editingId);
          const tierErr = parseTierError(err, tier);
          if (tierErr) {
            if (tierErr.code === 'QT004') {
              promptUpgrade('Inco AI', tierErr.requiredTier);
            } else if (tierErr.code === 'QT002') {
              promptUpgrade('A higher message limit', tierErr.requiredTier, "You've hit today's limit for this room.");
            } else {
              flashToast(tierErr.message);
            }
          }
      }
  };
```

- [ ] **Step 9: ChatScreen — update the `<ChatInput>` props**

In the `<ChatInput … />` block (~1533-1559), replace the two lines:

```tsx
            selectedFile={selectedFile}
            setSelectedFile={setSelectedFile}
```

with:

```tsx
            selectedFiles={selectedFiles}
            setSelectedFiles={setSelectedFiles}
```

and replace the `maxFileBytes={ent.maxFileBytes}` line with:

```tsx
            maxFileBytes={ent.maxFileBytes}
            canMultiUpload={ent.canMultiUpload}
            uploadProgress={uploadProgress}
```

- [ ] **Step 10: Verify no stray `selectedFile` references remain**

Run: `git grep -n "selectedFile\b" -- components/`
Expected: NO matches (all replaced by `selectedFiles`). If any remain (other than `selectedFiles`), fix them.

- [ ] **Step 11: Typecheck, test, build**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx vitest run`
Expected: all suites pass (75 + the new Task 1 tests).

Run: `npm run build`
Expected: `built in …s`, no errors.

- [ ] **Step 12: Commit**

```bash
git add components/ChatInput.tsx components/ChatScreen.tsx
git commit -m "feat(chat): send multiple files at once (Basic+)

Premium users can select up to 10 files; each is sent as its own message,
caption+reply on the first only, with a batch-progress button and one
notification per batch. Free users stay single-file (input has no `multiple`).
Reuses the single-file upload/send pipeline N times — no DB/schema change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification (post-deploy, by the user)

1. **Ultra/Basic user:** 📎 → File → pick 3 images → 3 chips appear → type a caption → Send → button shows `1/3 → 3/3` → 3 separate bubbles, caption on the first, in order.
2. **Remove a chip** before sending → that file isn't sent.
3. **Oversized file** mixed in → it's skipped with an alert; the rest send.
4. **Pick > 10** → clamped to 10 with an alert.
5. **Free user:** the file picker allows only ONE file (no `multiple`); everything else identical to today.
6. **Basic near daily limit** (e.g. 2 left, pick 5) → blocked before upload with the upgrade prompt; nothing sent.
