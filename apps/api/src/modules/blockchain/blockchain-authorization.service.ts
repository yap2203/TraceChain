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
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.registry = new Contract(registryAddress, stakeholderRegistryAbi, this.provider);
    this.credentialRegistry = new Contract(
      credentialRegistryAddress,
      credentialRegistryAbi,
      this.provider,
    );
  }

  async authorize(input: BlockchainAuthorizationInput): Promise<boolean> {
    try {
      if ((await this.provider.getCode(await this.registry.getAddress())) === '0x') {
        throw new BlockchainAuthorizationUnavailableError(
          'No StakeholderRegistry contract is deployed at the configured address.',
        );
      }

      const walletAddress = getAddress(input.walletAddress);
      const expectedRole = roleValues[input.role];

      if (input.role === CompanyRole.SYSTEM_ADMIN) {
        return getAddress(await this.registry.administrator()) === walletAddress;
      }

      const stakeholder = await this.registry.getStakeholder(walletAddress);
      const onChainHash = String(stakeholder.credentialHash).toLowerCase();
      const credentialHash = `0x${input.credentialHash.replace(/^0x/, '')}`.toLowerCase();

      const credentialId = String(await this.credentialRegistry.credentialIdByHash(credentialHash));
      const credentialActive =
        !/^0x0{64}$/i.test(credentialId) &&
        Number(await this.credentialRegistry.effectiveStatus(credentialId)) === 1;
      return (
        Number(stakeholder.status) === 1 &&
        Number(stakeholder.role) === expectedRole &&
        onChainHash === credentialHash &&
        Number(await this.registry.roleOf(walletAddress)) === expectedRole &&
        credentialActive
      );
    } catch (error) {
      if (error instanceof BlockchainAuthorizationUnavailableError) throw error;
      throw new BlockchainAuthorizationUnavailableError(
        error instanceof Error ? error.message : 'Blockchain authorization could not be checked.',
      );
    }
  }
}
