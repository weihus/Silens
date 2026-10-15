import { useLayoutEffect, useRef, type RefObject } from 'react';

function isVisible(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
    if (node instanceof HTMLDetailsElement && !node.open) {
      const summary = node.querySelector('summary');
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

const controls = 'button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"]';

export function useDialogFocus(
  open: boolean,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const initialRef = useRef(initialFocusRef);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    initialRef.current = initialFocusRef;
  });

  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    if (!dialog) return;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(controls))
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && isVisible(element));
    const otherDialogFocused = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .some(other => other !== dialog && isVisible(other) && other.contains(document.activeElement));
    const focusInitial = (retry = false) => {
      if (!dialog.isConnected || dialog.contains(document.activeElement) || (retry && otherDialogFocused())) return;
      const initial = initialRef.current?.current;
      const target = initial && dialog.contains(initial) && !initial.matches(':disabled') && isVisible(initial)
        ? initial : focusable()[0] ?? dialog;
      target.focus({ preventScroll: true });
    };
    // The container remains focusable when every control is disabled (native export).
    const originalTabIndex = dialog.getAttribute('tabindex');
    if (originalTabIndex === null) dialog.tabIndex = -1;
    focusInitial();
    // Retry after mounting/animation setup without refocusing an already active control.
    const timer = window.setTimeout(() => focusInitial(true), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || otherDialogFocused()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        const index = elements.indexOf(document.activeElement as HTMLElement);
        if (!elements.length || index < 0 || (!event.shiftKey && index === elements.length - 1) || (event.shiftKey && index === 0)) {
          event.preventDefault();
          (event.shiftKey ? elements.at(-1) ?? dialog : elements[0] ?? dialog).focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (originalTabIndex === null) dialog.removeAttribute('tabindex');
      if (previous?.isConnected && !otherDialogFocused()) previous.focus({ preventScroll: true });
    };
  }, [open]);

  return ref;
}
