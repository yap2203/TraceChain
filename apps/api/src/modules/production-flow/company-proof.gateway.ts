import { Contract, Interface, getAddress } from 'ethers';
import type { PreparedTransaction } from '../blockchain/blockchain-gateway.service.js';
import { blockchainProvider } from '../blockchain/rpc-provider.js';
import { queryContractEvents } from '../blockchain/contract-events.js';

const abi = [
  'function stakeholders() view returns(address)',
  'function get(bytes32) view returns(tuple(address verifier,address presenter,bytes32 challengeHash,bytes32 requestHash,string requestCid,uint64 expiresAt,bytes32 responseHash,string responseCid,uint8 status))',
  'function request(bytes32,address,bytes32,uint64,bytes32,string)',
  'function respond(bytes32,bytes32,bytes32,string)',
  'function review(bytes32,bool)',
  'function bindings(address) view returns(bytes32 sourceHash,bytes32 contentHash,string cid)',
  'function registerBinding(bytes32,bytes32,string)',
  'event Requested(bytes32 indexed requestId,address indexed verifier,address indexed presenter)',
];
export interface CompanyProofReference {
  verifier: string;
  presenter: string;
  challengeHash: string;
  requestHash: string;
  requestCid: string;
  expiresAt: number;
  responseHash: string;
  responseCid: string;
  status: number;
}
export interface CompanyProofReferences {
  domain: { chainId: number; verifyingContract: string };
  get(id: string): Promise<CompanyProofReference | undefined>;
  list(wallet: string): Promise<string[]>;
  binding(wallet: string): Promise<{ sourceHash: string; contentHash: string; cid: string }>;
  prepare(
    method: 'request' | 'respond' | 'review' | 'registerBinding',
    args: unknown[],
  ): PreparedTransaction;
}
export class EthersCompanyProofReferences implements CompanyProofReferences {
  readonly domain;
  private readonly contract: Contract;
  constructor(
    chainId: number,
    url: string,
    address: string,
    private readonly stakeholders: string,
  ) {
    this.domain = { chainId, verifyingContract: getAddress(address) };
    this.contract = new Contract(address, abi, blockchainProvider(url, chainId));
  }
  private async assertDeployment() {
    if (getAddress(await this.contract.stakeholders()) !== getAddress(this.stakeholders))
      throw new Error('Company proof registry belongs to another deployment.');
  }
  async get(requestId: string) {
    await this.assertDeployment();
    const r = await this.contract.get(requestId);
    if (!Number(r.status)) return undefined;
    return {
      verifier: String(r.verifier),
      presenter: String(r.presenter),
      challengeHash: String(r.challengeHash),
      requestHash: String(r.requestHash),
      requestCid: String(r.requestCid),
      expiresAt: Number(r.expiresAt),
      responseHash: String(r.responseHash),
      responseCid: String(r.responseCid),
      status: Number(r.status),
    };
  }
  async list(wallet: string) {
    await this.assertDeployment();
    const [sent, received] = await Promise.all([
      queryContractEvents(this.contract, this.contract.filters.Requested(null, wallet)),
      queryContractEvents(this.contract, this.contract.filters.Requested(null, null, wallet)),
    ]);
    return [
      ...new Set([...sent, ...received].map((event) => String((event as any).args.requestId))),
    ];
  }
  async binding(wallet: string) {
    await this.assertDeployment();
    const r = await this.contract.bindings(wallet);
    return {
      sourceHash: String(r.sourceHash),
      contentHash: String(r.contentHash),
      cid: String(r.cid),
    };
  }
  prepare(
    method: 'request' | 'respond' | 'review' | 'registerBinding',
    args: unknown[],
  ): PreparedTransaction {
    return {
      chainId: this.domain.chainId,
      to: this.domain.verifyingContract,
      value: '0x0',
      data: new Interface(abi).encodeFunctionData(method, args),
    };
  }
}
