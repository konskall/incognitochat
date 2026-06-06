import { describe, it, expect } from 'vitest';
import { ROOM_BG_PRESETS, getRoomBackgroundStyle } from './roomBackgrounds';

describe('getRoomBackgroundStyle', () => {
  it('returns a cover image style for a custom image appearance', () => {
    const style = getRoomBackgroundStyle({ type: 'image', url: 'https://x/y.png' }, true);
    expect(style.backgroundImage).toBe('url(https://x/y.png)');
    expect(style.backgroundSize).toBe('cover');
  });

  it('resolves a known preset by key', () => {
    const aurora = ROOM_BG_PRESETS.find((p) => p.key === 'aurora')!;
    expect(getRoomBackgroundStyle({ type: 'preset', preset: 'aurora' }, true))
      .toEqual(aurora.style(true));
  });

  it('falls back to the first preset for an unknown/empty preset', () => {
    expect(getRoomBackgroundStyle({ type: 'preset', preset: 'does-not-exist' }, false))
      .toEqual(ROOM_BG_PRESETS[0].style(false));
  });

  it('is theme-aware (dark vs light differ)', () => {
    const dark = getRoomBackgroundStyle({ type: 'preset', preset: 'dots' }, true);
    const light = getRoomBackgroundStyle({ type: 'preset', preset: 'dots' }, false);
    expect(dark.backgroundColor).not.toBe(light.backgroundColor);
  });
});
