# Viber-style Translucent Bars + Full-bleed Wallpaper — Design

**Date:** 2026-06-26
**Status:** Approved (design); ready for implementation plan
**Area:** `components/ChatScreen.tsx`, `components/ChatHeader.tsx`, `components/ChatInput.tsx`, `index.css`

## Goal

Give the chat room the Viber/Telegram/iMessage "frosted glass" feel: the **header and footer become translucent glass**, the **message list scrolls *behind* both bars** (messages blur through them as you scroll), and the **room wallpaper renders full-bleed behind everything** instead of only inside the scroll area.

One sentence: *messages slide under translucent top/bottom bars, with the wallpaper bleeding behind all of it.*

## Current state (what we're changing)

`ChatScreen` root is a flex column with five in-flow children:

```
root (fixed inset-0, flex flex-col, h-[100dvh], bg-slate-100/900, overflow-hidden)
  <ChatHeader>            glass-panel (rgba .85/.90 + blur 12px), sticky top-0, z-30
  {showSearch && <div>}   in-flow search bar
  {pinned && <div>}       in-flow pinned-message bar
  <main>                  flex-1 overflow-y-auto, p-4 pb-20; WALLPAPER is its inline background
    <MessageList/>
    <div ref=messagesEndRef/>
  {!roomDeleted && <> partialBatch line + <ChatInput> </>}   footer SOLID bg-white/slate-900, z-20
```

Why the effect is absent today: the scroller is a **sibling below** the header, not behind it. The header's existing translucency only reveals the flat root background — never messages or wallpaper. The footer is fully opaque. Messages never pass under either bar.

All other overlays in the root (RoomDeletedToast, QuotaNudge, WaitingApproval, AccessRequestPrompt, accessError portal, offline pill, CallManager, scroll-down button) are already `fixed`/portal/`absolute` and are **unaffected** by this change.

## Target structure

Root stops being a flex column and becomes a positioning context (it already is — `position: fixed` on mobile, `md:relative` on desktop — so no class needed beyond removing `flex flex-col`). Four stacked layers:

```
root (fixed/md:relative, h-[100dvh], overflow-hidden, bg-slate-100/900 = final fallback)
  ├─ WallpaperLayer   absolute inset-0  z-0   pointer-events-none aria-hidden, style=getRoomBackgroundStyle(...)
  ├─ <main> scroller  absolute inset-0  z-10  overflow-y-auto overflow-x-clip overscroll-contain
  │     (transparent bg; paddingTop/Bottom driven by CSS vars — see below)
  │     <MessageList/>
  │     <div ref=messagesEndRef/>
  ├─ TopBars wrap     absolute top-0 inset-x-0  z-30  ref=topBarRef   (header + search + pinned)
  └─ BottomBar wrap   absolute bottom-0 inset-x-0  z-20  ref=bottomBarRef  (partialBatch + ChatInput)
```

Paint order (back→front): wallpaper → messages → footer glass → top glass. Each bar's `backdrop-filter` blurs the wallpaper **and** the messages that geometrically sit behind it, which is the effect.

## Components / units

### 1. Wallpaper layer (ChatScreen)

A new first child:

```tsx
<div
  aria-hidden
  className="absolute inset-0 z-0 pointer-events-none"
  style={getRoomBackgroundStyle({ type: bgType === 'image' && !bgReady ? 'preset' : bgType, preset: bgPreset, url: bgUrl }, isDarkMode)}
/>
```

The identical style object currently lives on `<main>`. Move it here verbatim (same `bgType`/`bgReady`/`bgPreset`/`bgUrl` guard). `<main>` keeps no background. Root keeps `bg-slate-100 dark:bg-slate-900` as the ultimate fallback behind a transparent preset (presets are opaque today, so this is belt-and-suspenders).

### 2. `<main>` scroller (ChatScreen)

