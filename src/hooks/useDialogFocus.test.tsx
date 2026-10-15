// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

function Dialog({ open = true, onClose = vi.fn() }) {
  const input = useRef<HTMLInputElement>(null);
  const ref = useDialogFocus(open, onClose, input);
  return open ? <div ref={ref} role="dialog"><input ref={input} aria-label="initial" /><button disabled>disabled</button><details><summary>more</summary><button>hidden</button></details><button>last</button></div> : null;
}

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); });

it('focuses the input, traps both Tab directions, skips hidden and disabled controls, and ignores IME Escape', () => {
  const close = vi.fn();
  render(<Dialog onClose={close} />);
  const input = screen.getByRole('textbox');
  const last = screen.getByText('last');
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(last, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('restores connected prior focus and cancels the mount retry on close', () => {
  vi.useFakeTimers();
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const view = render(<Dialog />);
  view.rerender(<Dialog open={false} />);
  act(() => { vi.runAllTimers(); });
  expect(document.activeElement).toBe(trigger);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not steal focus from a different dialog during cleanup or a delayed retry', () => {
  vi.useFakeTimers();
  const view = render(<Dialog />);
  const next = document.createElement('div');
  next.setAttribute('role', 'dialog');
  const input = document.createElement('input');
  next.append(input);
  document.body.append(next);
  input.focus();
  act(() => { vi.runAllTimers(); });
  expect(document.activeElement).toBe(input);
  view.unmount();
  expect(document.activeElement).toBe(input);
});

it('uses the latest close callback without resetting focus', () => {
  const oldClose = vi.fn();
  const newClose = vi.fn();
  const view = render(<Dialog onClose={oldClose} />);
  screen.getByText('last').focus();
  view.rerender(<Dialog onClose={newClose} />);
  expect(document.activeElement).toBe(screen.getByText('last'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(newClose).toHaveBeenCalledOnce();
  expect(oldClose).not.toHaveBeenCalled();
});
