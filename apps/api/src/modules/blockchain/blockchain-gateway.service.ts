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
  'function roleOf(address account) view returns (uint8)',
  'function updateCredentialReference(address account, bytes32 newHash, string newCid, uint64 expiresAt)',
  'function suspendStakeholder(address account, bytes32 reasonHash)',
  'function reactivateStakeholder(address account)',
  'function revokeStakeholder(address account, bytes32 reasonHash)',
  'function roleHasPermission(uint8 role, bytes32 permission) view returns (bool)',
  'function setRolePermission(uint8 role, bytes32 permission, bool allowed)',
  'function getPersonalPermission(address account, bytes32 permission) view returns (uint8)',
  'function hasPermission(address account, bytes32 permission) view returns (bool)',
  'function setPersonalPermission(address account, bytes32 permission, uint8 setting)',
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

const ingredientRegistryAbi = [
  'event IngredientBatchRegistered(bytes32 indexed batchId,address indexed supplier,bytes32 indexed credentialId,uint256 quantity,bytes32 metadataHash,string encryptedCid)',
  'function getBatch(bytes32 batchId) view returns (tuple(address supplier,bytes32 metadataHash,string encryptedCid,bytes32 credentialId,uint256 totalQuantity,uint256 availableQuantity,bytes32 unit,uint64 producedAt,uint64 expiresAt,uint8 status))',
] as const;
const productRegistryAbi = [
  'event ProductCreated(bytes32 indexed batchId,address indexed manufacturer,uint256 quantity,bytes32 metadataHash,string publicCid)',
  'function getProduct(bytes32 id) view returns (tuple(address manufacturer,bytes32 metadataHash,string publicCid,uint256 totalQuantity,bytes32 unit,uint64 producedAt,uint64 expiresAt,uint8 status))',
  'function getIngredientLinks(bytes32 id) view returns (tuple(bytes32 batchId,uint256 quantity)[])',
] as const;
const custodyTransferAbi = [
  'event TransferCreated(bytes32 indexed transferId,bytes32 indexed productBatchId,address indexed sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid)',
  'function getTransfer(bytes32 id) view returns (tuple(bytes32 productBatchId,address sender,address recipient,uint256 quantity,bytes32 shipmentHash,string shipmentCid,uint64 dispatchedAt,uint64 expectedAt,uint8 status,uint256 usable,uint256 damaged,uint256 rejected))',
  'function getInventory(bytes32 batchId,address holder) view returns (tuple(uint256 available,uint256 reserved,uint256 damaged,uint256 rejected))',
] as const;
const evidenceRegistryAbi = [
  'event EvidenceRequested(bytes32 indexed requestId,address indexed requester,address indexed supplier,bytes32 ingredientBatchId,bytes32 claimsHash,bytes32 challengeHash,string requestCid,uint64 dueAt)',
  'function getRequest(bytes32 requestId) view returns (tuple(address requester,address supplier,bytes32 ingredientBatchId,bytes32 claimsHash,bytes32 challengeHash,string requestCid,string presentationCid,bytes32 presentationHash,uint8 status,uint64 dueAt,uint64 presentationExpiresAt,uint64 updatedAt))',
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
  getPersonalPermission?(
    account: string,
    permission: string,
  ): Promise<{ setting: number; effective: boolean }>;
  preparePersonalPermission?(input: {
    account: string;
    permission: string;
    setting: number;
  }): PreparedTransaction;
  getRegistryReferences?(): { credentialRegistry: string; stakeholderRegistry: string };
  listOperationalData?(account: string): Promise<OperationalData>;
  getAdministrator(): Promise<string>;
  getApplicationForIssuance(applicationId: string): Promise<{
    applicant: string;
    requestedRole: number;
    status: number;
  }>;
  getCredentialState(credentialHash: string): Promise<{ credentialId: string; status: number }>;
  getCredential(credentialId: string): Promise<{
    credentialHash: string;
    credentialType: number;
    encryptedCid: string;
    expiresAt: number;
    issuedAt: number;
    issuer: string;
    status: number;
    subject: string;
    updatedAt: number;
  }>;
  getStakeholder(account: string): Promise<{
    credentialCid: string;
    credentialExpiresAt: number;
    credentialHash: string;
    role: number;
    status: number;
    updatedAt: number;
  }>;
  getEffectiveRole(account: string): Promise<number>;
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
  prepareCredentialReference(input: {
    account: string;
    credentialHash: string;
    credentialReference: string;
    expiresAt: number;
  }): PreparedTransaction;
  prepareCredentialLifecycle(input: {
    action: 'reactivate' | 'revoke' | 'suspend';
    credentialId: string;
    reasonHash?: string;
  }): PreparedTransaction;
  prepareStakeholderLifecycle(input: {
    account: string;
    action: 'reactivate' | 'revoke' | 'suspend';
    reasonHash?: string;
  }): PreparedTransaction;
  prepareRolePermission(input: {
    allowed: boolean;
    permission: string;
    role: number;
  }): PreparedTransaction;
}