```tsx
<main
  ref={mainRef}
  onScroll={handleMainScroll}
  className="absolute inset-0 z-10 overflow-y-auto overflow-x-clip overscroll-contain px-4 transition-colors"
  style={{
    paddingTop: 'calc(var(--chat-top-h, 4rem) + 0.5rem)',
    paddingBottom: 'calc(var(--chat-bottom-h, 4rem) + 0.5rem)',
  }}
>
```

- Was `relative flex-1 ... p-4 pb-20` + wallpaper inline style.
- Now `absolute inset-0 z-10`, horizontal gutter kept via `px-4`, vertical padding driven by the measured bar heights (+ 0.5rem breathing gap). Fallbacks (`4rem`) cover the pre-measure first frame.
- `clientHeight` now equals the full root height; the bottom/top padding creates the resting gaps so the last message sits just above the footer and the first just below the header.

### 3. Bar-height measurement (ChatScreen)

A new `useLayoutEffect` (runs before paint → no flash) that writes CSS custom properties **directly to the root DOM node** (no React state → MessageList/MessageItem `React.memo` stays effective, no re-render on textarea growth):

```tsx
useLayoutEffect(() => {
  const root = rootRef.current;
  if (!root) return;
  const update = () => {
    const t = topBarRef.current;
    const b = bottomBarRef.current;
    root.style.setProperty('--chat-top-h', `${t ? t.offsetHeight : 0}px`);
    root.style.setProperty('--chat-bottom-h', `${b ? b.offsetHeight : 0}px`);
  };
  update();
  const ro = new ResizeObserver(update);
  if (topBarRef.current) ro.observe(topBarRef.current);
  if (bottomBarRef.current) ro.observe(bottomBarRef.current);
  return () => ro.disconnect();
}, [roomDeleted]);
```

- `roomDeleted` dep re-grabs `bottomBarRef` when the footer mounts/unmounts (footer block is gated on `!roomDeleted`).
- Search bar / pinned bar appear inside the top wrapper → they change the wrapper's height → ResizeObserver fires. No extra deps needed for them.
- Reply/edit banners, selected-files row, multiline textarea, partialBatch line all live inside the bottom wrapper → ResizeObserver catches every height change.

### 4. Top bars wrapper (ChatScreen)

Wrap the existing `<ChatHeader>`, `{showSearch && …}`, and `{pinnedMessageId && …}` in:

```tsx
<div ref={topBarRef} className="absolute top-0 inset-x-0 z-30">
  <ChatHeader … />
  {showSearch && (…)}
  {pinnedMessageId && pinnedPreviewText && !roomDeleted && (…)}
</div>
```

These three were previously in flow between header and main; they must move into the absolute top stack or they'd collapse/overlap once `<main>` is absolute. Their inner markup is unchanged.

### 5. Bottom bar wrapper (ChatScreen)

Wrap the existing `{!roomDeleted && <> partialBatch + <ChatInput/> </>}` block in:

```tsx
<div ref={bottomBarRef} className="absolute bottom-0 inset-x-0 z-20">
  {!roomDeleted && (<> … <ChatInput … /> </>)}
</div>
```

The scroll-down pill (`absolute bottom-24 right-4 z-30`) stays a direct child of root (not inside this wrapper) so it floats above the glass footer; z-30 > footer z-20.

### 6. Glass styling (`index.css` + ChatHeader + ChatInput)

New CSS class (placed after `@tailwind utilities`, like `.glass-panel`):

```css
.glass-bar {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
}
.dark .glass-bar {
  background: rgba(15, 23, 42, 0.72);
}
.glass-bar-top    { border-bottom: 1px solid rgba(0, 0, 0, 0.06); }
.dark .glass-bar-top    { border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
.glass-bar-bottom { border-top: 1px solid rgba(0, 0, 0, 0.06); }
.dark .glass-bar-bottom { border-top: 1px solid rgba(255, 255, 255, 0.06); }
```

