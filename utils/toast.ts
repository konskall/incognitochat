// Lightweight transient toast (e.g. "Copied", "Failed to save"). Imperative so it
// needs no React state plumbing and can be called from anywhere (handlers, hooks,
// catch blocks). Replaces native alert() across the app for a consistent, modern,
// non-blocking look. Extracted from MessageActionMenu so importing it doesn't pull
// the (heavy) action-menu + emoji picker into a screen's bundle.
export function flashToast(text: string) {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'status');
  el.className = 'fixed left-1/2 bottom-6 -translate-x-1/2 z-[200] max-w-[90vw] text-center bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-2xl border border-white/10 pointer-events-none';
  el.style.transition = 'opacity .2s';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 1600);
  setTimeout(() => { el.remove(); }, 1850);
}
