import { Contract, Interface, JsonRpcProvider } from 'ethers';

const stakeholderRegistryAbi = [
  'function applicationCount() view returns (uint256)',
  'function getApplicationIds(uint256 offset, uint256 limit) view returns (bytes32[])',
  'function getApplication(bytes32 applicationId) view returns (tuple(address applicant,uint8 requestedRole,uint8 status,bytes32 profileHash,string encryptedProfileCid,bytes32 previousApplicationId,uint64 submittedAt,uint64 updatedAt))',
  'function submitApplication(bytes32 applicationId, bytes32 profileHash, string encryptedProfileCid, uint8 requestedRole, bytes32 previousApplicationId)',
  'function rejectApplication(bytes32 applicationId, bytes32 reasonHash)',
] as const;

const registryInterface = new Interface(stakeholderRegistryAbi);
const roles = ['', 'System Admin', 'Supplier', 'Manufacturer', 'Distributor', 'Retailer'] as const;
const statuses = [
  'none',
  'pending',
  'additional evidence required',
  'approved',
  'rejected',
  'withdrawn',
] as const;

export interface PreparedTransaction {
  chainId: number;
  data: string;
  to: string;
  value: '0x0';
}

export interface BlockchainGateway {
  listApplications(): Promise<unknown[]>;
  prepareApplication(input: {
    applicationId: string;
    encryptedProfileCid: string;
    previousApplicationId: string;
    profileHash: string;
    requestedRole: number;
  }): PreparedTransaction;
  prepareRejection(applicationId: string, reasonHash: string): PreparedTransaction;
}

export class BlockchainGatewayService implements BlockchainGateway {
  private readonly provider: JsonRpcProvider;
  private readonly registry: Contract;

  constructor(
    private readonly chainId: number,
    rpcUrl: string,
    private readonly registryAddress: string,
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.registry = new Contract(registryAddress, stakeholderRegistryAbi, this.provider);
  }

  async listApplications() {
    await this.requireDeployment();
    const count = Number(await this.registry.applicationCount());
    const ids = (await this.registry.getApplicationIds(0, count)) as string[];
    const applications = await Promise.all(
      ids.map(async (applicationId) => {
        const record = await this.registry.getApplication(applicationId);
        return {
          applicant: String(record.applicant),
          encryptedProfileCid: String(record.encryptedProfileCid),
          id: applicationId,
          previousApplicationId: String(record.previousApplicationId),
          profileHash: String(record.profileHash),
          requestedRole: roles[Number(record.requestedRole)] ?? 'Unknown',
          status: statuses[Number(record.status)] ?? 'none',
          submittedAt: Number(record.submittedAt),
          updatedAt: Number(record.updatedAt),
        };
      }),
    );
    return applications.reverse();
  }

  prepareApplication(input: {
    applicationId: string;
    encryptedProfileCid: string;
    previousApplicationId: string;
    profileHash: string;
    requestedRole: number;
  }): PreparedTransaction {
    return this.transaction(
      registryInterface.encodeFunctionData('submitApplication', [
        input.applicationId,
        input.profileHash,
        input.encryptedProfileCid,
        input.requestedRole,
        input.previousApplicationId,
      ]),
    );
  }

  prepareRejection(applicationId: string, reasonHash: string): PreparedTransaction {
    return this.transaction(
      registryInterface.encodeFunctionData('rejectApplication', [applicationId, reasonHash]),
    );
  }

  private transaction(data: string): PreparedTransaction {
    return { chainId: this.chainId, data, to: this.registryAddress, value: '0x0' };
  }

  private async requireDeployment() {
    if ((await this.provider.getCode(this.registryAddress)) === '0x') {
      throw new Error('The configured StakeholderRegistry is not deployed.');
    }
  }
}
