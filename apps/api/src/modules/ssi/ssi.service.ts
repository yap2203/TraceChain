import {
  createTraceChainAgent,
  companyRoleCredentialSchema,
  serializeCompanyRoleCredential,
  issueCompanyRoleCredential,
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
    const verification = session.credentialVerification;
    if (
      !verification?.authorizationReady ||
      verification.role !== CompanyRole.SYSTEM_ADMIN
    ) {
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
      throw new SsiApiError('ISSUANCE_UNAVAILABLE', 'Credential issuance storage or blockchain configuration is unavailable.', 503);
    }

    const administrator = getAddress(await gateway.getAdministrator());
    if (administrator !== getAddress(session.address)) {
      throw new SsiApiError('ADMIN_WALLET_MISMATCH', 'The authenticated wallet is not the deployed contract administrator.', 403);
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
        throw new SsiApiError('ISSUANCE_CONFLICT', 'This application already has a different persisted issuance workflow.', 409);
      }
      const credential = companyRoleCredentialSchema.parse(
        JSON.parse(await contentStore.decrypt(existing.encryptedPayload)),
      );
      await this.verifyIssuedCredential(agent, credential, application.applicant, authorityDid, existing.credentialHash);
      return this.issuanceResponse(existing, credential, application.status, gateway);
    }
    if (application.status !== 1) {
      throw new SsiApiError('APPLICATION_NOT_PENDING', 'Only a pending application can start credential issuance.', 409);
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
      throw new SsiApiError('ISSUED_CREDENTIAL_INVALID', 'The generated credential failed cryptographic verification.', 500);
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
  if (!resolved) throw new SsiApiError('UNSUPPORTED_ROLE', 'The requested company role is invalid.', 409);
  return resolved;
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
