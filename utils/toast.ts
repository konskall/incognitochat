// Lightweight transient toast (e.g. "Copied", "Failed to save"). Imperative so it
// needs no React state plumbing and can be called from anywhere (handlers, hooks,
// catch blocks). Replaces native alert() across the app for a consistent, modern,
// non-blocking look. Extracted from MessageActionMenu so importing it doesn't pull
// the (heavy) action-menu + emoji picker into a screen's bundle.
export function flashToast(text: string) {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'status');
  el.className = 'fixed left-1/2 -translate-x-1/2 z-[200] max-w-[90vw] text-center bg-slate-900 text-white text-sm font-semibold px-4 py-2 rounded-full shadow-2xl border border-white/10 pointer-events-none';
  // Sit just ABOVE the chat composer when one is on screen; otherwise a fixed
  // offset from the viewport bottom. A plain viewport-bottom offset misplaced it:
  // on mobile the composer is at the very bottom so the toast landed inside the
  // input; on desktop the composer sits inside a centred card (my-4) so the toast
  // landed in the margin BELOW it. Anchoring to the composer's top fixes both.
  const composer = document.querySelector('[data-chat-composer]');
  if (composer) {
    const top = composer.getBoundingClientRect().top;
    el.style.bottom = `${Math.round(Math.max(document.documentElement.clientHeight - top + 8, 24))}px`;
  } else {
    el.style.bottom = '1.5rem';
  }
  el.style.transition = 'opacity .2s';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; }, 1600);
  setTimeout(() => { el.remove(); }, 1850);
}
