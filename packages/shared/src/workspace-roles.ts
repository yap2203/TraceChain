import { CompanyRole } from './roles.js';

export type TraceChainWorkspaceRole =
  'admin' | 'supplier' | 'manufacturer' | 'distributor' | 'retailer';

/** Apply only after a CompanyRole has been cryptographically verified by the server. */
export const COMPANY_ROLE_TO_WORKSPACE = {
  [CompanyRole.SYSTEM_ADMIN]: 'admin',
  [CompanyRole.SUPPLIER]: 'supplier',
  [CompanyRole.MANUFACTURER]: 'manufacturer',
  [CompanyRole.DISTRIBUTOR]: 'distributor',
  [CompanyRole.RETAILER]: 'retailer',
} as const satisfies Record<CompanyRole, TraceChainWorkspaceRole>;
