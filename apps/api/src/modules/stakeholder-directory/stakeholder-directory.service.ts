import { CompanyRole } from '@tracechain/shared';
import { getAddress } from 'ethers';

import type { OnChainAuthorizationSummary } from '../auth/auth.types.js';
import type { LoginAuthorizationResolver } from '../blockchain/login-authorization.service.js';
import type {
  CompanyRoleIssuanceRecord,
  CompanyRoleIssuanceRepository,
} from '../ssi/issuance.repository.js';

export interface StakeholderIdentity {
  active: true;
  companyName: string;
  role: CompanyRole;
  walletAddress: string;
}

export interface StakeholderDirectory {
  list(): Promise<StakeholderIdentity[]>;
  resolve(
    walletAddress: string,
    authorization?: OnChainAuthorizationSummary,
  ): Promise<StakeholderIdentity | null>;
  resolveMany(walletAddresses: string[]): Promise<StakeholderIdentity[]>;
}

export class VerifiedStakeholderDirectory implements StakeholderDirectory {
  constructor(
    private readonly issuanceRepository: CompanyRoleIssuanceRepository,
    private readonly authorizationResolver: LoginAuthorizationResolver,
  ) {}

  async list() {
    const records = await this.issuanceRepository.list();
    return this.resolveCandidates(uniqueWallets(records), records);
  }

  async resolve(walletAddress: string, authorization?: OnChainAuthorizationSummary) {
    const address = getAddress(walletAddress);
    const records = await this.issuanceRepository.list();
    const wallets = uniqueWallets(records);
    if (!wallets.some((wallet) => sameAddress(wallet, address))) wallets.push(address);
    const authorizations = new Map<string, OnChainAuthorizationSummary>();
    if (authorization) authorizations.set(address.toLowerCase(), authorization);
    const identities = await this.resolveCandidates(wallets, records, authorizations);
    return identities.find((identity) => sameAddress(identity.walletAddress, address)) ?? null;
  }

  async resolveMany(walletAddresses: string[]) {
    const records = await this.issuanceRepository.list();
    return this.resolveCandidates(
      [...new Set(walletAddresses.map((wallet) => getAddress(wallet)))],
      records,
    );
  }

  private async resolveCandidates(
    wallets: string[],
    records: CompanyRoleIssuanceRecord[],
    knownAuthorizations = new Map<string, OnChainAuthorizationSummary>(),
  ) {
    const candidates = (
      await Promise.all(
        wallets.map(async (walletAddress) => {
          try {
            const address = getAddress(walletAddress);
            const authorization =
              knownAuthorizations.get(address.toLowerCase()) ??
              (await this.authorizationResolver.resolve(address));
            if (authorization.status !== 'AUTHORIZED' || !authorization.role) return null;

            const record = currentRecord(records, address, authorization);
            const companyName = cleanName(record?.companyName) ?? fallbackName(authorization.role);
            return {
              active: true as const,
              companyName,
              role: authorization.role,
              walletAddress: address,
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter((identity): identity is StakeholderIdentity => identity !== null);

    const nameCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const key = candidate.companyName.toLocaleLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    return candidates.map((candidate) =>
      (nameCounts.get(candidate.companyName.toLocaleLowerCase()) ?? 0) > 1
        ? {
            ...candidate,
            companyName: `${candidate.companyName} (${shortWallet(candidate.walletAddress)})`,
          }
        : candidate,
    );
  }
}

function currentRecord(
  records: CompanyRoleIssuanceRecord[],
  walletAddress: string,
  authorization: OnChainAuthorizationSummary,
) {
  if (!authorization.credentialId) return undefined;
  const credentialId = authorization.credentialId.toLowerCase();
  return records
    .filter(
      (record) =>
        sameAddress(record.applicantWallet, walletAddress) &&
        record.role === authorization.role &&
        record.credentialId.toLowerCase() === credentialId,
    )
    .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt))[0];
}

function uniqueWallets(records: CompanyRoleIssuanceRecord[]) {
  const wallets = new Map<string, string>();
  for (const record of records) {
    try {
      const address = getAddress(record.applicantWallet);
      wallets.set(address.toLowerCase(), address);
    } catch {
      // Invalid legacy records are not trusted or exposed.
    }
  }
  return [...wallets.values()];
}

function sameAddress(left: string, right: string) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function cleanName(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name || undefined;
}

function fallbackName(role: CompanyRole) {
  return `Verified ${roleLabel(role)}`;
}

function roleLabel(role: CompanyRole) {
  return role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shortWallet(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
