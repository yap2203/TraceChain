import {
  COMPANY_ROLE_TO_WORKSPACE,
  type CompanyRole,
  type TraceChainWorkspaceRole,
} from '@tracechain/shared';

export const LOCAL_SAMPLE_STATUS = 'Local development · Sample data';

export interface WorkspaceAuthorizationState {
  authorizationReady: boolean;
  credentialVerified: boolean;
  locallyVerified: boolean;
  onChainStatusChecked: boolean;
  role?: CompanyRole;
}

export function canAccessWorkspace(
  authorization: WorkspaceAuthorizationState,
  workspace: TraceChainWorkspaceRole,
) {
  return (
    authorization.credentialVerified &&
    authorization.locallyVerified &&
    authorization.onChainStatusChecked &&
    authorization.authorizationReady &&
    !!authorization.role &&
    COMPANY_ROLE_TO_WORKSPACE[authorization.role] === workspace
  );
}

export function isLocalSampleAccess(isDevelopment: boolean, hostname: string) {
  return isDevelopment && ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase());
}