export interface OperationalData {
  evidenceRequests: Array<Record<string, unknown>>;
  ingredientBatches: Array<Record<string, unknown>>;
  productBatches: Array<Record<string, unknown>>;
  transfers: Array<Record<string, unknown>>;
}

export class BlockchainGatewayService implements BlockchainGateway {
  private readonly provider: JsonRpcProvider;
  private readonly registry: Contract;
  private readonly credentialRegistry: Contract;
  private readonly ingredients: Contract;
  private readonly products: Contract;
  private readonly custody: Contract;
  private readonly evidence: Contract;

  constructor(
    private readonly chainId: number,
    rpcUrl: string,
    private readonly registryAddress: string,
    private readonly credentialRegistryAddress: string,
    ingredientRegistryAddress: string,
    productRegistryAddress: string,
    custodyTransferAddress: string,
    evidenceRegistryAddress: string,
  ) {
    this.provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    this.registry = new Contract(registryAddress, stakeholderRegistryAbi, this.provider);
    this.credentialRegistry = new Contract(
      credentialRegistryAddress,
      credentialRegistryAbi,
      this.provider,
    );
    this.ingredients = new Contract(
      ingredientRegistryAddress,
      ingredientRegistryAbi,
      this.provider,
    );
    this.products = new Contract(productRegistryAddress, productRegistryAbi, this.provider);
    this.custody = new Contract(custodyTransferAddress, custodyTransferAbi, this.provider);
    this.evidence = new Contract(evidenceRegistryAddress, evidenceRegistryAbi, this.provider);
  }

  async listOperationalData(account: string): Promise<OperationalData> {
    const normalized = account.toLowerCase();
    const [ingredientEvents, productEvents, transferEvents, evidenceEvents] = await Promise.all([
      this.ingredients.queryFilter(this.ingredients.filters.IngredientBatchRegistered()),
      this.products.queryFilter(this.products.filters.ProductCreated()),
      this.custody.queryFilter(this.custody.filters.TransferCreated()),
      this.evidence.queryFilter(this.evidence.filters.EvidenceRequested()),
    ]);
    const eventArg = (event: unknown, name: string) =>
      String((event as { args?: Record<string, unknown> }).args?.[name] ?? '');
    const ingredientIds = [...new Set(ingredientEvents.map((event) => eventArg(event, 'batchId')))];
    const productIds = [...new Set(productEvents.map((event) => eventArg(event, 'batchId')))];
    const transferIds = [...new Set(transferEvents.map((event) => eventArg(event, 'transferId')))];
    const requestIds = [...new Set(evidenceEvents.map((event) => eventArg(event, 'requestId')))];
    const allIngredients = await Promise.all(
      ingredientIds.map(async (batchId) => {
        const r = await this.ingredients.getBatch(batchId);
        return {
          batchId,
          supplier: String(r.supplier),
          metadataHash: String(r.metadataHash),
          encryptedCid: String(r.encryptedCid),
          credentialId: String(r.credentialId),
          totalQuantity: String(r.totalQuantity),
          availableQuantity: String(r.availableQuantity),
          unit: String(r.unit),
          producedAt: Number(r.producedAt),
          expiresAt: Number(r.expiresAt),
          status: Number(r.status),
        };
      }),
    );
    const allProducts = await Promise.all(
      productIds.map(async (batchId) => {
        const [r, links] = await Promise.all([
          this.products.getProduct(batchId),
          this.products.getIngredientLinks(batchId),
        ]);
        return {
          batchId,
          manufacturer: String(r.manufacturer),
          metadataHash: String(r.metadataHash),
          publicCid: String(r.publicCid),
          totalQuantity: String(r.totalQuantity),
          unit: String(r.unit),
          producedAt: Number(r.producedAt),
          expiresAt: Number(r.expiresAt),
          status: Number(r.status),
          ingredients: Array.from(links as ArrayLike<{ batchId: string; quantity: bigint }>).map(
            (link) => ({ batchId: String(link.batchId), quantity: String(link.quantity) }),
          ),
        };
      }),
    );
    const allTransfers = await Promise.all(
      transferIds.map(async (transferId) => {
        const r = await this.custody.getTransfer(transferId);
        const inventory = await this.custody.getInventory(String(r.productBatchId), account);
        return {
          transferId,
          productBatchId: String(r.productBatchId),
          sender: String(r.sender),
          recipient: String(r.recipient),
          quantity: String(r.quantity),
          shipmentHash: String(r.shipmentHash),
          shipmentCid: String(r.shipmentCid),
          dispatchedAt: Number(r.dispatchedAt),
          expectedAt: Number(r.expectedAt),
          status: Number(r.status),
          usable: String(r.usable),
          damaged: String(r.damaged),
          rejected: String(r.rejected),
          inventory: {
            available: String(inventory.available),
            reserved: String(inventory.reserved),
            damaged: String(inventory.damaged),
            rejected: String(inventory.rejected),
          },
        };
      }),
    );
    const relevantTransfers = allTransfers
      .filter(
        (r) => r.sender.toLowerCase() === normalized || r.recipient.toLowerCase() === normalized,
      )
      .map((r) => ({
        ...r,
        direction: r.recipient.toLowerCase() === normalized ? 'incoming' : 'outgoing',
      }));
    const relevantProductIds = new Set(relevantTransfers.map((r) => r.productBatchId));
    const evidenceRequests = await Promise.all(
      requestIds.map(async (requestId) => {
        const r = await this.evidence.getRequest(requestId);
        return {
          requestId,
          requester: String(r.requester),
          supplier: String(r.supplier),
          ingredientBatchId: String(r.ingredientBatchId),
          claimsHash: String(r.claimsHash),
          challengeHash: String(r.challengeHash),
          requestCid: String(r.requestCid),
          presentationCid: String(r.presentationCid),
          presentationHash: String(r.presentationHash),
          status: Number(r.status),
          dueAt: Number(r.dueAt),
          presentationExpiresAt: Number(r.presentationExpiresAt),
          updatedAt: Number(r.updatedAt),
        };
      }),
    );
    return {
      ingredientBatches: allIngredients.filter((r) => r.supplier.toLowerCase() === normalized),
      productBatches: allProducts.filter(
        (r) => r.manufacturer.toLowerCase() === normalized || relevantProductIds.has(r.batchId),
      ),
      transfers: relevantTransfers,
      evidenceRequests: evidenceRequests.filter(
        (r) => r.requester.toLowerCase() === normalized || r.supplier.toLowerCase() === normalized,
      ),
    };
  }

