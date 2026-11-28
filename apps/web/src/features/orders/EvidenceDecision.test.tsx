// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  EvidenceDecision,
  SharedClaims,
  EvidenceVerificationSummary,
  evidenceVerificationFailure,
} from './EvidenceParts';

afterEach(cleanup);

it('offers acceptance only after verification, or a rejection that needs a reason', () => {
  const onAccept = vi.fn(),
    onReject = vi.fn();
  render(
    <EvidenceDecision
      busy=""
      verification={{ state: 'PASSED' }}
      recipient="the Supplier"
      onAccept={onAccept}
      onReject={onReject}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Accept evidence' }));
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
  expect(screen.getByRole('button', { name: 'Accept evidence' })).toBeTruthy();
});

it('verification is separate from acceptance and an unavailable check does not mark evidence invalid', () => {
  const onAccept = vi.fn(),
    onVerify = vi.fn(),
    onReject = vi.fn();
  const { rerender } = render(
    <EvidenceDecision
      busy=""
      recipient="the Supplier"
      onVerify={onVerify}
      onAccept={onAccept}
      onReject={onReject}
    />,
  );
  expect(
    (screen.getByRole('button', { name: 'Accept evidence' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Verify evidence' }));
  expect(onVerify).toHaveBeenCalledTimes(1);
  expect(onAccept).not.toHaveBeenCalled();
  const verification = evidenceVerificationFailure(
    Object.assign(new Error('RPC unavailable; retry'), { status: 503 }),
  );
  expect(verification.state).toBe('UNAVAILABLE');
  rerender(
    <>
      <EvidenceVerificationSummary verification={verification} />
      <EvidenceDecision
        busy=""
        verification={verification}
        recipient="the Supplier"
        onVerify={onVerify}
        onAccept={onAccept}
        onReject={onReject}
      />
    </>,
  );
  expect(screen.getByText('Verification unavailable')).toBeTruthy();
  expect(screen.queryByText('Verification failed')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Accept evidence' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByRole('button', { name: /Reject/ }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  expect(
    evidenceVerificationFailure(Object.assign(new Error('Invalid signature'), { status: 409 }))
      .state,
  ).toBe('FAILED');
});

it('shows missing disclosures without revealing values and treats preview text as untrusted', () => {
  const { rerender } = render(
    <SharedClaims
      values={{}}
      missing={['companyName']}
      undisclosed={['companyRegistrationNumber']}
    />,
  );
  expect(screen.getByText(/required Company name not shared/)).toBeTruthy();
  expect(screen.getByText(/Not shared: Registration number/)).toBeTruthy();
  rerender(<SharedClaims values={{ companyName: '<img src=x onerror=alert(1)>' }} />);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
});

it('keeps a concise verification result visible and detailed checks collapsed', () => {
  render(
    <EvidenceVerificationSummary
      verification={{ state: 'PASSED', checks: ['SIGNATURE_VERIFIED', 'ISSUER_TRUSTED'] }}
    />,
  );
  expect(screen.getByText('Verification passed')).toBeTruthy();
  const technical = screen.getByText('Technical details').closest('details');
  expect(technical?.open).toBe(false);
  expect(technical?.textContent).toContain('signature verified');
  expect(technical?.textContent).toContain('issuer trusted');
});
