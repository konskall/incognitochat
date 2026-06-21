# Dashboard Room Avatar + Reorder-With-Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each room's avatar on its dashboard card, and allow drag-reordering even when rooms are favorited (favorites stay pinned to top; reorder within each group).

**Architecture:** Two independent client-only changes in `components/DashboardScreen.tsx` plus one optional field on `Room` in `types.ts`. No DB/RPC/schema change. Reorder reuses the existing `persistOrder` upsert.

**Tech Stack:** React 18 + TS + Vite + Tailwind; `@dnd-kit`; vitest 2.x.

**Spec:** `docs/superpowers/specs/2026-06-21-dashboard-room-avatar-and-reorder-design.md`.

## Global Constraints

- `tsconfig`: `noUnusedLocals` + `noUnusedParameters` ON — no dead vars/params/imports.
- App UI copy is English (conversation Greek).
- `safeAvatarUrl` is already imported in `DashboardScreen.tsx` (helpers).
- Dashboard order persists via `room_settings.sort_order` (existing `persistOrder`) — do not change its shape.
- Drag stays disabled for search / non-`all` filter / archived present / select-mode; only the favorites restriction is lifted.
- Commit footer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Verify (from repo root): `npx tsc --noEmit`, `npx vitest run`, `npm run build`.
- No meaningful unit tests exist for DOM/dnd/presentational code (jsdom has no layout); each task is verified by tsc + the full vitest suite staying green + build, then on-device manual checks.

---

### Task 1: Room avatar on the dashboard card

**Files:**
- Modify: `types.ts` (`Room` interface, ~line 111-121)
- Modify: `components/DashboardScreen.tsx` (`RoomCardInner` header, ~line 211-213)

**Interfaces:**
- Produces: `Room.avatar_url?: string | null` (read by the card and available elsewhere).

- [ ] **Step 1: Add `avatar_url` to the `Room` type**

In `types.ts`, inside `export interface Room { … }`, add after the `display_name` line (~115):

```ts
  avatar_url?: string | null; // room's own avatar (collaborative; any member can set)
```

- [ ] **Step 2: Render the avatar in the card header**

In `components/DashboardScreen.tsx`, in `RoomCardInner`, replace this block (~line 211-213):

```tsx
          <h4 className="font-bold text-base text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5 min-w-0 flex-1">
            <GripVertical size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
            <span className="truncate" title={name}>{name}</span>
```

with:

```tsx
          <h4 className="font-bold text-base text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5 min-w-0 flex-1">
            <GripVertical size={16} className="text-slate-300 dark:text-slate-600 shrink-0" />
            {room.avatar_url ? (
              <img src={safeAvatarUrl(room.avatar_url)} alt="" width={24} height={24} className="w-6 h-6 rounded-full object-cover shrink-0 bg-slate-200 dark:bg-slate-700 border border-white/40 dark:border-slate-700" />
            ) : (
              <span className="w-6 h-6 rounded-full shrink-0 bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center" aria-hidden>{name.substring(0, 2).toUpperCase()}</span>
            )}
            <span className="truncate" title={name}>{name}</span>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (the `room.avatar_url` access now type-checks via the new field; tombstone-derived rooms simply omit it → `undefined` → initials fallback).

- [ ] **Step 4: Tests + build**

Run: `npx vitest run`
Expected: all suites pass (no regressions).

Run: `npm run build`
Expected: `built in …s`, no errors.

- [ ] **Step 5: Commit**

```bash
git add types.ts components/DashboardScreen.tsx
git commit -m "feat(dashboard): show room avatar on each room card

Adds Room.avatar_url and renders the room's avatar (or an initials gradient
fallback) at the top-left of each dashboard card.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Allow reordering when rooms are favorited

**Files:**
- Modify: `components/DashboardScreen.tsx` — `dragEnabled` (~1173), `displayRooms` (~1175-1192), `handleDragEnd` (~1142-1153), and the drag render branch `SortableContext`/map (~1577-1581).

**Interfaces:**
- Consumes (existing in scope): `query`, `filter`, `anyArchived`, `selectMode`, `favorites: Set<string>`, `rooms: Room[]`, `displayRooms: Room[]`, `arrayMove`, `persistOrder`, `setRooms`, `setActiveDragKey`.

- [ ] **Step 1: Lift the favorites restriction on `dragEnabled`**

Replace (~line 1172-1173):

