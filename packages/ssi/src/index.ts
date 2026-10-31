export { createTraceChainAgent } from './agent/tracechain-agent.js';
export type { TraceChainAgent } from './agent/tracechain-agent.js';
export { bootstrapSystemAdmin } from './bootstrap/admin-bootstrap.service.js';
export type {
  BootstrapSystemAdminInput,
  BootstrapSystemAdminResult,
} from './bootstrap/admin-bootstrap.service.js';
export {
  SEPOLIA_CHAIN_ID,
  SEPOLIA_NETWORK_NAME,
  validateTraceChainSsiConfig,
} from './config/ssi-config.js';
export type { TraceChainSsiConfig } from './config/ssi-config.js';
export {
  CompanyRoleCredentialStatus,
  companyRoleCredentialSchema,
} from './credentials/company-role-credential.js';
export type { CompanyRoleCredential } from './credentials/company-role-credential.js';
export {
  issueCompanyRoleCredential,
  walletAddressToDid,
} from './credentials/company-role-credential.service.js';
export type { IssueCompanyRoleCredentialInput } from './credentials/company-role-credential.service.js';
export { verifyCompanyRoleCredential } from './credentials/verification.service.js';
export type {
  CompanyRoleCredentialFailureReason,
  CompanyRoleCredentialVerificationResult,
} from './credentials/verification.service.js';
export { createOrGetAuthorityDid } from './did/authority-did.service.js';
