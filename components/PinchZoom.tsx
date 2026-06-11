import React, { useCallback, useRef, useState } from 'react';

interface Transform { scale: number; x: number; y: number; }

// Two-finger pinch-zoom + pan for touch (handy for inspecting a shared screen).
// One finger pans when zoomed; double-tap resets. Scale clamped 1×–4×; pan
// clamped so content can't be dragged off-screen. Mouse devices: double-click
// resets (no pinch — that's a touch gesture).
const PinchZoom: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const tRef = useRef(t); tRef.current = t;
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panLast = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);
  const [active, setActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const clampT = useCallback((nt: Transform): Transform => {
    const el = containerRef.current;
    const scale = Math.min(4, Math.max(1, nt.scale));
    if (!el || scale <= 1) return { scale, x: 0, y: 0 };
    const maxX = (el.clientWidth * (scale - 1)) / 2;
    const maxY = (el.clientHeight * (scale - 1)) / 2;
    return { scale, x: Math.min(maxX, Math.max(-maxX, nt.x)), y: Math.min(maxY, Math.max(-maxY, nt.y)) };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setActive(true);
    if (ptrs.current.size === 2) {
      const [a, b] = Array.from(ptrs.current.values());
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: tRef.current.scale };
    } else if (ptrs.current.size === 1) {
      panLast.current = { x: e.clientX, y: e.clientY };
      const now = e.timeStamp;
      if (now - lastTap.current < 300) { setT({ scale: 1, x: 0, y: 0 }); pinchStart.current = null; }
      lastTap.current = now;
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size >= 2 && pinchStart.current) {
      const [a, b] = Array.from(ptrs.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = pinchStart.current.scale * (dist / pinchStart.current.dist);
      setT((p) => clampT({ ...p, scale }));
    } else if (ptrs.current.size === 1 && tRef.current.scale > 1 && panLast.current) {
      const dx = e.clientX - panLast.current.x;
      const dy = e.clientY - panLast.current.y;
      panLast.current = { x: e.clientX, y: e.clientY };
      setT((p) => clampT({ ...p, x: p.x + dx, y: p.y + dy }));
    }
  }, [clampT]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinchStart.current = null;
    if (ptrs.current.size === 1) { const p = Array.from(ptrs.current.values())[0]; panLast.current = { x: p.x, y: p.y }; }
    if (ptrs.current.size === 0) { panLast.current = null; setActive(false); }
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative overflow-hidden touch-none ${className || ''}`}
    >
      <div
        className="w-full h-full"
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`, transformOrigin: 'center center', transition: active ? 'none' : 'transform 0.15s ease-out' }}
      >
        {children}
      </div>
    </div>
  );
};

export default PinchZoom;
