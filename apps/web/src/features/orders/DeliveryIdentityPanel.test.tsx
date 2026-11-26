// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), selective: vi.fn(), full: vi.fn() }));
vi.mock('./orders.api', () => ({ deliveryIdentity: mocks.identity }));
vi.mock('../didcomm/didcomm-agent', () => ({
  getActiveMessagingAgent: () => ({ did: 'did:key:supplier' }),
  createSelectiveCompanyIdentityPresentation: mocks.selective,
  createCompanyIdentityPresentation: mocks.full,
}));
vi.mock('../didcomm/HolderSigningKeyPanel', () => ({
  PresentationSigningSettingsLink: () => <span>Profile presentation key settings</span>,
}));
import { DeliveryIdentityPanel } from './DeliveryIdentityPanel';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('shares exactly the paired optional registration values with the mandatory company identity after review', async () => {
  const material = {
    format: 'COMPANY_IDENTITY_SD_JWT',
    sdJwt: 'v2-attestation',
    holderDid: 'did:key:supplier',
    audience: 'distributor',
    challenge: 'fresh',
    purpose: 'Check seller',
    expiresAt: Math.floor(Date.now() / 1000) + 240,
    requiredClaims: ['companyName', 'role', 'walletAddress', 'id'],
    optionalClaims: ['companyRegistrationNumber', 'registrationCountry'],
    claims: {
      companyName: 'Actual company',
      role: 'SUPPLIER',
      walletAddress: 'supplier',
      id: 'did:key:supplier',
      companyRegistrationNumber: 'REG-1',
      registrationCountry: 'MY',
    },
  };
  mocks.identity.mockImplementation(async (_order, input) =>
    input.action === 'material' ? material : { status: 'REQUESTED' },
  );
  mocks.selective.mockResolvedValue('holder-presentation');
  renderSupplierPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Review request' }));
  await screen.findByRole('switch', { name: 'Share Registration number' });
  expect(
    (screen.getByRole('switch', { name: 'Share Company name' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole('switch', { name: 'Share Registration number' }));
  expect(
    screen.getByRole('switch', { name: 'Share Registration country' }).getAttribute('aria-checked'),
  ).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Review and sign proof' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign and share' }));
  await waitFor(() =>
    expect(mocks.selective).toHaveBeenCalledWith(expect.anything(), 'v2-attestation', {
      audience: 'distributor',
      nonce: 'fresh',
      claims: [
        'companyName',
        'role',
        'walletAddress',
        'id',
        'companyRegistrationNumber',
        'registrationCountry',
      ],
    }),
  );
});

