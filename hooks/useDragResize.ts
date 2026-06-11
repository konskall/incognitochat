import { useCallback, useRef, useState } from 'react';

export interface Box { x: number; y: number; w: number; h: number; }

// Clamp a box so it stays fully within w×h (size capped to the viewport first).
export function clampBox(b: Box, vw: number, vh: number): Box {
  const w = Math.min(b.w, vw); const h = Math.min(b.h, vh);
  const x = Math.min(Math.max(b.x, 0), Math.max(0, vw - w));
  const y = Math.min(Math.max(b.y, 0), Math.max(0, vh - h));
  return { x, y, w, h };
}

// Snap a box to the nearest viewport corner (keeping `margin` from the edges).
export function nearestCorner(b: Box, vw: number, vh: number, margin: number): Box {
  const left = b.x + b.w / 2 < vw / 2;
  const top = b.y + b.h / 2 < vh / 2;
  const x = left ? margin : vw - b.w - margin;
  const y = top ? margin : vh - b.h - margin;
  return { ...b, x, y };
}

interface Opts { minW?: number; minH?: number; snap?: boolean; margin?: number; }

// Pointer-based drag (from a handle) + bottom-right resize. Mouse + touch via
// Pointer Events; clamps to the viewport; optional corner-snap on release.
export function useDragResize(initial: Box, opts: Opts = {}) {
  const { minW = 240, minH = 160, snap = false, margin = 12 } = opts;
  const [box, setBox] = useState<Box>(initial);
  const boxRef = useRef(box); boxRef.current = box;

  const startDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const orig = boxRef.current;
    const move = (ev: PointerEvent) => {
      const next = clampBox({ ...orig, x: orig.x + (ev.clientX - startX), y: orig.y + (ev.clientY - startY) }, window.innerWidth, window.innerHeight);
      setBox(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (snap) setBox((b) => clampBox(nearestCorner(b, window.innerWidth, window.innerHeight, margin), window.innerWidth, window.innerHeight));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [snap, margin]);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const orig = boxRef.current;
    const move = (ev: PointerEvent) => {
      const w = Math.max(minW, orig.w + (ev.clientX - startX));
      const h = Math.max(minH, orig.h + (ev.clientY - startY));
      setBox(clampBox({ ...orig, w, h }, window.innerWidth, window.innerHeight));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, [minW, minH]);

  return { box, setBox, startDrag, startResize };
}
