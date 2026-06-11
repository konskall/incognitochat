import { describe, it, expect } from 'vitest';
import { clampBox, nearestCorner } from './useDragResize';

describe('clampBox', () => {
  it('keeps a box inside the viewport', () => {
    expect(clampBox({ x: -50, y: -50, w: 100, h: 100 }, 800, 600)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(clampBox({ x: 9999, y: 9999, w: 100, h: 100 }, 800, 600)).toEqual({ x: 700, y: 500, w: 100, h: 100 });
  });
  it('caps size to the viewport', () => {
    expect(clampBox({ x: 0, y: 0, w: 2000, h: 2000 }, 800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
});

describe('nearestCorner', () => {
  it('snaps a point box to the closest viewport corner with margin', () => {
    expect(nearestCorner({ x: 10, y: 10, w: 100, h: 100 }, 800, 600, 16)).toMatchObject({ x: 16, y: 16 });
    expect(nearestCorner({ x: 700, y: 500, w: 100, h: 100 }, 800, 600, 16)).toMatchObject({ x: 800 - 100 - 16, y: 600 - 100 - 16 });
  });
});

describe('clampBox with inset', () => {
  const inset = { top: 50, right: 10, bottom: 100, left: 10 };
  it('keeps the box clear of the inset edges (e.g. top bar + controls)', () => {
    expect(clampBox({ x: 0, y: 0, w: 100, h: 100 }, 800, 600, inset)).toEqual({ x: 10, y: 50, w: 100, h: 100 });
    expect(clampBox({ x: 9999, y: 9999, w: 100, h: 100 }, 800, 600, inset)).toEqual({ x: 690, y: 400, w: 100, h: 100 });
  });
});

describe('nearestCorner with inset', () => {
  it('snaps within the inset area', () => {
    const inset = { top: 50, right: 10, bottom: 100, left: 10 };
    expect(nearestCorner({ x: 700, y: 500, w: 100, h: 100 }, 800, 600, 12, inset)).toMatchObject({ x: 678, y: 388 });
    expect(nearestCorner({ x: 0, y: 0, w: 100, h: 100 }, 800, 600, 12, inset)).toMatchObject({ x: 22, y: 62 });
  });
});
