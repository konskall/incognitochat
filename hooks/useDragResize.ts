import { useCallback, useRef, useState } from 'react';

export interface Box { x: number; y: number; w: number; h: number; }
export interface Inset { top: number; right: number; bottom: number; left: number; }

const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

// Clamp a box so it stays within the viewport MINUS an optional inset (e.g. to
// keep a floating element clear of a top bar / controls bar). Size is capped to
// the available area first.
export function clampBox(b: Box, vw: number, vh: number, inset: Inset = NO_INSET): Box {
  const availW = Math.max(0, vw - inset.left - inset.right);
  const availH = Math.max(0, vh - inset.top - inset.bottom);
  const w = Math.min(b.w, availW); const h = Math.min(b.h, availH);
  const x = Math.min(Math.max(b.x, inset.left), Math.max(inset.left, vw - inset.right - w));
  const y = Math.min(Math.max(b.y, inset.top), Math.max(inset.top, vh - inset.bottom - h));
  return { x, y, w, h };
}

// Snap a box to the nearest corner of the inset viewport area (keeping `margin`
// from the edges of that area).
export function nearestCorner(b: Box, vw: number, vh: number, margin: number, inset: Inset = NO_INSET): Box {
  const left = b.x + b.w / 2 < vw / 2;
  const top = b.y + b.h / 2 < vh / 2;
  const x = left ? inset.left + margin : vw - inset.right - b.w - margin;
  const y = top ? inset.top + margin : vh - inset.bottom - b.h - margin;
  return { ...b, x, y };
}

interface Opts { minW?: number; minH?: number; snap?: boolean; margin?: number; bounds?: Inset; }

// Pointer-based drag (from a handle) + bottom-right resize. Mouse + touch via
// Pointer Events; clamps to the viewport (minus `bounds` insets); optional
// corner-snap on release.
export function useDragResize(initial: Box, opts: Opts = {}) {
  const { minW = 240, minH = 160, snap = false, margin = 12, bounds = NO_INSET } = opts;
  const [box, setBox] = useState<Box>(initial);
  const boxRef = useRef(box); boxRef.current = box;

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const orig = boxRef.current;
    const move = (ev: PointerEvent) => {
      const next = clampBox({ ...orig, x: orig.x + (ev.clientX - startX), y: orig.y + (ev.clientY - startY) }, window.innerWidth, window.innerHeight, bounds);
      setBox(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (snap) setBox((b) => clampBox(nearestCorner(b, window.innerWidth, window.innerHeight, margin, bounds), window.innerWidth, window.innerHeight, bounds));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [snap, margin, bounds]);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const orig = boxRef.current;
    const move = (ev: PointerEvent) => {
      const w = Math.max(minW, orig.w + (ev.clientX - startX));
      const h = Math.max(minH, orig.h + (ev.clientY - startY));
      setBox(clampBox({ ...orig, w, h }, window.innerWidth, window.innerHeight, bounds));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [minW, minH, bounds]);

  return { box, setBox, startDrag, startResize };
}
