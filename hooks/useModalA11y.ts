import { useEffect, useRef, RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Stack of currently-active modal ids. Only the topmost (most recently opened)
// modal handles Escape / Tab, so a nested dialog (lightbox inside gallery,
// emoji picker inside the action menu) doesn't also close its parent.
const modalStack: number[] = [];
let nextModalId = 1;

/**
 * Accessibility helper for dialog-style modals. While `active`:
 *  - moves focus into the dialog on open,
 *  - traps Tab / Shift+Tab inside it,
 *  - closes on Escape (caught in the capture phase so it wins over background
 *    handlers like the chat composer's own Escape-to-cancel),
 *  - restores focus to the previously focused element on close.
 *
 * Call it BEFORE any early `return null;` in the component, and give the dialog
 * container `tabIndex={-1}` plus `role="dialog"` / `aria-modal="true"`.
 */
export function useModalA11y(
  active: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement>
) {
  // Hold onClose in a ref so the effect depends ONLY on `active` — callers pass
  // inline arrows that change identity every render (each presence sync /
  // incoming message), and re-running this effect re-grabbed focus, which on
  // mobile dismissed the soft keyboard mid-typing while a picker was open.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const modalId = nextModalId++;
    modalStack.push(modalId);
    const isTopmost = () => modalStack[modalStack.length - 1] === modalId;

    // Move focus into the dialog (first focusable, else the container itself).
    const focusables = container
      ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];
    (focusables[0] ?? container)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only the topmost modal reacts, so a nested dialog's Escape/Tab doesn't
      // also fire the parent's handler (they share document in capture phase).
      if (!isTopmost()) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !container) return;

      const items = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      if (e.shiftKey && (activeEl === first || activeEl === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const i = modalStack.lastIndexOf(modalId);
      if (i >= 0) modalStack.splice(i, 1);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
    // onClose intentionally omitted (read via ref) so a changing handler
    // identity can't tear down the focus trap on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, containerRef]);
}
