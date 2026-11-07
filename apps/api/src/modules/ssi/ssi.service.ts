import {
  createTraceChainAgent,
  companyRoleCredentialSchema,
  serializeCompanyRoleCredential,
  issueCompanyRoleCredential,
  findStoredCompanyRoleCredential,
  verifyCompanyRoleCredential,
  walletAddressToDid,
  type TraceChainAgent,
} from '@tracechain/ssi';
import { CompanyRole } from '@tracechain/shared';
import { id } from 'ethers';
import { getAddress } from 'ethers';

import { loadTraceChainSsiEnvironment } from '../../config/ssi-env.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CredentialVerificationSummary } from '../auth/auth.types.js';
import {
  BlockchainAuthorizationUnavailableError,
  type BlockchainAuthorizationService,
} from '../blockchain/blockchain-authorization.service.js';
import type { BlockchainGateway } from '../blockchain/blockchain-gateway.service.js';
import type { CredentialContentStore } from './encrypted-credential.store.js';
import type {
  CompanyRoleIssuanceRecord,
  CompanyRoleIssuanceRepository,
} from './issuance.repository.js';
import type {
  CompanyIdentityCheck,
  CompanyIdentityResponse,
  CompanyRoleVerificationApiResponse,
  CredentialExpirationStatus,
} from './ssi.types.js';

export type TraceChainAgentProvider = () => Promise<TraceChainAgent>;

export class SsiApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface CompanyRoleSsiServiceDependencies {
  agentProvider: TraceChainAgentProvider;
  authService: AuthService;
  authorityDidAlias: string | (() => string);
  blockchainAuthorization?: BlockchainAuthorizationService;
  blockchainGateway?: BlockchainGateway;
  chainId?: number;
  clock?: () => Date;
  credentialContentStore?: CredentialContentStore;
  issuanceRepository?: CompanyRoleIssuanceRepository;
}