```ts
  // Drag is enabled only when the displayed order == the saved canonical order.
  const dragEnabled = query.trim() === '' && filter === 'all' && favorites.size === 0 && !anyArchived && !selectMode;
```

with:

```ts
  // Drag is enabled when the displayed list is the full set in a persistable
  // order. Favorites are allowed: they only re-pin to the top (handled in
  // displayRooms + handleDragEnd), they never hide rooms. Search / non-'all'
  // filter / archived / select-mode still disable it (partial or hidden lists).
  const dragEnabled = query.trim() === '' && filter === 'all' && !anyArchived && !selectMode;
```

- [ ] **Step 2: Make `displayRooms` always return the favorites-first grouping**

Replace the early-return line at the top of the `displayRooms` memo (~line 1176):

```ts
    if (dragEnabled) return rooms;
```

with (delete that line entirely). The memo then always computes `filtered` then `[...favs, ...rest]`. When `dragEnabled` is true (filter `all`, no query, no archived) `filtered` equals all rooms, so the result is the favorites-first grouping that both the drag UI and `persistOrder` use. Leave the rest of the memo body and its dependency array unchanged (it already depends on `dragEnabled, rooms, query, filter, favorites, settings, isUnread, user.uid`).

- [ ] **Step 3: Reorder against the displayed list and re-pin favorites on drop**

Replace `handleDragEnd` (~line 1142-1153):

```ts
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragKey(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const prev = roomsRef.current;
    const oldIndex = prev.findIndex((r) => r.room_key === active.id);
    const newIndex = prev.findIndex((r) => r.room_key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(prev, oldIndex, newIndex);
    setRooms(next);
    persistOrder(next);
  };
```

with:

```ts
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragKey(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Reorder against the DISPLAYED (favorites-first) list — that's what the
    // user sees and drags. handleDragEnd is recreated each render, so it closes
    // over the current displayRooms/favorites (no refs needed).
    const shown = displayRooms;
    const oldIndex = shown.findIndex((r) => r.room_key === active.id);
    const newIndex = shown.findIndex((r) => r.room_key === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const moved = arrayMove(shown, oldIndex, newIndex);
    // Favorites stay pinned to the top: a cross-group drop settles at its
    // group's edge. Then persist the full order (sort_order 0..n).
    const regrouped = [
      ...moved.filter((r) => favorites.has(r.room_key)),
      ...moved.filter((r) => !favorites.has(r.room_key)),
    ];
    setRooms(regrouped);
    persistOrder(regrouped);
  };
```

- [ ] **Step 4: Render the Sortable list from `displayRooms` (not raw `rooms`)**

In the `dragEnabled ?` branch (~line 1577-1581), change both the `SortableContext` items and the map to use `displayRooms`:

```tsx
                                <SortableContext items={displayRooms.map((r) => r.room_key)} strategy={rectSortingStrategy}>
                                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
                                        {displayRooms.map((room) => (
                                            <SortableRoomCard key={room.room_key} room={room} {...cardPropsFor(room)} />
                                        ))}
                                    </div>
                                </SortableContext>
```

(Only `rooms` → `displayRooms` in those two places; everything else in the branch — `DndContext`, `DragOverlay` — stays.)

- [ ] **Step 5: Leave `roomsRef` as-is**

`handleDragEnd` no longer reads `roomsRef.current`, but `roomsRef` is still used by the realtime message handler (`DashboardScreen.tsx:599` — `roomsRef.current.find(...)`), so it stays declared/assigned (lines ~591-592). No removal — it will not be flagged as unused.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Tests + build**

Run: `npx vitest run`
Expected: all suites pass.

Run: `npm run build`
Expected: `built in …s`, no errors.

- [ ] **Step 8: Commit**

```bash
git add components/DashboardScreen.tsx
git commit -m "feat(dashboard): reorder rooms even with favorites pinned

Lifts the favorites-blocks-drag limitation. Favorites stay pinned to the top;
drag reorders within each group and persists via room_settings.sort_order. A
cross-group drop settles at the group edge (favorites re-pinned on drop).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Manual verification (post-deploy, by the user)

1. Each room card shows the room avatar top-left (initials gradient when the room has no avatar).
2. No favorites: drag reorders as before; order survives reload.
3. Favorite a room → pins to top; drag still works — reorder among non-favorites (and among favorites if ≥2); order persists.
4. Drag a non-favorite toward the top → settles just below the favorites, never above.
5. Search / switch filter / archive a room → cards become non-draggable (unchanged).
