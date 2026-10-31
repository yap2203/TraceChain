import { CompanyRole } from '@tracechain/shared';
import { describe, expect, it } from 'vitest';

import { canAccessWorkspace, isLocalSampleAccess, LOCAL_SAMPLE_STATUS } from './workspace-access';

const locallyVerified = {
  authorizationReady: false,
  credentialVerified: true,
  locallyVerified: true,
  onChainStatusChecked: false,
  role: CompanyRole.SYSTEM_ADMIN,
};

describe('workspace access', () => {
  it('keeps production access locked after local credential verification', () => {
    expect(canAccessWorkspace(locallyVerified, 'admin')).toBe(false);
  });

  it('requires every authorization signal and the mapped role', () => {
    const ready = { ...locallyVerified, authorizationReady: true, onChainStatusChecked: true };
    expect(canAccessWorkspace(ready, 'admin')).toBe(true);
    expect(canAccessWorkspace(ready, 'supplier')).toBe(false);
  });

  it('allows sample access only on a local host in development', () => {
    expect(isLocalSampleAccess(true, 'localhost')).toBe(true);
    expect(isLocalSampleAccess(true, 'example.com')).toBe(false);
    expect(isLocalSampleAccess(false, 'localhost')).toBe(false);
    expect(LOCAL_SAMPLE_STATUS).toBe('Local development · Sample data');
  });
});