export class CompanyRoleSsiService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: CompanyRoleSsiServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async getMyCompanyIdentity(sessionId: string | undefined): Promise<CompanyIdentityResponse> {
    return this.resolveMyCompanyIdentity(sessionId, false);
  }

  async verifyMyCompanyIdentity(sessionId: string | undefined): Promise<CompanyIdentityResponse> {
    return this.resolveMyCompanyIdentity(sessionId, true);
  }

  private async resolveMyCompanyIdentity(
    sessionId: string | undefined,
    performVerification: boolean,
  ): Promise<CompanyIdentityResponse> {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const gateway = this.dependencies.blockchainGateway;
    const repository = this.dependencies.issuanceRepository;
    const contentStore = this.dependencies.credentialContentStore;
    if (!gateway || !repository || !contentStore || !this.dependencies.chainId) {
      throw new SsiApiError(
        'IDENTITY_SERVICE_UNAVAILABLE',
        'The company identity service is not configured.',
        503,
      );
    }

    let stakeholder;
    try {
      stakeholder = await gateway.getStakeholder(session.address);
    } catch {
      throw new SsiApiError(
        'BLOCKCHAIN_UNAVAILABLE',
        'The stakeholder registry could not be read.',
        503,
      );
    }
    if (/^0x0{64}$/i.test(stakeholder.credentialHash)) {
      throw new SsiApiError(
        'CREDENTIAL_NOT_LINKED',
        'No Company Role Credential is linked to this wallet yet.',
        404,
      );
    }

    const walletRecords = (await repository.list())
      .filter((record) => getAddress(record.applicantWallet) === getAddress(session.address))
      .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt));
    const issuance =
      walletRecords.find(
        (record) =>
          record.credentialHash.toLowerCase() === stakeholder.credentialHash.toLowerCase(),
      ) ?? walletRecords[0];
    if (!issuance) {
      throw new SsiApiError(
        'CREDENTIAL_CONTENT_UNAVAILABLE',
        'The encrypted credential for this wallet is unavailable in this API instance.',
        404,
      );
    }

    let credential;
    try {
      credential = companyRoleCredentialSchema.parse(
        JSON.parse(await contentStore.decrypt(issuance.encryptedPayload)),
      );
    } catch {
      throw new SsiApiError(
        'CREDENTIAL_RETRIEVAL_FAILED',
        'The encrypted credential could not be retrieved or decoded.',
        503,
      );
    }

    let credentialState;
    let chainCredential;
    let administrator;
    try {
      administrator = await gateway.getAdministrator();
      credentialState = await gateway.getCredentialState(stakeholder.credentialHash);
      if (!/^0x0{64}$/i.test(credentialState.credentialId)) {
        chainCredential = await gateway.getCredential(credentialState.credentialId);
      }
    } catch {
      throw new SsiApiError(
        'BLOCKCHAIN_UNAVAILABLE',
        'The credential registry could not be read.',
        503,
      );
    }

    const now = this.clock();
    const replaced =
      !chainCredential ||
      chainCredential.credentialHash.toLowerCase() !== issuance.credentialHash.toLowerCase() ||
      chainCredential.encryptedCid !== issuance.encryptedCredentialCid;
    const lifecycleStatus = resolveLifecycleStatus(
      chainCredential?.status,
      credential.expirationDate,
      replaced,
      now,
    );
    const issuerDid =
      typeof credential.issuer === 'string' ? credential.issuer : credential.issuer.id;
    const issuerName =
      typeof credential.issuer === 'string' ? 'Unavailable' : credential.issuer.name;
    const response: CompanyIdentityResponse = {
      identity: {
        applicationReference: credential.credentialSubject.applicationReference,
        associatedWallet: credential.credentialSubject.walletAddress,
        chainId: this.dependencies.chainId,
        companyName: credential.credentialSubject.companyName,
        companyRegistrationNumber: credential.credentialSubject.companyRegistrationNumber,
        credentialHash: stakeholder.credentialHash,
        credentialId: credential.id,
        encryptedCredentialCid: stakeholder.credentialCid,
        expiresAt: credential.expirationDate,
        issuerDid,
        issuerName,
        issuedAt: credential.issuanceDate,
        lifecycleStatus,
        registryCredentialId: credentialState.credentialId,
        registryReferences: gateway.getRegistryReferences?.() ?? {
          credentialRegistry: '',
          stakeholderRegistry: '',
        },
        role: credential.credentialSubject.role,
        subjectDid: credential.credentialSubject.id,
        updatedAt: new Date(stakeholder.updatedAt * 1_000).toISOString(),
      },
    };
    if (!performVerification) return response;

    const agent = await this.dependencies.agentProvider();
    const authorityDid = await this.authorityDid(agent);
    const local = await verifyCompanyRoleCredential(
      agent,
      credential,
      session.address,
      authorityDid,
      now,
    );
    const computedHash = local.credentialHash ? `0x${local.credentialHash}` : undefined;
    const expectedRole = roleFromContractForIdentity(stakeholder.role);
    const checks: CompanyIdentityCheck[] = [
      identityCheck(
        'Credential structure and type',
        !local.reasons.includes('MALFORMED_CREDENTIAL'),
        'Supported Company Role Credential structure.',
      ),
      identityCheck(
        'Cryptographic signature',
        !local.reasons.includes('INVALID_SIGNATURE'),
        'Veramo verified the signed JWT proof.',
      ),
      identityCheck(
        'Trusted issuer',
        !local.reasons.includes('UNTRUSTED_ISSUER'),
        'Issuer matches the configured TraceChain authority.',
      ),
      identityCheck(
        'Wallet and subject binding',
        !local.reasons.includes('WRONG_WALLET') &&
          getAddress(credential.credentialSubject.walletAddress) === getAddress(session.address),
        'Credential subject is bound to the authenticated SIWE wallet.',
      ),
      identityCheck(
        'Approved role consistency',
        expectedRole !== undefined && credential.credentialSubject.role === expectedRole,
        expectedRole
          ? 'Signed role matches the stakeholder registry role.'
          : 'The stakeholder no longer has an active assigned role.',
      ),
      identityCheck(
        'Issue and expiry validity',
        !local.reasons.includes('EXPIRED') && !local.reasons.includes('NOT_YET_VALID'),
        'Credential dates are currently valid.',
      ),
      identityCheck(
        'Deterministic hash',
        computedHash?.toLowerCase() === stakeholder.credentialHash.toLowerCase() &&
          chainCredential?.credentialHash.toLowerCase() ===
            stakeholder.credentialHash.toLowerCase(),
        'Signed credential hash matches both registries.',
      ),
      identityCheck(
        'Registry subject and issuer binding',
        Boolean(chainCredential) &&
          chainCredential?.credentialType === 1 &&
          getAddress(chainCredential.subject) === getAddress(session.address) &&
          getAddress(chainCredential.issuer) === getAddress(administrator) &&
          chainCredential.encryptedCid === stakeholder.credentialCid,
        'CredentialRegistry subject, issuer, type, and encrypted reference match the stakeholder record.',
      ),
      identityCheck(
        'Credential lifecycle',
        lifecycleStatus === 'ACTIVE',
        `Current lifecycle status: ${lifecycleStatus}.`,
      ),
      identityCheck(
        'Current stakeholder authorization',
        session.onChainAuthorization?.status === 'AUTHORIZED',
        `Registry authorization status: ${session.onChainAuthorization?.status ?? 'UNAVAILABLE'}.`,
      ),
    ];
    response.verification = {
      checks,
      outcome: checks.every((check) => check.status === 'PASSED')
        ? 'CHECKS_PASSED'
        : 'CHECKS_FAILED',
      verifiedAt: now.toISOString(),
    };
    return response;
  }

  async prepareAdministratorCredentialOnChain(sessionId: string | undefined) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    if (
      session.onChainAuthorization?.status !== 'AUTHORIZED' ||
      session.onChainAuthorization.role !== CompanyRole.SYSTEM_ADMIN
    ) {
      throw new SsiApiError(
        'ADMIN_AUTHORIZATION_REQUIRED',
        'System Admin authorization is required to connect the Admin credential on-chain.',
        403,
      );
    }
    const gateway = this.dependencies.blockchainGateway;
    const repository = this.dependencies.issuanceRepository;
    const contentStore = this.dependencies.credentialContentStore;
    if (!gateway || !repository || !contentStore || !this.dependencies.chainId) {
      throw new SsiApiError(
        'ISSUANCE_UNAVAILABLE',
        'Credential storage or blockchain configuration is unavailable.',
        503,
      );
    }
    const administrator = getAddress(await gateway.getAdministrator());
    if (administrator !== getAddress(session.address)) {
      throw new SsiApiError(
        'ADMIN_WALLET_MISMATCH',
        'The authenticated wallet is not the deployed contract administrator.',
        403,
      );
    }
    const agent = await this.dependencies.agentProvider();
    const authorityDid = await this.authorityDid(agent);
    const match = await findStoredCompanyRoleCredential(agent, {
      authorityDid,
      companyId: 'TRACECHAIN_AUTHORITY',
      role: CompanyRole.SYSTEM_ADMIN,
      walletAddress: administrator,
      now: this.clock(),
    });
    if (!match) {
      throw new SsiApiError(
        'ADMIN_CREDENTIAL_UNAVAILABLE',
        'Run npm run ssi:bootstrap-admin before connecting the Admin credential on-chain.',
        409,
      );
    }
    const credentialId = id(match.credential.id);
    const credentialHash = `0x${match.credentialHash}`;
    const expiresAt = Math.floor(new Date(match.credential.expirationDate).getTime() / 1_000);
    let record = await repository.find(`0x${'0'.repeat(64)}`);
    if (!record) {
      const stored = await contentStore.encryptAndStore(
        serializeCompanyRoleCredential(match.credential),
        credentialId,
      );
      record = {
        applicantWallet: administrator,
        applicationId: `0x${'0'.repeat(64)}`,
        companyName: match.credential.credentialSubject.companyName,
        companyRegistrationNumber: match.credential.credentialSubject.companyRegistrationNumber,
        credentialHash,
        credentialId,
        encryptedCredentialCid: stored.cid,
        encryptedPayload: stored.payload,
        expiresAt,
        issuedAt: match.credential.issuanceDate,
        role: CompanyRole.SYSTEM_ADMIN,
      };
      await repository.save(record);
    } else if (
      record.credentialId !== credentialId ||
      record.credentialHash.toLowerCase() !== credentialHash.toLowerCase() ||
      getAddress(record.applicantWallet) !== administrator
    ) {
      throw new SsiApiError(
        'ISSUANCE_CONFLICT',
        'The persisted Admin credential does not match the active bootstrap credential.',
        409,
      );
    }

    const [credentialState, stakeholder] = await Promise.all([
      gateway.getCredentialState(record.credentialHash),
      gateway.getStakeholder(administrator),
    ]);
    if (credentialState.status !== 0) {
      const chainCredential = await gateway.getCredential(credentialState.credentialId);
      if (
        chainCredential.credentialType !== 1 ||
        getAddress(chainCredential.issuer) !== administrator ||
        getAddress(chainCredential.subject) !== administrator ||
        chainCredential.credentialHash.toLowerCase() !== record.credentialHash.toLowerCase() ||
        chainCredential.encryptedCid !== record.encryptedCredentialCid ||
        chainCredential.expiresAt !== record.expiresAt
      ) {
        throw new SsiApiError(
          'ON_CHAIN_CREDENTIAL_MISMATCH',
          'The existing on-chain Admin credential record does not match the verified credential.',
          409,
        );
      }
    }
    const registrationTransaction =
      credentialState.status === 0
        ? gateway.prepareCredentialRegistration({
            credentialHash: record.credentialHash,
            credentialId: record.credentialId,
            credentialReference: record.encryptedCredentialCid,
            expiresAt: record.expiresAt,
            subject: administrator,
          })
        : undefined;
    const referenceMatches =
      stakeholder.credentialHash.toLowerCase() === record.credentialHash.toLowerCase() &&
      stakeholder.credentialCid === record.encryptedCredentialCid &&
      stakeholder.credentialExpiresAt === record.expiresAt;
    return {
      credentialId: record.credentialId,
      credentialRegistrationTransaction: registrationTransaction,
      credentialReferenceTransaction: referenceMatches
        ? undefined
        : gateway.prepareCredentialReference({
            account: administrator,
            credentialHash: record.credentialHash,
            credentialReference: record.encryptedCredentialCid,
            expiresAt: record.expiresAt,
          }),
      state: !registrationTransaction && referenceMatches ? 'ACTIVE' : 'TRANSACTIONS_REQUIRED',
    };
  }

  async issueCredentialForApplication(
    sessionId: string | undefined,
    input: {
      applicationId: string;
      approvedRole: number;
      companyName: string;
      companyRegistrationNumber: string;
      expirationDate: Date;
    },
  ) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const verification = session.onChainAuthorization;
    if (verification?.status !== 'AUTHORIZED' || verification.role !== CompanyRole.SYSTEM_ADMIN) {
      throw new SsiApiError(
        'ADMIN_AUTHORIZATION_REQUIRED',
        'System Admin authorization is required to issue a Company Role Credential.',
        403,
      );
    }
    const gateway = this.dependencies.blockchainGateway;
    const repository = this.dependencies.issuanceRepository;
    const contentStore = this.dependencies.credentialContentStore;
    if (!gateway || !repository || !contentStore || !this.dependencies.chainId) {
      throw new SsiApiError(
        'ISSUANCE_UNAVAILABLE',
        'Credential issuance storage or blockchain configuration is unavailable.',
        503,
      );
    }

    const administrator = getAddress(await gateway.getAdministrator());
    if (administrator !== getAddress(session.address)) {
      throw new SsiApiError(
        'ADMIN_WALLET_MISMATCH',
        'The authenticated wallet is not the deployed contract administrator.',
        403,
      );
    }
    const application = await gateway.getApplicationForIssuance(input.applicationId);
    if (input.approvedRole !== application.requestedRole) {
      throw new SsiApiError(
        'APPROVED_ROLE_MISMATCH',
        'The approved role must match the role requested in the on-chain application.',
        409,
      );
    }
    const role = roleFromContract(application.requestedRole);
    const agent = await this.dependencies.agentProvider();
    const authorityDid = await this.authorityDid(agent);
    const existing = await repository.find(input.applicationId);
    if (existing) {
      if (
        getAddress(existing.applicantWallet) !== getAddress(application.applicant) ||
        existing.role !== role ||
        existing.companyName !== input.companyName ||
        existing.companyRegistrationNumber !== input.companyRegistrationNumber ||
        existing.expiresAt !== Math.floor(input.expirationDate.getTime() / 1_000)
      ) {
        throw new SsiApiError(
          'ISSUANCE_CONFLICT',
          'This application already has a different persisted issuance workflow.',
          409,
        );
      }
      const credential = companyRoleCredentialSchema.parse(
        JSON.parse(await contentStore.decrypt(existing.encryptedPayload)),
      );
      await this.verifyIssuedCredential(
        agent,
        credential,
        application.applicant,
        authorityDid,
        existing.credentialHash,
      );
      return this.issuanceResponse(existing, credential, application.status, gateway);
    }
    if (application.status !== 1) {
      throw new SsiApiError(
        'APPLICATION_NOT_PENDING',
        'Only a pending application can start credential issuance.',
        409,
      );
    }

    const issued = await issueCompanyRoleCredential(agent, {
      applicationReference: input.applicationId,
      companyId: `urn:tracechain:company:${input.companyRegistrationNumber}`,
      companyName: input.companyName,
      companyRegistrationNumber: input.companyRegistrationNumber,
      expirationDate: input.expirationDate,
      issuanceDate: this.clock(),
      issuerDid: authorityDid,
      issuerOperatorChainId: this.dependencies.chainId,
      issuerOperatorWallet: administrator,
      role,
      subjectDid: walletAddressToDid(application.applicant),
      walletAddress: application.applicant,
    });
    await this.verifyIssuedCredential(
      agent,
      issued.credential,
      application.applicant,
      authorityDid,
      issued.credentialHash,
    );
    const credentialHash = `0x${issued.credentialHash}`;
    const credentialId = id(issued.credential.id);
    const expiresAt = Math.floor(input.expirationDate.getTime() / 1_000);
    const stored = await contentStore.encryptAndStore(
      serializeCompanyRoleCredential(issued.credential),
      credentialId,
    );
    const record: CompanyRoleIssuanceRecord = {
      applicantWallet: application.applicant,
      applicationId: input.applicationId,
      companyName: input.companyName,
      companyRegistrationNumber: input.companyRegistrationNumber,
      credentialHash,
      credentialId,
      encryptedCredentialCid: stored.cid,
      encryptedPayload: stored.payload,
      expiresAt,
      issuedAt: issued.credential.issuanceDate,
      role,
    };
    await repository.save(record);
    return this.issuanceResponse(record, issued.credential, application.status, gateway);
  }

  private async issuanceResponse(
    record: CompanyRoleIssuanceRecord,
    credential: ReturnType<typeof companyRoleCredentialSchema.parse>,
    applicationStatus: number,
    gateway: BlockchainGateway,
  ) {
    const credentialState = await gateway.getCredentialState(record.credentialHash);
    const approvalPending = applicationStatus === 1;
    const registrationPending = credentialState.status === 0;
    return {
      applicationStatus,
      approvalTransaction: approvalPending
        ? gateway.prepareApplicationApproval({
            applicationId: record.applicationId,
            credentialHash: record.credentialHash,
            credentialReference: record.encryptedCredentialCid,
            expiresAt: record.expiresAt,
          })
        : undefined,
      credential,
      credentialId: record.credentialId,
      credentialRegistrationTransaction: registrationPending
        ? gateway.prepareCredentialRegistration({
            credentialHash: record.credentialHash,
            credentialId: record.credentialId,
            credentialReference: record.encryptedCredentialCid,
            expiresAt: record.expiresAt,
            subject: record.applicantWallet,
          })
        : undefined,
      encryptedCredentialCid: record.encryptedCredentialCid,
      issuanceState:
        applicationStatus === 3 && credentialState.status === 1
          ? 'CREDENTIAL_ACTIVE'
          : applicationStatus === 3
            ? 'CREDENTIAL_REGISTRATION_PENDING'
            : 'APPLICATION_PENDING',
    };
  }

  private async verifyIssuedCredential(
    agent: TraceChainAgent,
    credential: unknown,
    applicantWallet: string,
    authorityDid: string,
    expectedHash: string,
  ) {
    const result = await verifyCompanyRoleCredential(
      agent,
      credential,
      applicantWallet,
      authorityDid,
      this.clock(),
    );
    if (!result.verified || result.credentialHash !== expectedHash.replace(/^0x/, '')) {
      throw new SsiApiError(
        'ISSUED_CREDENTIAL_INVALID',
        'The generated credential failed cryptographic verification.',
        500,
      );
    }
  }

  async verifyCredential(
    sessionId: string | undefined,
    credential: unknown,
  ): Promise<CompanyRoleVerificationApiResponse> {
    const session = await this.dependencies.authService.requireSession(sessionId);
    const agent = await this.dependencies.agentProvider();
    const authorityDidAlias =
      typeof this.dependencies.authorityDidAlias === 'function'
        ? this.dependencies.authorityDidAlias()
        : this.dependencies.authorityDidAlias;

    const authorityDid = await this.authorityDid(agent, authorityDidAlias);

    const verifiedAt = this.clock();
    const result = await verifyCompanyRoleCredential(
      agent,
      credential,
      session.address,
      authorityDid,
      verifiedAt,
    );
    const expirationStatus = expirationStatusFrom(result.reasons);

    if (
      !result.verified ||
      !result.credentialHash ||
      !result.credentialId ||
      !result.issuerDid ||
      !result.subjectDid ||
      !result.role
    ) {
      return {
        authorizationReady: false,
        credentialId: result.credentialId,
        expirationStatus,
        locallyVerified: false,
        onChainStatusChecked: false,
        reasons: result.reasons,
        verified: false,
      };
    }

    let authorizationReady = false;
    let onChainStatusChecked = false;
    if (this.dependencies.blockchainAuthorization) {
      try {
        authorizationReady = await this.dependencies.blockchainAuthorization.authorize({
          credentialHash: result.credentialHash,
          role: result.role,
          walletAddress: session.address,
        });
        onChainStatusChecked = true;
      } catch (error) {
        if (error instanceof BlockchainAuthorizationUnavailableError) {
          throw new SsiApiError(
            'BLOCKCHAIN_AUTHORIZATION_UNAVAILABLE',
            'The blockchain authorization service is unavailable. Check the RPC URL and deployed contract address.',
            503,
          );
        }
        throw error;
      }
    }

    const summary: CredentialVerificationSummary = {
      authorizationReady,
      credentialHash: result.credentialHash,
      credentialId: result.credentialId,
      issuerDid: result.issuerDid,
      locallyVerified: true,
      onChainStatusChecked,
      role: result.role,
      subjectDid: result.subjectDid,
      verifiedAt,
    };
    const updatedSession = await this.dependencies.authService.setCredentialVerification(
      session.id,
      summary,
    );

    return {
      authorizationReady,
      credentialId: result.credentialId,
      expirationStatus: 'VALID',
      locallyVerified: true,
      onChainStatusChecked,
      reasons: [],
      role: result.role,
      session: updatedSession,
      verified: true,
    };
  }

  private async authorityDid(agent: TraceChainAgent, alias?: string) {
    const authorityDidAlias =
      alias ??
      (typeof this.dependencies.authorityDidAlias === 'function'
        ? this.dependencies.authorityDidAlias()
        : this.dependencies.authorityDidAlias);
    try {
      return (await agent.didManagerGetByAlias({ alias: authorityDidAlias })).did;
    } catch {
      throw new SsiApiError(
        'AUTHORITY_DID_UNAVAILABLE',
        'The TraceChain authority identity is not configured.',
        503,
      );
    }
  }
}