- **ChatHeader** `<header>`: `glass-panel` → `glass-bar glass-bar-top`. Keep `px-4 py-3 … z-30 … shadow-sm pt-[calc(0.75rem+env(safe-area-inset-top))]`. Drop `sticky top-0` (redundant inside an absolute wrapper).
- **ChatInput** `<footer>`: replace `bg-white dark:bg-slate-900` with `glass-bar glass-bar-bottom`. Keep `p-1.5 shadow-lg z-20 relative pb-[max(0.5rem,env(safe-area-inset-bottom))] …`. The textarea pill keeps its solid `bg-slate-100 dark:bg-slate-800` (legibility while typing) — unchanged.

Translucency 0.72 + blur 16px is the starting point; it is a single-number tweak post-device-test if text legibility over a bright wallpaper suffers.

### 7. Optional polish — jump targets clear the bars

Give message bubbles `scroll-margin-top: var(--chat-top-h)` and `scroll-margin-bottom: var(--chat-bottom-h)` so `scrollIntoView({block:'center'})` jumps (pinned / reply-jump / search hit) don't tuck a bubble under a glass bar. Implement only if a jump visibly lands under a bar in testing; otherwise skip (YAGNI).

## Scroll correctness (verified against current code)

With `clientHeight = H` (full root), content height `M`, top pad `T`, bottom pad `B`:

- `scrollHeight = T + M + B`; `scrollTop_max = scrollHeight − H`.
- **At max scroll:** viewport shows `[scrollTop_max, scrollTop_max + H]`; content ends at `T + M`; the bottom `B` px is padding, exactly covered by the footer overlay → last message rests just above the footer.
- **At scrollTop 0:** top `T` px is padding, covered by the header overlay → first message rests just below the header.
- `scrollToBottom` = `messagesEndRef.scrollIntoView({behavior})`: end-ref sits at `y = T + M`; the browser clamps to `scrollTop_max` (because `H ≫ B`), landing exactly at the bottom. Works unchanged.
- `handleMainScroll`'s `distanceFromBottom = scrollHeight − scrollTop − clientHeight` still yields 0 at max scroll → `atBottom` and the 80/240px thresholds behave as before.

No change required to `scrollToBottom`, `handleMainScroll`, or the first-load/new-message scroll effects.

## iOS PWA / keyboard (verified against current code)

The existing `visualViewport` effect (ChatScreen ~line 1698) pins the root to `vv.height` + `translateY(vv.offsetTop)` on mobile when the keyboard opens. With the footer as `absolute bottom-0` inside that root, the footer tracks the bottom of the (resized) root — i.e. it stays just above the keyboard, exactly as the current last-flex-child footer does. No change to this effect.

Safe-area insets are preserved on the bars (header top, footer bottom). `status-bar-style` stays `default` (do **not** touch — prior regression, see memory `incognitochat-pwa-layout`).

## Risks → device-test after deploy (iOS PWA, the established pattern)

1. **Keyboard open** — composer stays fully visible above the keyboard; no gap/overlap.
2. **Resting positions** — scroll-to-bottom leaves the last message just above the footer; "Load earlier" / top leaves the first message just below the header (not tucked under).
3. **Blur performance** — scrolling a long message list with two `backdrop-filter` bars stays smooth. If it janks on an older device, reduce the blur radius (16px → 12px) and/or drop `saturate`.
4. **Banners/multiline** — opening reply/edit/files/poll-composer and growing the textarea correctly grows the bottom gap (ResizeObserver).

## Out of scope / explicitly unchanged

- No data/RLS/Supabase/edge changes — pure client layout/CSS.
- No change to the keyboard `visualViewport` handler, `status-bar-style`, or safe-area scheme.
- No virtualization or scroll-restoration changes.
- Wallpaper presets, picker, and `getRoomBackgroundStyle` signature unchanged (only the element it's applied to moves).

## Testing

- `tsc` clean; existing Vitest suite (`npm run test -- --run`) stays green (no pure-helper logic changes; this is layout/CSS). No new unit tests warranted — the change is structural CSS with no new testable pure function. The ResizeObserver wiring is verified by manual/device test, not unit test.
- Manual device test per the four risks above before considering done.
