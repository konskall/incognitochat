// Day-divider helpers for the message list. Messages only render a time (HH:MM),
// so a chip is inserted between days to anchor "which date" a run of messages is
// from. All comparisons are in the viewer's LOCAL day (not UTC) so a divider lands
// on the user's midnight, not the server's.

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

// True when two timestamps fall on the same LOCAL calendar day.
export function sameLocalDay(a: string | Date, b: string | Date): boolean {
  const da = toDate(a), db = toDate(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

// Divider label for a message's day: "Today" / "Yesterday" / a locale date
// ("23 Jun", or "23 Jun 2025" when it isn't the current year). `now` is injectable
// for deterministic tests. Yesterday is derived via the local calendar (DST-safe).
export function dayLabel(iso: string | Date, now: Date = new Date()): string {
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (sameLocalDay(d, now)) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameLocalDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

// Full date + time for the per-message tooltip ("26 Jun 2026, 22:02").
export function fullDateTime(iso: string | Date): string {
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