  getRegistryReferences() {
    return {
      credentialRegistry: this.credentialRegistryAddress,
      stakeholderRegistry: this.registryAddress,
    };
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
      credentialHash: String(record.credentialHash),
      credentialType: Number(record.credentialType),
      encryptedCid: String(record.encryptedCid),
      expiresAt: Number(record.expiresAt),
      issuedAt: Number(record.issuedAt),
      issuer: String(record.issuer),
      status: Number(record.status),
      subject: String(record.subject),
      updatedAt: Number(record.updatedAt),
    };
  }

  async getStakeholder(account: string) {
    const record = await this.registry.getStakeholder(account);
    return {
      credentialCid: String(record.credentialCid),
      credentialExpiresAt: Number(record.credentialExpiresAt),
      credentialHash: String(record.credentialHash),
      role: Number(record.role),
      status: Number(record.status),
      updatedAt: Number(record.updatedAt),
    };
  }
  async getEffectiveRole(account: string) {
    return Number(await this.registry.roleOf(account));
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

  prepareCredentialReference(input: {
    account: string;
    credentialHash: string;
    credentialReference: string;
    expiresAt: number;
  }): PreparedTransaction {
    return this.transaction(
      registryInterface.encodeFunctionData('updateCredentialReference', [
        input.account,
        input.credentialHash,
        input.credentialReference,
        input.expiresAt,
      ]),
    );
  }

  prepareCredentialLifecycle(input: {
    action: 'reactivate' | 'revoke' | 'suspend';
    credentialId: string;
    reasonHash?: string;
  }): PreparedTransaction {
    const data =
      input.action === 'reactivate'
        ? credentialRegistryInterface.encodeFunctionData('reactivateCredential', [
            input.credentialId,
          ])
        : credentialRegistryInterface.encodeFunctionData(
            input.action === 'suspend' ? 'suspendCredential' : 'revokeCredential',
            [input.credentialId, input.reasonHash],
          );
    return { chainId: this.chainId, data, to: this.credentialRegistryAddress, value: '0x0' };
  }
  prepareStakeholderLifecycle(input: {
    account: string;
    action: 'reactivate' | 'revoke' | 'suspend';
    reasonHash?: string;
  }): PreparedTransaction {
    const data =
      input.action === 'reactivate'
        ? registryInterface.encodeFunctionData('reactivateStakeholder', [input.account])
        : registryInterface.encodeFunctionData(
            input.action === 'suspend' ? 'suspendStakeholder' : 'revokeStakeholder',
            [input.account, input.reasonHash],
          );
    return this.transaction(data);
  }
  prepareRolePermission(input: {
    allowed: boolean;
    permission: string;
    role: number;
  }): PreparedTransaction {
    return this.transaction(
      registryInterface.encodeFunctionData('setRolePermission', [
        input.role,
        input.permission,
        input.allowed,
      ]),
    );
  }

  private transaction(data: string): PreparedTransaction {
    return { chainId: this.chainId, data, to: this.registryAddress, value: '0x0' };
  }

  async getPersonalPermission(account: string, permission: string) {
    const [setting, effective] = await Promise.all([
      this.registry.getPersonalPermission(account, permission),
      this.registry.hasPermission(account, permission),
    ]);
    return { setting: Number(setting), effective: Boolean(effective) };
  }

  preparePersonalPermission(input: { account: string; permission: string; setting: number }) {
    return this.transaction(
      registryInterface.encodeFunctionData('setPersonalPermission', [
        input.account,
        input.permission,
        input.setting,
      ]),
    );
  }

  private async requireDeployment() {
    if ((await this.provider.getCode(this.registryAddress)) === '0x') {
      throw new Error('The configured StakeholderRegistry is not deployed.');
    }
  }
}