it('uses locked required toggles, readable optional claims and a review modal before signing', async () => {
  const material = {
    format: 'COMPANY_IDENTITY_SD_JWT',
    sdJwt: 'issuer-signed-selective-company-material',
    holderDid: 'did:key:supplier',
    audience: 'distributor',
    challenge: 'delivery-challenge',
    purpose: 'Check before collection',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    requiredClaims: ['companyId', 'role', 'walletAddress'],
    optionalClaims: ['companyName', 'companyRegistrationNumber', 'id'],
    claims: {
      companyId: 'company-001',
      role: 'SUPPLIER',
      walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      companyName: 'Actual company record',
      companyRegistrationNumber: 'REG-2026-001',
      id: 'did:key:z6MkSupplierIdentityForTraceChain123456789',
    },
  };
  mocks.identity.mockImplementation(async (_order, input) =>
    input.action === 'material' ? material : { status: 'REQUESTED' },
  );
  mocks.selective.mockResolvedValue('holder-approved-presentation');
  render(
    <DeliveryIdentityPanel
      order={{ orderId: 'order', seller: 'supplier', delivery: { identityChallenge: 'challenge' } }}
      data={{
        actor: 'supplier',
        role: 'SUPPLIER',
        orders: [],
        catalogue: [],
        locations: [],
        shipments: [],
      }}
      requestedBy="Bayu Food Logistics"
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Review request' }));
  await screen.findByText('Actual company record');
  expect(mocks.selective).not.toHaveBeenCalled();
  expect(mocks.identity.mock.calls.some(([, input]) => input.action === 'present')).toBe(false);

  const requiredCompanyId = screen.getByRole('switch', { name: 'Share Company ID' });
  const requiredRole = screen.getByRole('switch', { name: 'Share Company role' });
  expect(requiredCompanyId.getAttribute('aria-checked')).toBe('true');
  expect(requiredCompanyId).toHaveProperty('disabled', true);
  expect(requiredRole).toHaveProperty('disabled', true);
  expect(screen.getAllByText('Supplier').length).toBeGreaterThan(0);
  expect(screen.getByText('3 of 6 fields will be shared')).toBeTruthy();
  expect(
    screen.getByRole('switch', { name: 'Share Wallet address' }).closest('.evidence-claim-row')
      ?.textContent,
  ).not.toContain(material.claims.walletAddress);
  // The full value stays reachable on the shortened row, not duplicated elsewhere.
  expect(document.querySelector(`[title="${material.claims.walletAddress}"]`)).toBeTruthy();

  fireEvent.click(screen.getByRole('switch', { name: 'Share Company name' }));
  expect(screen.getByText('4 of 6 fields will be shared')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Review and sign proof' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Review request' })).toBeNull();
  expect(screen.queryByText(/Approve & sign/)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Review and sign proof' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.getAllByText('Bayu Food Logistics').length).toBeGreaterThan(1);
  expect(screen.getAllByText('Company ID').length).toBeGreaterThan(1);
  expect(screen.getAllByText('Company role').length).toBeGreaterThan(1);
  expect(screen.getAllByText('Wallet address').length).toBeGreaterThan(1);
  expect(screen.getAllByText('Company name').length).toBeGreaterThan(1);
  expect(mocks.selective).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Sign and share' }));
  await waitFor(() =>
    expect(mocks.selective).toHaveBeenCalledWith(
      expect.objectContaining({ did: material.holderDid }),
      material.sdJwt,
      {
        audience: material.audience,
        nonce: material.challenge,
        claims: ['companyId', 'role', 'walletAddress', 'companyName'],
      },
    ),
  );
  expect(mocks.full).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(mocks.identity).toHaveBeenCalledWith('order', {
      action: 'present',
      presentation: 'holder-approved-presentation',
    }),
  );
});

it('shows a neutral not-requested state without presenting refresh as the primary action', async () => {
  mocks.identity.mockResolvedValue({ status: 'NOT_REQUESTED' });
  renderSupplierPanel();
  expect((await screen.findAllByText('Not requested')).length).toBeGreaterThan(0);
  expect(screen.getByText('No evidence has been requested.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Refresh status' })).toBeNull();
  const raw = screen.getByText('NOT_REQUESTED');
  expect(raw.closest('details')?.hasAttribute('open')).toBe(false);
});

