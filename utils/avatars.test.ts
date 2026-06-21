import { describe, it, expect } from 'vitest';
import { buildLiveAvatars, resolveDisplayAvatar } from './avatars';

describe('buildLiveAvatars', () => {
  it('uses roster avatars for members not currently present (offline)', () => {
    const m = buildLiveAvatars([{ uid: 'a', avatar_url: 'https://x/a.jpg' }], []);
    expect(m.get('a')).toBe('https://x/a.jpg');
  });

  it('lets live presence override the roster for online users (freshest wins)', () => {
    const m = buildLiveAvatars(
      [{ uid: 'a', avatar_url: 'https://x/old.jpg' }],
      [{ uid: 'a', avatar: 'https://x/new.jpg' }],
    );
    expect(m.get('a')).toBe('https://x/new.jpg');
  });

  it('skips empty / whitespace values instead of clobbering a good one', () => {
    const m = buildLiveAvatars(
      [{ uid: 'a', avatar_url: 'https://x/a.jpg' }],
      [{ uid: 'a', avatar: '   ' }],
    );
    expect(m.get('a')).toBe('https://x/a.jpg');
  });

  it('ignores null/empty roster entries (no map entry)', () => {
    const m = buildLiveAvatars([{ uid: 'a', avatar_url: null }, { uid: 'b', avatar_url: '' }], []);
    expect(m.has('a')).toBe(false);
    expect(m.has('b')).toBe(false);
  });
});

describe('resolveDisplayAvatar', () => {
  const live = new Map<string, string>([['a', 'https://x/live.jpg']]);

  it('returns the live avatar when present', () => {
    expect(resolveDisplayAvatar('a', 'https://x/baked.jpg', live)).toBe('https://x/live.jpg');
  });

  it('falls back to the baked message avatar when uid is unknown', () => {
    expect(resolveDisplayAvatar('z', 'https://x/baked.jpg', live)).toBe('https://x/baked.jpg');
  });

  it('returns empty string when nothing is known', () => {
    expect(resolveDisplayAvatar('z', null, live)).toBe('');
    expect(resolveDisplayAvatar('z', undefined, new Map())).toBe('');
  });
});
