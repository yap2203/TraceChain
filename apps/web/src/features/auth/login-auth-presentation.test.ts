import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyRole } from '@tracechain/shared';
import { describe, expect, it } from 'vitest';

import { CredentialVerificationPanel } from './CredentialVerificationPanel';
import { credentialFailureHeading, getLoginAuthPresentation } from './login-auth-presentation';

describe('login authentication presentation', () => {
  it('presents one clear start action before wallet authentication', () => {
    expect(
      getLoginAuthPresentation({
        credentialVerified: false,
        locallyVerified: false,
        phase: 'idle',
      }),
    ).toMatchObject({
      authenticated: false,
      authenticationTitle: 'Connect to TraceChain',
      heroActionLabel: 'Get started',
    });
  });

  it('continues to credential verification after wallet authentication', () => {
    expect(
      getLoginAuthPresentation({
        credentialVerified: false,
        locallyVerified: false,
        phase: 'authenticated',
      }),
    ).toMatchObject({
      authenticated: true,
      authenticationTitle: 'Wallet connected',
      heroActionLabel: 'Continue verification',
      locallyVerified: false,
    });
  });

  it('shows authorization status without connect wording after local verification', () => {
    const presentation = getLoginAuthPresentation({
      credentialVerified: true,
      locallyVerified: true,
      phase: 'authenticated',
    });

    expect(presentation).toMatchObject({
      authenticationTitle: 'Role verified locally',
      heroActionLabel: 'View authorization status',
      locallyVerified: true,
    });
    expect(JSON.stringify(presentation).toLowerCase()).not.toContain('connect wallet');
  });

  it('distinguishes a rejected replacement from an unverified session', () => {
    expect(credentialFailureHeading(true)).toBe('Selected replacement was rejected');
    expect(credentialFailureHeading(false)).toBe('Verification unsuccessful');
  });

  it('renders the main credential picker as the next wallet-authenticated action', () => {
    const markup = renderToStaticMarkup(
      createElement(CredentialVerificationPanel, {
        credentialState: { message: '', phase: 'idle', reasons: [] },
        credentialVerified: false,
        onPresent: async () => undefined,
      }),
    );

    expect(markup).toContain('Verify role credential');
    expect(markup).toContain('Choose credential file');
    expect(markup).not.toContain('Blockchain authorization');
  });

  it('renders verified progress without the main picker or generic failure message', () => {
    const markup = renderToStaticMarkup(
      createElement(CredentialVerificationPanel, {
        credentialId: 'urn:uuid:test',
        credentialState: {
          message: 'A replacement was rejected.',
          phase: 'error',
          reasons: ['INVALID_SIGNATURE'],
        },
        credentialVerified: true,
        onPresent: async () => undefined,
        role: CompanyRole.SYSTEM_ADMIN,
        walletAddress: '0x1234…5678',
      }),
    );

    expect(markup).toContain('System Admin verified locally');
    expect(markup).toContain('Wallet connected');
    expect(markup).toContain('Role credential verified');
    expect(markup).toContain('Blockchain authorization');
    expect(markup).toContain('Replace credential');
    expect(markup).not.toContain('Choose credential file');
    expect(markup).not.toContain('Verification unsuccessful');
  });
});
