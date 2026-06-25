import { describe, it, expect } from 'vitest';
import { sameLocalDay, dayLabel, fullDateTime } from './dateSeparators';

// Fixed "now" for deterministic labels: 26 Jun 2026, local.
const NOW = new Date(2026, 5, 26, 22, 0, 0);

describe('sameLocalDay', () => {
  it('true for same local calendar day, false otherwise', () => {
    expect(sameLocalDay(new Date(2026, 5, 26, 1, 0), new Date(2026, 5, 26, 23, 0))).toBe(true);
    expect(sameLocalDay(new Date(2026, 5, 26, 23, 59), new Date(2026, 5, 27, 0, 1))).toBe(false);
  });
  it('false for invalid input', () => {
    expect(sameLocalDay('nonsense', new Date())).toBe(false);
  });
});

describe('dayLabel', () => {
  it('returns Today / Yesterday relative to now', () => {
    expect(dayLabel(new Date(2026, 5, 26, 9, 0), NOW)).toBe('Today');
    expect(dayLabel(new Date(2026, 5, 25, 9, 0), NOW)).toBe('Yesterday');
  });
  it('handles month/year rollover for "Yesterday"', () => {
    const jan1 = new Date(2026, 0, 1, 8, 0);
    expect(dayLabel(new Date(2025, 11, 31, 8, 0), jan1)).toBe('Yesterday');
  });
  it('older same-year date omits the year; cross-year includes it', () => {
    expect(dayLabel(new Date(2026, 5, 23, 9, 0), NOW)).toBe(
      new Date(2026, 5, 23).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    );
    expect(dayLabel(new Date(2025, 5, 23, 9, 0), NOW)).toBe(
      new Date(2025, 5, 23).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    );
  });
  it('returns empty string for invalid input', () => {
    expect(dayLabel('not-a-date', NOW)).toBe('');
  });
});

describe('fullDateTime', () => {
  it('formats a full date + 24h time', () => {
    expect(fullDateTime(new Date(2026, 5, 26, 22, 2))).toBe(
      new Date(2026, 5, 26, 22, 2).toLocaleString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }),
    );
  });
  it('returns empty string for invalid input', () => {
    expect(fullDateTime('nope')).toBe('');
  });
});
