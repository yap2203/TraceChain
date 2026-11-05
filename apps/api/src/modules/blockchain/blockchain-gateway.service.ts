import { Contract, Interface, JsonRpcProvider } from 'ethers';

const stakeholderRegistryAbi = [
  'function administrator() view returns (address)',
  'function applicationCount() view returns (uint256)',
  'function getApplicationIds(uint256 offset, uint256 limit) view returns (bytes32[])',
  'function getApplication(bytes32 applicationId) view returns (tuple(address applicant,uint8 requestedRole,uint8 status,bytes32 profileHash,string encryptedProfileCid,bytes32 previousApplicationId,uint64 submittedAt,uint64 updatedAt))',
  'function submitApplication(bytes32 applicationId, bytes32 profileHash, string encryptedProfileCid, uint8 requestedRole, bytes32 previousApplicationId)',
  'function rejectApplication(bytes32 applicationId, bytes32 reasonHash)',
  'function approveApplication(bytes32 applicationId, bytes32 credentialHash, string credentialCid, uint64 credentialExpiresAt)',
  'function getStakeholder(address account) view returns (tuple(uint8 role,uint8 status,bytes32 credentialHash,string credentialCid,uint64 credentialExpiresAt,uint64 updatedAt))',
  'function suspendStakeholder(address account, bytes32 reasonHash)',
  'function reactivateStakeholder(address account)',
  'function revokeStakeholder(address account, bytes32 reasonHash)',
  'function roleHasPermission(uint8 role, bytes32 permission) view returns (bool)',
  'function setRolePermission(uint8 role, bytes32 permission, bool allowed)',
] as const;

const credentialRegistryAbi = [
  'function credentialIdByHash(bytes32 credentialHash) view returns (bytes32)',
  'function effectiveStatus(bytes32 credentialId) view returns (uint8)',
  'function getCredential(bytes32 credentialId) view returns (tuple(bytes32 credentialHash,string encryptedCid,address issuer,address subject,uint8 credentialType,uint8 status,uint64 issuedAt,uint64 expiresAt,uint64 updatedAt))',
  'function registerCredential(bytes32 credentialId, bytes32 credentialHash, string encryptedCid, address subject, uint8 credentialType, uint64 expiresAt)',
  'function suspendCredential(bytes32 credentialId, bytes32 reasonHash)',
  'function reactivateCredential(bytes32 credentialId)',
  'function revokeCredential(bytes32 credentialId, bytes32 reasonHash)',
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

export interface ChainApplicationRecord {
  applicant: string;
  encryptedProfileCid: string;
  id: string;
  previousApplicationId: string;
  profileHash: string;
  requestedRole: string;
  status: string;
  submittedAt: number;
  updatedAt: number;
}

export interface BlockchainGateway {
  getAdministrator(): Promise<string>;
  getApplicationForIssuance(applicationId: string): Promise<{
    applicant: string;
    requestedRole: number;
    status: number;
  }>;
  getCredentialState(credentialHash: string): Promise<{ credentialId: string; status: number }>;
  getCredential(credentialId: string): Promise<{
    credentialHash: string; encryptedCid: string; expiresAt: number; issuedAt: number;
    issuer: string; status: number; subject: string; updatedAt: number;
  }>;
  getStakeholder(account: string): Promise<{ credentialExpiresAt: number; credentialHash: string; role: number; status: number; updatedAt: number }>;
  getRolePermission(role: number, permission: string): Promise<boolean>;
  listApplications(): Promise<ChainApplicationRecord[]>;
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
  prepareCredentialLifecycle(input: { action: 'reactivate' | 'revoke' | 'suspend'; credentialId: string; reasonHash?: string }): PreparedTransaction;
  prepareStakeholderLifecycle(input: { account: string; action: 'reactivate' | 'revoke' | 'suspend'; reasonHash?: string }): PreparedTransaction;
  prepareRolePermission(input: { allowed: boolean; permission: string; role: number }): PreparedTransaction;
}

export class BlockchainGatewayService implements BlockchainGateway {
  private readonly provider: JsonRpcProvider;
  private readonly registry: Contract;
  private readonly credentialRegistry: Contract;

  constructor(
    private readonly chainId: number,
    rpcUrl: string,
    private readonly registryAddress: string,
    private readonly credentialRegistryAddress: string,
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.registry = new Contract(registryAddress, stakeholderRegistryAbi, this.provider);
    this.credentialRegistry = new Contract(
      credentialRegistryAddress,
      credentialRegistryAbi,
      this.provider,
    );
  }

  async getAdministrator() {
    await this.requireDeployment();
    return String(await this.registry.administrator());
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

  async getCredentialState(credentialHash: string) {
    const credentialId = String(await this.credentialRegistry.credentialIdByHash(credentialHash));
    if (/^0x0{64}$/i.test(credentialId)) return { credentialId, status: 0 };
    return {
      credentialId,
      status: Number(await this.credentialRegistry.effectiveStatus(credentialId)),
    };
  }

  async getCredential(credentialId: string) {
    const record = await this.credentialRegistry.getCredential(credentialId);
    return {
      credentialHash: String(record.credentialHash), encryptedCid: String(record.encryptedCid),
      expiresAt: Number(record.expiresAt), issuedAt: Number(record.issuedAt), issuer: String(record.issuer),
      status: Number(record.status), subject: String(record.subject), updatedAt: Number(record.updatedAt),
    };
  }

  async getStakeholder(account: string) {
    const record = await this.registry.getStakeholder(account);
    return { credentialExpiresAt: Number(record.credentialExpiresAt), credentialHash: String(record.credentialHash), role: Number(record.role), status: Number(record.status), updatedAt: Number(record.updatedAt) };
  }
  async getRolePermission(role: number, permission: string) {
    return Boolean(await this.registry.roleHasPermission(role, permission));
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

  prepareCredentialLifecycle(input: { action: 'reactivate' | 'revoke' | 'suspend'; credentialId: string; reasonHash?: string }): PreparedTransaction {
    const data = input.action === 'reactivate'
      ? credentialRegistryInterface.encodeFunctionData('reactivateCredential', [input.credentialId])
      : credentialRegistryInterface.encodeFunctionData(
          input.action === 'suspend' ? 'suspendCredential' : 'revokeCredential',
          [input.credentialId, input.reasonHash],
        );
    return { chainId: this.chainId, data, to: this.credentialRegistryAddress, value: '0x0' };
  }
  prepareStakeholderLifecycle(input: { account: string; action: 'reactivate' | 'revoke' | 'suspend'; reasonHash?: string }): PreparedTransaction {
    const data = input.action === 'reactivate'
      ? registryInterface.encodeFunctionData('reactivateStakeholder', [input.account])
      : registryInterface.encodeFunctionData(input.action === 'suspend' ? 'suspendStakeholder' : 'revokeStakeholder', [input.account, input.reasonHash]);
    return this.transaction(data);
  }
  prepareRolePermission(input: { allowed: boolean; permission: string; role: number }): PreparedTransaction {
    return this.transaction(registryInterface.encodeFunctionData('setRolePermission', [input.role, input.permission, input.allowed]));
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
