import { CompanyRole } from '@tracechain/shared';
import { getAddress } from 'ethers';

import type { OnChainAuthorizationSummary } from '../auth/auth.types.js';
import type { BlockchainGateway, ChainApplicationRecord } from './blockchain-gateway.service.js';

const roleByNumber: Partial<Record<number, CompanyRole>> = {
  1: CompanyRole.SYSTEM_ADMIN,
  2: CompanyRole.SUPPLIER,
  3: CompanyRole.MANUFACTURER,
  4: CompanyRole.DISTRIBUTOR,
  5: CompanyRole.RETAILER,
};

export interface LoginAuthorizationResolver {
  resolve(walletAddress: string): Promise<OnChainAuthorizationSummary>;
}

export class GatewayLoginAuthorizationResolver implements LoginAuthorizationResolver {
  constructor(
    private readonly gateway: BlockchainGateway,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async resolve(walletAddress: string): Promise<OnChainAuthorizationSummary> {
    const checkedAt = this.clock();
    const address = getAddress(walletAddress);
    try {
      const administrator = getAddress(await this.gateway.getAdministrator());
      if (administrator === address) {
        const stakeholder = await this.gateway.getStakeholder(address);
        if (!/^0x0{64}$/i.test(stakeholder.credentialHash) && stakeholder.credentialCid) {
          const credentialState = await this.gateway.getCredentialState(stakeholder.credentialHash);
          if (!/^0x0{64}$/i.test(credentialState.credentialId)) {
            const credential = await this.gateway.getCredential(credentialState.credentialId);
            if (
              credentialState.status === 1 &&
              credential.credentialType === 1 &&
              getAddress(credential.issuer) === administrator &&
              getAddress(credential.subject) === address &&
              credential.credentialHash.toLowerCase() ===
                stakeholder.credentialHash.toLowerCase() &&
              credential.encryptedCid === stakeholder.credentialCid &&
              credential.expiresAt === stakeholder.credentialExpiresAt &&
              credential.expiresAt * 1_000 > checkedAt.getTime()
            ) {
              return {
                checkedAt,
                credentialHash: stakeholder.credentialHash,
                credentialId: credentialState.credentialId,
                role: CompanyRole.SYSTEM_ADMIN,
                status: 'AUTHORIZED',
              };
            }
          }
        }
        return {
          checkedAt,
          role: CompanyRole.SYSTEM_ADMIN,
          status: 'AUTHORIZED',
        };
      }

      const stakeholder = await this.gateway.getStakeholder(address);
      if (stakeholder.status === 0) return this.applicationStatus(address, checkedAt);
      if (stakeholder.status === 2) return { checkedAt, status: 'SUSPENDED' };
      if (stakeholder.status === 3) return { checkedAt, status: 'REVOKED' };
      if (stakeholder.status !== 1) return this.applicationStatus(address, checkedAt);
      if (stakeholder.credentialExpiresAt * 1_000 <= checkedAt.getTime())
        return { checkedAt, status: 'EXPIRED' };

      const role = roleByNumber[stakeholder.role];
      if (!role || role === CompanyRole.SYSTEM_ADMIN) return { checkedAt, status: 'UNAUTHORIZED' };
      if (/^0x0{64}$/i.test(stakeholder.credentialHash) || !stakeholder.credentialCid)
        return { checkedAt, role, status: 'ACTIVATION_PENDING' };

      const credentialState = await this.gateway.getCredentialState(stakeholder.credentialHash);
      if (/^0x0{64}$/i.test(credentialState.credentialId) || credentialState.status === 0)
        return { checkedAt, role, status: 'ACTIVATION_PENDING' };
      if (credentialState.status === 2) return { checkedAt, role, status: 'SUSPENDED' };
      if (credentialState.status === 3) return { checkedAt, role, status: 'REVOKED' };
      if (credentialState.status !== 1) return { checkedAt, role, status: 'UNAUTHORIZED' };

      const credential = await this.gateway.getCredential(credentialState.credentialId);
      const effectiveRole = await this.gateway.getEffectiveRole(address);
      if (credential.expiresAt * 1_000 <= checkedAt.getTime())
        return { checkedAt, role, status: 'EXPIRED' };
      if (
        credential.credentialType !== 1 ||
        getAddress(credential.issuer) !== administrator ||
        getAddress(credential.subject) !== address ||
        credential.credentialHash.toLowerCase() !== stakeholder.credentialHash.toLowerCase() ||
        credential.encryptedCid !== stakeholder.credentialCid ||
        credential.expiresAt !== stakeholder.credentialExpiresAt ||
        effectiveRole !== stakeholder.role
      )
        return { checkedAt, role, status: 'UNAUTHORIZED' };

      return {
        checkedAt,
        credentialHash: stakeholder.credentialHash,
        credentialId: credentialState.credentialId,
        role,
        status: 'AUTHORIZED',
      };
    } catch {
      return { checkedAt, status: 'UNAVAILABLE' };
    }
  }

  private async applicationStatus(
    address: string,
    checkedAt: Date,
  ): Promise<OnChainAuthorizationSummary> {
    const walletApplications = (await this.gateway.listApplications()).filter(
      (record) => getAddress(record.applicant) === address,
    );
    const supersededIds = new Set(
      walletApplications
        .map((record) => record.previousApplicationId.toLowerCase())
        .filter((id) => !/^0x0{64}$/.test(id)),
    );
    const applications = walletApplications
      .filter((record) => !supersededIds.has(record.id.toLowerCase()))
      .sort(compareApplications);
    const application = applications[0];
    if (!application) return { checkedAt, status: 'UNREGISTERED' };
    const common = {
      applicationId: application.id,
      applicationSubmittedAt: application.submittedAt,
      applicationUpdatedAt: application.updatedAt,
      checkedAt,
    };
    if (application.status === 'pending') return { ...common, status: 'APPLICATION_PENDING' };
    if (application.status === 'additional evidence required')
      return { ...common, status: 'ADDITIONAL_EVIDENCE_REQUIRED' };
    if (application.status === 'rejected') return { ...common, status: 'APPLICATION_REJECTED' };
    if (application.status === 'approved') return { ...common, status: 'ACTIVATION_PENDING' };
    return { ...common, status: 'UNREGISTERED' };
  }
}

function compareApplications(a: ChainApplicationRecord, b: ChainApplicationRecord) {
  return b.updatedAt - a.updatedAt || b.submittedAt - a.submittedAt || b.id.localeCompare(a.id);
}
