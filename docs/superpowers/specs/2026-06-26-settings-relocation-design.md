# Settings Relocation + Permanent Avatar Glow — Design

**Date:** 2026-06-26
**Status:** Approved (design); ready for implementation
**Area:** `components/ChatHeader.tsx`, `components/RoomInfoModal.tsx`, `components/ChatScreen.tsx`, `components/DashboardScreen.tsx`

## Goal

Three UI relocations/tweaks requested by the user:

1. **Move the chat Settings (gear) menu — Vibration / Sound / Notifications / Theme — out of the chat header and into the Room Info modal** as a new "Preferences" section. The header then carries only Participants + Exit.
2. **Move the Dashboard theme toggle** out of the dashboard top header and **into the account card** (right side of the avatar+name+email row).
3. **Make the Dashboard account-avatar glow permanent** (currently only on hover) at **full** intensity.

No data/RLS/edge/Supabase changes — pure client UI.

## 1. Settings → Room Info

### ChatHeader (`components/ChatHeader.tsx`)
- **Remove** the Settings gear `<button>` and the entire Preferences dropdown JSX (Vibration/Sound/Notifications/Theme), plus the supporting `settingsMenuRef`, `settingsButtonRef`, `closeMenu`, and the `useEffect` that wires outside-click/Escape close.
- **Remove** these props from the interface and the destructure: `showSettingsMenu`, `setShowSettingsMenu`, `canVibrate`, `vibrationEnabled`, `setVibrationEnabled`, `soundEnabled`, `setSoundEnabled`, `notificationsEnabled`, `toggleNotifications`, `isDarkMode`, `toggleTheme`.
- **Remove** now-unused icon imports: `Settings`, `Vibrate`, `VibrateOff`, `Volume2`, `VolumeX`, `Bell`, `BellOff`, `Sun`, `Moon`. Keep `Users`, `LogOut`, `Timer`, `Hourglass`.
- Header right cluster ends up: Participants button + Exit button.

### RoomInfoModal (`components/RoomInfoModal.tsx`)
- **Add** props: `canVibrate: boolean`, `vibrationEnabled: boolean`, `onToggleVibration: () => void`, `soundEnabled: boolean`, `onToggleSound: () => void`, `notificationsEnabled: boolean`, `onToggleNotifications: () => void`, `isDarkMode: boolean`, `onToggleTheme: () => void`.
- **Add** a new `<SectionLabel>Preferences</SectionLabel>` section placed **after the "Room" section (after the Email-alerts row) and before the Danger-zone divider**, containing:
  - **Vibration** (only rendered when `canVibrate`) — `Row` with a toggle switch (mirror the existing AI/Approval switch markup), `onClick={onToggleVibration}`, icon `Vibrate`/`VibrateOff` by state.
  - **Sound** — `Row` + toggle switch, `onClick={onToggleSound}`, icon `Volume2`/`VolumeX`.
  - **Notifications** — `Row` + toggle switch, `onClick={onToggleNotifications}`, icon `Bell`/`BellOff`.
  - **Theme** — `Row`, icon `isDarkMode ? Sun : Moon`, label "Theme", trailing text `isDarkMode ? 'Dark' : 'Light'` (no chevron), `onClick={onToggleTheme}`.
- These rows toggle in place (call the handler directly, **do not** `go()`/close the modal — matching the existing AI and Approval toggle rows).
- **Add** icon imports: `Vibrate`, `VibrateOff`, `Volume2`, `VolumeX`, `Bell`, `BellOff`, `Sun`, `Moon`.
- Reuse the existing switch visual:
  ```tsx
  <span role="switch" aria-checked={on} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
  </span>
  ```

### ChatScreen (`components/ChatScreen.tsx`)
- In the `<ChatHeader … />` call, **remove** the 11 settings props now gone from ChatHeader (`showSettingsMenu`, `setShowSettingsMenu`, `canVibrate`, `vibrationEnabled`, `setVibrationEnabled`, `soundEnabled`, `setSoundEnabled`, `notificationsEnabled`, `toggleNotifications`, `isDarkMode`, `toggleTheme`).
- In the `<RoomInfoModal … />` call, **add**: `canVibrate={canVibrate}`, `vibrationEnabled={vibrationEnabled}`, `onToggleVibration={() => setVibrationEnabled(v => !v)}`, `soundEnabled={soundEnabled}`, `onToggleSound={() => setSoundEnabled(v => !v)}`, `notificationsEnabled={notificationsEnabled}`, `onToggleNotifications={toggleNotifications}`, `isDarkMode={isDarkMode}`, `onToggleTheme={toggleTheme}`.
- **Remove** the now-unused `const [showSettingsMenu, setShowSettingsMenu] = useState(false);` (line ~211) — it is referenced nowhere else (verified: only the decl and the header prop).
- `setVibrationEnabled`/`setSoundEnabled` are `useState` setters; the existing header passed them directly. The Room Info toggles wrap them as `() => setX(v => !v)` so the modal exposes a clean `onToggle*` boolean-flip handler. `toggleNotifications` is already a no-arg async handler.

## 2. Dashboard theme toggle → account card

`components/DashboardScreen.tsx`:
- **Remove** the standalone theme `<button onClick={toggleTheme} …>` from the dashboard header (~line 1495). Keep the Logout button and its wrapping `<div className="flex items-center gap-2">`.
- **Add** the same theme toggle into the **collapsed account card row** (the `else` branch, the `flex items-center gap-5` row at ~line 1559) as a trailing child after the name+email `flex-1` block:
  ```tsx
  <button onClick={toggleTheme} aria-label="Toggle light/dark theme" title="Toggle light/dark"
    className="shrink-0 self-center p-2.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-white dark:hover:bg-slate-700 transition-colors shadow-sm">
    {isDark ? <Sun size={16} /> : <Moon size={16} />}
  </button>
  ```
- Shown in the default (collapsed) account view only; the profile-editing view keeps its own Cancel/Save controls (the toggle is not needed there). `toggleTheme`/`isDark` are already in scope.

## 3. Permanent avatar glow (full)

`components/DashboardScreen.tsx` (~line 1561): change the glow div from
```
opacity-0 group-hover/avatar:opacity-100
```
to a permanent full glow:
```
opacity-100
```
Keep `absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition duration-500 blur-sm`. Result: the gradient ring is always visible at full intensity behind the avatar.

## Out of scope / unchanged
- No change to the underlying preference state, persistence (localStorage), notification permission flow, or theme application — only WHERE the controls live.
- No change to the profile editor, plan card, or any data layer.

## Testing
- `tsc` clean; existing Vitest suite stays green (no pure-helper logic changes).
- Manual / Playwright verification: chat header no longer shows a gear; Room Info shows the 4 Preferences rows and they toggle (sound/vibration/notifications switches flip, theme flips light/dark live); dashboard header has no theme button; account card shows the theme toggle and flips theme; the avatar glow is permanently visible.
- Adversarial review (Workflow) before push, per the session pattern.
