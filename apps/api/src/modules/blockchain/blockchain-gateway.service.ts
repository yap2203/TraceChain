import { Contract, Interface, JsonRpcProvider } from 'ethers';

const stakeholderRegistryAbi = [
  'function applicationCount() view returns (uint256)',
  'function getApplicationIds(uint256 offset, uint256 limit) view returns (bytes32[])',
  'function getApplication(bytes32 applicationId) view returns (tuple(address applicant,uint8 requestedRole,uint8 status,bytes32 profileHash,string encryptedProfileCid,bytes32 previousApplicationId,uint64 submittedAt,uint64 updatedAt))',
  'function submitApplication(bytes32 applicationId, bytes32 profileHash, string encryptedProfileCid, uint8 requestedRole, bytes32 previousApplicationId)',
  'function rejectApplication(bytes32 applicationId, bytes32 reasonHash)',
  'function approveApplication(bytes32 applicationId, bytes32 credentialHash, string credentialCid, uint64 credentialExpiresAt)',
] as const;

const credentialRegistryAbi = [
  'function registerCredential(bytes32 credentialId, bytes32 credentialHash, string encryptedCid, address subject, uint8 credentialType, uint64 expiresAt)',
] as const;

const registryInterface = new Interface(stakeholderRegistryAbi);
const credentialRegistryInterface = new Interface(credentialRegistryAbi);
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
  getApplicationForIssuance(applicationId: string): Promise<{
    applicant: string;
    requestedRole: number;
    status: number;
  }>;
  listApplications(): Promise<unknown[]>;
  prepareApplication(input: {
    applicationId: string;
    encryptedProfileCid: string;
    previousApplicationId: string;
    profileHash: string;
    requestedRole: number;
  }): PreparedTransaction;
  prepareRejection(applicationId: string, reasonHash: string): PreparedTransaction;
  prepareApplicationApproval(input: {
    applicationId: string;
    credentialHash: string;
    credentialReference: string;
    expiresAt: number;
  }): PreparedTransaction;
  prepareCredentialRegistration(input: {
    credentialHash: string;
    credentialId: string;
    credentialReference: string;
    expiresAt: number;
    subject: string;
  }): PreparedTransaction;
}

export class BlockchainGatewayService implements BlockchainGateway {
  private readonly provider: JsonRpcProvider;
  private readonly registry: Contract;

  constructor(
    private readonly chainId: number,
    rpcUrl: string,
    private readonly registryAddress: string,
    private readonly credentialRegistryAddress: string,
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.registry = new Contract(registryAddress, stakeholderRegistryAbi, this.provider);
  }

  async getApplicationForIssuance(applicationId: string) {
    await this.requireDeployment();
    const record = await this.registry.getApplication(applicationId);
    return {
      applicant: String(record.applicant),
      requestedRole: Number(record.requestedRole),
      status: Number(record.status),
    };
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

  prepareApplicationApproval(input: {
    applicationId: string;
    credentialHash: string;
    credentialReference: string;
    expiresAt: number;
  }): PreparedTransaction {
    return this.transaction(
      registryInterface.encodeFunctionData('approveApplication', [
        input.applicationId,
        input.credentialHash,
        input.credentialReference,
        input.expiresAt,
      ]),
    );
  }

  prepareCredentialRegistration(input: {
    credentialHash: string;
    credentialId: string;
    credentialReference: string;
    expiresAt: number;
    subject: string;
  }): PreparedTransaction {
    return {
      chainId: this.chainId,
      data: credentialRegistryInterface.encodeFunctionData('registerCredential', [
        input.credentialId,
        input.credentialHash,
        input.credentialReference,
        input.subject,
        1,
        input.expiresAt,
      ]),
      to: this.credentialRegistryAddress,
      value: '0x0',
    };
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
