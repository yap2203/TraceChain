// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EvidenceDecision } from './EvidenceParts';

afterEach(cleanup);

it('offers one verify-and-accept step, or a rejection that needs a reason', () => {
  const onAccept = vi.fn(),
    onReject = vi.fn();
  render(
    <EvidenceDecision busy="" recipient="the Supplier" onAccept={onAccept} onReject={onReject} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Verify and accept' }));
  expect(onAccept).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
  const reject = screen.getByRole('button', { name: 'Reject evidence' }) as HTMLButtonElement;
  expect(reject.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Rejection reason/), {
    target: { value: '  Wrong batch  ' },
  });
  fireEvent.click(reject);
  expect(onReject).toHaveBeenCalledWith('Wrong batch');

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Verify and accept' })).toBeTruthy();
});
