// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TransactionProgress } from './TransactionProgress';
import { beginTransaction } from '../../features/blockchain/transaction-progress';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

it('opens a blocking modal, prevents Escape dismissal and restores the screen on completion', () => {
  const show = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: show },
    close: { configurable: true, value: close },
  });
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  trigger.focus();
  render(<TransactionProgress />);
  let progress!: ReturnType<typeof beginTransaction>;
  act(() => {
    progress = beginTransaction();
  });
  const dialog = screen.getByRole('dialog', { name: 'Transaction in progress' });
  expect(show).toHaveBeenCalledOnce();
  expect(document.body.style.overflow).toBe('hidden');
  const cancel = new Event('cancel', { cancelable: true });
  fireEvent(dialog, cancel);
  expect(cancel.defaultPrevented).toBe(true);
  act(() => progress.confirming());
  expect(screen.getByText('Confirming transaction', { selector: 'strong' })).toBeTruthy();
  act(() => progress.finish());
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  trigger.remove();
});