it('opens a two-step company evidence request for the distributor', async () => {
  const custodyDeadline = Math.floor(Date.now() / 1000) + 7_200;
  mocks.identity.mockResolvedValue({ status: 'NOT_REQUESTED' });
  render(
    <DeliveryIdentityPanel
      order={{
        orderId: 'custody-offer-1',
        seller: 'supplier',
        expiresAt: custodyDeadline,
        delivery: { identityChallenge: 'challenge', distributor: 'distributor' },
      }}
      data={{
        actor: 'distributor',
        role: 'DISTRIBUTOR',
        orders: [],
        catalogue: [],
        locations: [],
        shipments: [],
        companies: [
          { wallet: 'supplier', companyName: 'Rimba Cocoa Ingredients', role: 'SUPPLIER' },
          { wallet: 'distributor', companyName: 'Bayu Food Logistics', role: 'DISTRIBUTOR' },
        ],
      }}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Create evidence request' }));
  expect(screen.getByText('Step 1 of 2 · Configure request')).toBeTruthy();
  expect(screen.getByText('Bayu Food Logistics · Distributor')).toBeTruthy();
  expect(screen.getByText('Rimba Cocoa Ingredients · Supplier')).toBeTruthy();
  expect(screen.getByText('4 fields selected')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Review request' })).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Presentation deadline *'), {
    target: { value: '2099-01-01T12:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
  expect(
    screen.getByText(/selected evidence deadline is after the custody offer deadline/i),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use custody offer deadline' }));
  expect(screen.getByText('Step 2 of 2 · Review and submit')).toBeTruthy();
  expect(screen.getByRole('heading', { name: /Required/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Internal company ID' }));
  const classification = screen.getByRole('group', {
    name: 'Internal company ID requirement',
  });
  fireEvent.click(within(classification).getByRole('button', { name: 'Required' }));
  fireEvent.click(within(classification).getByRole('button', { name: 'Optional' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  await waitFor(() =>
    expect(mocks.identity.mock.calls.some(([, input]) => input.action === 'request')).toBe(true),
  );
  const request = mocks.identity.mock.calls.find(([, input]) => input.action === 'request')![1];
  expect(new Set(request.requiredClaims).size).toBe(request.requiredClaims.length);
  expect(new Set(request.optionalClaims).size).toBe(request.optionalClaims.length);
  expect(
    request.requiredClaims.some((claim: string) => request.optionalClaims.includes(claim)),
  ).toBe(false);
  expect(request.optionalClaims).toContain('companyId');
  expect(request.expiresAt).toBeLessThanOrEqual(custodyDeadline);
});

it('shows a clear review action for a pending request', async () => {
  mocks.identity.mockResolvedValue({
    status: 'REQUESTED',
    purpose: 'Optional delivery check',
    requiredClaims: ['companyId', 'role'],
    optionalClaims: ['companyName'],
    expiresAt: 2_000_000_000,
  });
  renderSupplierPanel();
  expect((await screen.findAllByText('Awaiting response')).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Review request' })).toBeTruthy();
});

it('shows a readable completed result and shared-evidence disclosure', async () => {
  mocks.identity.mockResolvedValue({
    status: 'VERIFIED',
    purpose: 'Optional delivery check',
    checks: ['Signature verified'],
    credential: { companyName: 'Rimba Cocoa Ingredients' },
  });
  renderSupplierPanel();
  expect((await screen.findAllByText('Verified')).length).toBeGreaterThan(0);
  expect(screen.getByText('Verified. Nothing else to do.')).toBeTruthy();
  expect(screen.getByText('Shared details')).toBeTruthy();
  expect(screen.getByText('Rimba Cocoa Ingredients')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Review request' })).toBeNull();
});

it('toggles all optional fields and updates the selected claim count', async () => {
  const material = {
    format: 'COMPANY_IDENTITY_SD_JWT',
    sdJwt: 'selective-material',
    holderDid: 'did:key:supplier',
    audience: 'distributor',
    challenge: 'challenge',
    purpose: 'Verify seller identity',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    requiredClaims: ['companyId', 'role', 'walletAddress'],
    optionalClaims: ['companyName', 'companyRegistrationNumber', 'id'],
    claims: {
      companyId: 'company-001',
      role: 'SUPPLIER',
      walletAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      companyName: 'Rimba Cocoa Ingredients',
      companyRegistrationNumber: 'REG-001',
      id: 'did:key:z6MkSupplierIdentityForTraceChain',
    },
  };
  mocks.identity.mockImplementation(async (_order, input) =>
    input.action === 'material' ? material : { status: 'REQUESTED' },
  );
  renderSupplierPanel();
  fireEvent.click(await screen.findByRole('button', { name: 'Review request' }));
  expect(await screen.findByText('3 of 6 fields will be shared')).toBeTruthy();

  const shareAll = screen.getByRole('switch', { name: 'Share all optional fields' });
  fireEvent.click(shareAll);
  expect(screen.getByText('6 of 6 fields will be shared')).toBeTruthy();
  expect(shareAll.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('switch', { name: 'Share Registration number' }));
  expect(screen.getByText('5 of 6 fields will be shared')).toBeTruthy();
});

it('does not allow an expired request to enter the signing flow', async () => {
  mocks.identity.mockResolvedValue({
    status: 'EXPIRED',
    purpose: 'Verify seller identity',
    expiresAt: 1,
  });
  renderSupplierPanel();
  expect((await screen.findAllByText('Expired')).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('This request has closed. No action is possible.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Review request' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review and sign proof' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign and share' })).toBeNull();
});

function renderSupplierPanel() {
  return render(
    <DeliveryIdentityPanel
      order={{
        orderId: 'order',
        seller: 'supplier',
        delivery: { identityChallenge: 'challenge', distributor: 'distributor' },
      }}
      data={{
        actor: 'supplier',
        role: 'SUPPLIER',
        orders: [],
        catalogue: [],
        locations: [],
        shipments: [],
        companies: [
          { wallet: 'distributor', companyName: 'Bayu Food Logistics', role: 'DISTRIBUTOR' },
        ],
      }}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}
