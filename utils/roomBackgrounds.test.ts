import { describe, it, expect } from 'vitest';
import { ROOM_BG_PRESETS, getRoomBackgroundStyle } from './roomBackgrounds';

describe('getRoomBackgroundStyle', () => {
  it('returns a quoted cover image style for an https custom image', () => {
    const style = getRoomBackgroundStyle({ type: 'image', url: 'https://x/y.png' }, true);
    expect(style.backgroundImage).toBe('url("https://x/y.png")');
    expect(style.backgroundSize).toBe('cover');
  });

  it('ignores a non-https image url and falls back to the default preset', () => {
    const style = getRoomBackgroundStyle({ type: 'image', url: 'http://x/y.png' }, false);
    expect(style).toEqual(ROOM_BG_PRESETS[0].style(false));
  });

  it('escapes characters that could break out of the CSS url()', () => {
    const style = getRoomBackgroundStyle({ type: 'image', url: 'https://x/y.png")alert(1)("' }, true);
    // The embedded quote/paren are percent-encoded, so the raw breakout sequence
    // is gone and the value sits inside a single url("...") wrapper.
    expect(style.backgroundImage).not.toContain('png")');
    expect(style.backgroundImage).toContain('%22');
    expect(style.backgroundImage?.startsWith('url("https://')).toBe(true);
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
