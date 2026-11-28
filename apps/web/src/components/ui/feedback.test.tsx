// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readableError, notify } from './feedback';
import { Notifications } from './Notifications';
import { LoadingIndicator } from './LoadingIndicator';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('extracts readable API errors and hides raw RPC payloads and secrets', () => {
  expect(readableError('{"error":{"message":"Choose a receiving location."}}')).toBe(
    'Choose a receiving location.',
  );
  expect(readableError({ code: 4001, message: 'raw payload' })).toContain('cancelled');
  expect(
    readableError(new Error('could not coalesce error (error={"private":"secret"})')),
  ).not.toMatch(/private|secret|coalesce/);
  expect(readableError({ message: 'RPC 0x7a69: Nonce too high. Expected 0 got 1' })).toContain(
    'outdated transaction count',
  );
  expect(readableError({ message: 'https://provider.invalid/private-api-key' })).not.toContain(
    'private-api-key',
  );
  expect(readableError('Failed to fetch')).toContain('Unable to reach');
});
it('announces success and readable errors, allows dismissal and expires notifications', () => {
  vi.useFakeTimers();
  render(<Notifications />);
  act(() => notify('Changes saved for feedback test.', 'success'));
  expect(screen.getByRole('status').textContent).toContain('Changes saved');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
  expect(screen.queryByText('Changes saved for feedback test.')).toBeNull();
  act(() => notify('{"error":{"message":"The offer expired."}}', 'error'));
  expect(screen.getByRole('alert').textContent).toContain('The offer expired.');
  act(() => vi.advanceTimersByTime(12000));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('shows an accessible skeleton with a consistent page loading container', () => {
  const { container } = render(<LoadingIndicator page label="Loading your shipments…" />);
  expect(screen.getByRole('status', { name: 'Loading your shipments…' })).toBeTruthy();
  expect(container.querySelector('.page-skeleton .page-skeleton__item')).toBeTruthy();
});
it.each([
  ['success', 4000],
  ['error', 7000],
] as const)('automatically dismisses a %s toast after %i ms', (type, duration) => {
  vi.useFakeTimers();
  render(<Notifications />);
  const message = `Timed ${type} notification.`;
  act(() => notify(message, type));
  act(() => vi.advanceTimersByTime(duration - 1));
  expect(screen.getByText(message)).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.queryByText(message)).toBeNull();
});
it('keeps notifications visible when a native modal opens and closes', async () => {
  render(<Notifications />);
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  document.body.append(dialog);
  try {
    act(() => notify('Modal action completed.', 'success'));
    await waitFor(() => expect(dialog.querySelector('.app-notification')).toBeTruthy());
    dialog.remove();
    await waitFor(() =>
      expect(document.body.querySelector('.app-notification')?.textContent).toContain(
        'Modal action completed.',
      ),
    );
  } finally {
    dialog.remove();
  }
});
