import {
  createTraceChainAgent,
  verifyCompanyRoleCredential,
  type TraceChainAgent,
} from '@tracechain/ssi';

import { loadTraceChainSsiEnvironment } from '../../config/ssi-env.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CredentialVerificationSummary } from '../auth/auth.types.js';
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
  clock?: () => Date;
}

export class CompanyRoleSsiService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: CompanyRoleSsiServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
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

    let authorityDid: string;
    try {
      authorityDid = (await agent.didManagerGetByAlias({ alias: authorityDidAlias })).did;
    } catch {
      throw new SsiApiError(
        'AUTHORITY_DID_UNAVAILABLE',
        'The TraceChain authority identity is not configured.',
        503,
      );
    }

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

    const summary: CredentialVerificationSummary = {
      authorizationReady: false,
      credentialHash: result.credentialHash,
      credentialId: result.credentialId,
      issuerDid: result.issuerDid,
      locallyVerified: true,
      onChainStatusChecked: false,
      role: result.role,
      subjectDid: result.subjectDid,
      verifiedAt,
    };
    const updatedSession = await this.dependencies.authService.setCredentialVerification(
      session.id,
      summary,
    );

    return {
      authorizationReady: false,
      credentialId: result.credentialId,
      expirationStatus: 'VALID',
      locallyVerified: true,
      onChainStatusChecked: false,
      reasons: [],
      role: result.role,
      session: updatedSession,
      verified: true,
    };
  }
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
