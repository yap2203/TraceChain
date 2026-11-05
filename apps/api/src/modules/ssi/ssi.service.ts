import {
  createTraceChainAgent,
  issueCompanyRoleCredential,
  verifyCompanyRoleCredential,
  walletAddressToDid,
  type TraceChainAgent,
} from '@tracechain/ssi';
import { CompanyRole } from '@tracechain/shared';
import { id } from 'ethers';

import { loadTraceChainSsiEnvironment } from '../../config/ssi-env.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CredentialVerificationSummary } from '../auth/auth.types.js';
import {
  BlockchainAuthorizationUnavailableError,
  type BlockchainAuthorizationService,
} from '../blockchain/blockchain-authorization.service.js';
import type { BlockchainGateway } from '../blockchain/blockchain-gateway.service.js';
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
  clock?: () => Date;
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
      companyId: string;
      companyName: string;
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
    if (!this.dependencies.blockchainGateway) {
      throw new SsiApiError('BLOCKCHAIN_GATEWAY_UNAVAILABLE', 'The blockchain gateway is unavailable.', 503);
    }

    const application = await this.dependencies.blockchainGateway.getApplicationForIssuance(
      input.applicationId,
    );
    if (application.status !== 1) {
      throw new SsiApiError('APPLICATION_NOT_PENDING', 'Only a pending application can be approved.', 409);
    }
    const role = roleFromContract(application.requestedRole);
    const agent = await this.dependencies.agentProvider();
    const authorityDid = await this.authorityDid(agent);
    const issued = await issueCompanyRoleCredential(agent, {
      companyId: input.companyId,
      companyName: input.companyName,
      expirationDate: input.expirationDate,
      issuanceDate: this.clock(),
      issuerDid: authorityDid,
      role,
      subjectDid: walletAddressToDid(application.applicant),
      walletAddress: application.applicant,
    });
    const credentialHash = `0x${issued.credentialHash}`;
    const credentialId = id(issued.credential.id);
    const credentialReference = `urn:tracechain:credential:${credentialId}`;
    const expiresAt = Math.floor(input.expirationDate.getTime() / 1_000);

    return {
      approvalTransaction: this.dependencies.blockchainGateway.prepareApplicationApproval({
        applicationId: input.applicationId,
        credentialHash,
        credentialReference,
        expiresAt,
      }),
      credential: issued.credential,
      credentialId,
      credentialRegistrationTransaction:
        this.dependencies.blockchainGateway.prepareCredentialRegistration({
          credentialHash,
          credentialId,
          credentialReference,
          expiresAt,
          subject: application.applicant,
        }),
    };
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
