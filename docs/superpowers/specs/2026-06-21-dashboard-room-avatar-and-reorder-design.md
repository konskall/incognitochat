# Dashboard: Room Avatar on Card + Reorder With Favorites — Design

**Date:** 2026-06-21
**Status:** Approved (verbal), pending spec review
**Goal:** (1) Show each room's avatar at the top-left of its dashboard card. (2) Allow drag-reordering even when some rooms are favorited — favorites stay pinned to the top, reordering works within each group.

Both changes are confined to `components/DashboardScreen.tsx` plus one field on the `Room` type in `types.ts`. No DB/schema/RPC changes.

## Decisions (locked)

- **Avatar source:** `room.avatar_url` (already fetched via `select('*')`, just not typed/rendered). Sanitized with the existing `safeAvatarUrl`. Fallback when absent: a gradient circle with the room's first two initials (mirrors `ChatHeader`).
- **Avatar placement:** leading element of the card header — `[GripVertical] [avatar] [name]`. The drag-handle grip stays (drag affordance); the avatar is inserted between it and the name.
- **Reorder model (option A):** favorites remain pinned to the top (the ★ keeps its "Pin to top" meaning). Drag is enabled whenever the displayed list is the full set in persistable order — i.e. no search, `filter === 'all'`, no archived rooms, not in select-mode — **regardless of favorites**. Reordering works within the favorites group and within the non-favorites group. A drop that would cross the favorite/non-favorite boundary settles at that group's edge (favorites re-pinned to top on drop).

## Global Constraints (from project)

- React 18 + TS + Vite + Tailwind; `noUnusedLocals` + `noUnusedParameters` ON.
- App UI copy is English (conversation Greek).
- Dashboard order persists per-user in `room_settings.sort_order` (server-side) via the existing `persistOrder` batched upsert — unchanged.
- Drag/drop uses `@dnd-kit`. Search/filter/archived/select-mode still disable drag (only the favorites restriction is lifted).

## Architecture & Components

### `types.ts` — `Room` interface
Add one optional field (the column exists in the DB and is returned by `select('*')`):
```ts
avatar_url?: string | null; // room's own avatar (collaborative, any member can set)
```

### `components/DashboardScreen.tsx`

**(A) `RoomCardInner` header (~line 211-213).** Insert an avatar between the `GripVertical` and the room name `<span>`:
- If `room.avatar_url` → `<img src={safeAvatarUrl(room.avatar_url)} … className="w-6 h-6 rounded-full object-cover …" onError fallback>`.
- Else → a `w-6 h-6` gradient circle showing `name.substring(0,2).toUpperCase()` (same blue→indigo gradient as `ChatHeader`).
- The avatar is `shrink-0` so the name keeps truncating. Purely presentational; no new props (it reads `room` already in scope).

**(B) `dragEnabled` (~line 1173).** Remove the `favorites.size === 0` clause:
```ts
const dragEnabled = query.trim() === '' && filter === 'all' && !anyArchived && !selectMode;
```

**(C) `displayRooms` (~line 1175-1192).** Remove the `if (dragEnabled) return rooms;` early return so the memo ALWAYS returns the filtered + favorites-first grouping. When `dragEnabled` is true (filter all / no query / no archived), `filtered` equals all rooms, so the result is just `[...favs, ...rest]` — which becomes the canonical displayed order the drag operates on and persists.

**(D) `handleDragEnd` (~line 1142-1153).** Reorder against the **displayed** (grouped) list, then re-pin favorites to the top before persisting:
```ts
const handleDragEnd = (event: DragEndEvent) => {
  setActiveDragKey(null);
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const shown = displayRooms;                      // grouped, what the user sees
  const oldIndex = shown.findIndex((r) => r.room_key === active.id);
  const newIndex = shown.findIndex((r) => r.room_key === over.id);
  if (oldIndex === -1 || newIndex === -1) return;
  const moved = arrayMove(shown, oldIndex, newIndex);
  // Favorites stay on top: a cross-group drop settles at its group's edge.
  const regrouped = [
    ...moved.filter((r) => favorites.has(r.room_key)),
    ...moved.filter((r) => !favorites.has(r.room_key)),
  ];
  setRooms(regrouped);
  persistOrder(regrouped);
};
```
`handleDragEnd` is recreated each render (not memoized), so it closes over the current `displayRooms` and `favorites` — no refs needed. (The old `roomsRef.current` read is replaced by `displayRooms`.)

**(E) `SortableContext` items.** Must be the displayed order: `items={displayRooms.map((r) => r.room_key)}`. Verify the render maps `displayRooms` and selects `SortableRoomCard` when `dragEnabled` (else `StaticRoomCard`) — unchanged except that `dragEnabled` can now be true with favorites present.

## Data Flow

```
render → displayRooms = [favs-first grouping of filtered rooms]
drag (enabled unless search/filter/archived/select) → dnd reorders displayRooms
drop → arrayMove on displayRooms → re-pin favs to top → setRooms + persistOrder(sort_order 0..n)
next render → displayRooms regroups (idempotent: already favs-first) → stable
```

## Error Handling / Edge Cases

- **Cross-group drop:** regrouping re-pins favorites; the item lands at its group edge (predictable, no desync).
- **No favorites:** `favs` is empty → grouping is a no-op → identical to today's behavior.
- **Search/filter/archived/select-mode:** still render `StaticRoomCard` (drag off) — reordering a hidden/partial list can't persist a correct full order.
- **`persistOrder` failure:** already caught + logged (unchanged); local order still updates optimistically.
- **Missing avatar:** initials-gradient fallback; broken image URL → `onError` swaps to the same fallback.

## Testing

- No new unit tests: this is DOM/dnd + presentational, not pure logic (jsdom has no layout, and `@dnd-kit` drag isn't meaningfully unit-testable here). Existing suite must stay green.
- Verified by `npx tsc --noEmit`, `npx vitest run`, `npm run build`, and on-device manual checks below.

## Manual Verification (post-deploy)

1. Each card shows the room avatar top-left (or initials when none).
2. With **no** favorites: drag reorders as before; order persists across reload.
3. **Favorite** one room → it pins to top; drag still works: reorder among the non-favorites, and (with ≥2 favorites) reorder among favorites. Order persists.
4. Drag a non-favorite toward the top → it settles just below the favorites (doesn't jump above them).
5. Type in search / switch filter / archive a room → cards become non-draggable (unchanged).

## Out of Scope (YAGNI)

- Reordering across the favorite boundary (favorites are pinned by design).
- Drag while searching/filtering/in archived view.
- A separate persisted order for favorites vs the ★ pin (the ★ + sort_order within group is enough).
- Editing the room avatar from the dashboard (already done in-room).