function roleFromContract(role: number) {
  const roles: Partial<Record<number, CompanyRole>> = {
    2: CompanyRole.SUPPLIER,
    3: CompanyRole.MANUFACTURER,
    4: CompanyRole.DISTRIBUTOR,
    5: CompanyRole.RETAILER,
  };
  const resolved = roles[role];
  if (!resolved)
    throw new SsiApiError('UNSUPPORTED_ROLE', 'The requested company role is invalid.', 409);
  return resolved;
}

function roleFromContractForIdentity(role: number) {
  const roles: Partial<Record<number, CompanyRole>> = {
    1: CompanyRole.SYSTEM_ADMIN,
    2: CompanyRole.SUPPLIER,
    3: CompanyRole.MANUFACTURER,
    4: CompanyRole.DISTRIBUTOR,
    5: CompanyRole.RETAILER,
  };
  return roles[role];
}

function identityCheck(label: string, passed: boolean, detail: string): CompanyIdentityCheck {
  return { detail, label, status: passed ? 'PASSED' : 'FAILED' };
}

export function resolveLifecycleStatus(
  status: number | undefined,
  expirationDate: string,
  replaced: boolean,
  now: Date,
): CompanyIdentityResponse['identity']['lifecycleStatus'] {
  if (replaced) return 'REPLACED';
  if (status === 2) return 'SUSPENDED';
  if (status === 3) return 'REVOKED';
  if (new Date(expirationDate).getTime() <= now.getTime()) return 'EXPIRED';
  return status === 1 ? 'ACTIVE' : 'UNKNOWN';
}

function expirationStatusFrom(reasons: readonly string[]): CredentialExpirationStatus {
  if (reasons.includes('EXPIRED')) return 'EXPIRED';
  if (reasons.includes('NOT_YET_VALID')) return 'NOT_YET_VALID';
  return reasons.length === 0 ? 'VALID' : 'UNKNOWN';
}

/** One lazy promise is shared by all SSI requests in this API process. */
export function createDefaultTraceChainAgentProvider(): {
  agentProvider: TraceChainAgentProvider;
  authorityDidAlias: () => string;
} {
  let agentPromise: Promise<TraceChainAgent> | undefined;

  return {
    agentProvider: async () => {
      if (!agentPromise) {
        const environment = loadTraceChainSsiEnvironment();
        agentPromise = createTraceChainAgent(environment.config).catch((error: unknown) => {
          agentPromise = undefined;
          throw error;
        });
      }
      return agentPromise;
    },
    authorityDidAlias: () => loadTraceChainSsiEnvironment().authorityDidAlias,
  };
}
