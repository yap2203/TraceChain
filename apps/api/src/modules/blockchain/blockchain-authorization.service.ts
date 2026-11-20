import { blockchainProvider } from './rpc-provider.js';
import { CompanyRole } from '@tracechain/shared';
import { Contract, getAddress, JsonRpcProvider } from 'ethers';

const stakeholderRegistryAbi = [
  'function administrator() view returns (address)',
  'function getStakeholder(address account) view returns (tuple(uint8 role,uint8 status,bytes32 credentialHash,string credentialCid,uint64 credentialExpiresAt,uint64 updatedAt))',
  'function roleOf(address account) view returns (uint8)',
] as const;
const credentialRegistryAbi = [
  'function credentialIdByHash(bytes32 credentialHash) view returns (bytes32)',
  'function effectiveStatus(bytes32 credentialId) view returns (uint8)',
] as const;

const roleValues: Record<CompanyRole, number> = {
  [CompanyRole.SYSTEM_ADMIN]: 1,
  [CompanyRole.SUPPLIER]: 2,
  [CompanyRole.MANUFACTURER]: 3,
  [CompanyRole.DISTRIBUTOR]: 4,
  [CompanyRole.RETAILER]: 5,
};

export interface BlockchainAuthorizationInput {
  credentialHash: string;
  role: CompanyRole;
  walletAddress: string;
}

export interface BlockchainAuthorizationService {
  authorize(input: BlockchainAuthorizationInput): Promise<boolean>;
}

export class BlockchainAuthorizationUnavailableError extends Error {}

export class EthersBlockchainAuthorizationService implements BlockchainAuthorizationService {
  private readonly provider: JsonRpcProvider;
  private readonly registry: Contract;
  private readonly credentialRegistry: Contract;

  constructor(
    rpcUrl: string,
    registryAddress: string,
    credentialRegistryAddress: string,
    chainId: number,
  ) {
    this.provider = blockchainProvider(rpcUrl, chainId);
    this.registry = new Contract(registryAddress, stakeholderRegistryAbi, this.provider);
    this.credentialRegistry = new Contract(
      credentialRegistryAddress,
      credentialRegistryAbi,
      this.provider,
    );
  }

  async authorize(input: BlockchainAuthorizationInput): Promise<boolean> {
    try {
      const walletAddress = getAddress(input.walletAddress);
      const expectedRole = roleValues[input.role];
      const registryAddress = await this.registry.getAddress();

      if (input.role === CompanyRole.SYSTEM_ADMIN) {
        const [code, administrator] = await Promise.all([
          this.provider.getCode(registryAddress),
          this.registry.administrator(),
        ]);
        if (code === '0x')
          throw new BlockchainAuthorizationUnavailableError(
            'No StakeholderRegistry contract is deployed at the configured address.',
          );
        return getAddress(administrator) === walletAddress;
      }

      const credentialHash = `0x${input.credentialHash.replace(/^0x/, '')}`.toLowerCase();
      const [code, stakeholder, effectiveRole, credentialIdValue] = await Promise.all([
        this.provider.getCode(registryAddress),
        this.registry.getStakeholder(walletAddress),
        this.registry.roleOf(walletAddress),
        this.credentialRegistry.credentialIdByHash(credentialHash),
      ]);
      if (code === '0x') {
        throw new BlockchainAuthorizationUnavailableError(
          'No StakeholderRegistry contract is deployed at the configured address.',
        );
      }
      const onChainHash = String(stakeholder.credentialHash).toLowerCase();
      const credentialId = String(credentialIdValue);
      if (
        Number(stakeholder.status) !== 1 ||
        Number(stakeholder.role) !== expectedRole ||
        onChainHash !== credentialHash ||
        Number(effectiveRole) !== expectedRole ||
        /^0x0{64}$/i.test(credentialId)
      )
        return false;
      return Number(await this.credentialRegistry.effectiveStatus(credentialId)) === 1;
    } catch (error) {
      if (error instanceof BlockchainAuthorizationUnavailableError) throw error;
      throw new BlockchainAuthorizationUnavailableError(
        error instanceof Error ? error.message : 'Blockchain authorization could not be checked.',
      );
    }
  }
}
