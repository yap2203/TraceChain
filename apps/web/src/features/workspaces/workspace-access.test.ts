import { CompanyRole } from '@tracechain/shared';
import { describe, expect, it } from 'vitest';

import { canAccessWorkspace, isLocalSampleAccess, LOCAL_SAMPLE_STATUS } from './workspace-access';

const registryChecked = {
  authorizationReady: false,
  onChainStatusChecked: false,
  role: CompanyRole.SYSTEM_ADMIN,
};

describe('workspace access', () => {
  it('keeps production access locked until registry authorization succeeds', () => {
    expect(canAccessWorkspace(registryChecked, 'admin')).toBe(false);
  });

  it('requires every authorization signal and the mapped role', () => {
    const ready = { ...registryChecked, authorizationReady: true, onChainStatusChecked: true };
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
