import { blockchainProvider, registerRpcMulticallTarget } from '../blockchain/rpc-provider.js';
import { queryContractEvents, syncContractEvents } from '../blockchain/contract-events.js';
import { readFileSync } from 'node:fs';
import { Contract, Interface, JsonRpcProvider } from 'ethers';
import { waitForMinedBlockTime } from '@tracechain/shared';
import type { PreparedTransaction } from '../blockchain/blockchain-gateway.service.js';

export type ChainRecord = Record<string, any>;
export interface OrdersGateway {
  assertDeployment?(): Promise<void>;
  chainId: number;
  address: string;
  read(contract: string, method: string, args?: unknown[]): Promise<any>;
  events(contract: string, event: string): Promise<ChainRecord[]>;
  /** Runs page-display reads through the local read model when the gateway has one. */
  display?<T>(build: () => Promise<T>, refresh?: boolean): Promise<T>;
  prepare(
    actor: string,
    contract: string,
    method: string,
    args: unknown[],
    signal?: AbortSignal,
  ): Promise<PreparedTransaction>;
}
const artifactNames: Record<string, string> = {
  orders: 'traceability/SupplyChainOrders',
  delivery: 'traceability/IngredientDelivery',
  productDelivery: 'traceability/ProductDelivery',
  ingredients: 'traceability/IngredientRegistry',
  products: 'traceability/ProductRegistry',
  custody: 'traceability/CustodyTransfer',
  evidence: 'traceability/EvidenceRegistry',
  stakeholders: 'access/StakeholderRegistry',
  credentials: 'credentials/CredentialRegistry',
};
// Named fields only, with integer quantities serialized without precision loss.
function plain(value: any, outputs?: readonly any[]): any {
  if (typeof value === 'bigint') return value.toString();
  if (!Array.isArray(value)) return value;
  if (outputs?.length === 1 && outputs[0].baseType === 'tuple')
    return plain(value, outputs[0].components);
  if (outputs?.some((field) => field.name))
    return Object.fromEntries(
      outputs.map((field, i) => [
        field.name,
        plain(value[i], field.baseType === 'tuple' ? field.components : undefined),
      ]),
    );
  return Array.from(value, (entry) => plain(entry));
}
export class EthersOrdersGateway implements OrdersGateway {
  private deploymentVerification?: Promise<void>;
  async assertDeployment() {
    if (!this.deploymentVerification) {
      this.deploymentVerification = this.verifyDeployment();
      void this.deploymentVerification.catch(() => {
        this.deploymentVerification = undefined;
      });
    }
    return this.deploymentVerification;
  }
  /** Explicit diagnostic recheck; normal requests share the cached promise. */
  async recheckDeployment() {
    this.deploymentVerification = undefined;
    return this.assertDeployment();
  }
  private async verifyDeployment() {
    if (Number(BigInt(await this.provider.send('eth_chainId', []))) !== this.chainId)
      throw new Error('Wrong RPC chain.');
    if ((await this.provider.getCode(this.address)) === '0x')
      throw new Error('Order registry is not deployed.');
    await Promise.all(
      ['stakeholders', 'ingredients', 'products', 'evidence', 'custody'].map(async (name) => {
        if (
          String(await this.read('orders', name)).toLowerCase() !==
          this.addresses[name]?.toLowerCase()
        )
          throw new Error('Order registry deployment references do not match.');
      }),
    );
    await Promise.all(
      ['ingredients', 'custody'].map(async (name) => {
        if (
          String(await this.read(name, 'supplyOrders')).toLowerCase() !== this.address.toLowerCase()
        )
          throw new Error('Order ledger is not wired into inventory.');
      }),
    );
  }
  private contracts = new Map<string, Contract>();
  private provider: JsonRpcProvider;
  constructor(
    public chainId: number,
    public address: string,
    rpc: string,
    private addresses: Record<string, string>,
  ) {
    this.provider = blockchainProvider(rpc, chainId);
  }
  private async contract(name: string) {
    let contract = this.contracts.get(name);
    if (!contract) {
      const artifact = JSON.parse(
        readFileSync(
          new URL(
            `../../../../../packages/contracts/artifacts/contracts/${artifactNames[name]}.sol/${artifactNames[name].split('/').at(-1)}.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
      if (name === 'delivery' && !this.addresses.delivery)
        this.addresses.delivery = String(
          await (await this.contract('orders')).getFunction('ingredientDelivery')(),
        );
      if (name === 'productDelivery' && !this.addresses.productDelivery)
        this.addresses.productDelivery = String(
          await (await this.contract('custody')).getFunction('productDelivery')(),
        );
      contract = new Contract(
        name === 'orders' ? this.address : this.addresses[name],
        new Interface(artifact.abi),
        this.provider,
      );
      this.contracts.set(name, contract);
      if (name === 'delivery' || name === 'productDelivery')
        registerRpcMulticallTarget(this.provider, String(contract.target));
    }
    return contract;
  }
  async read(name: string, method: string, args: unknown[] = []) {
    const contract = await this.contract(name);
    const fn = contract.getFunction(method);
    const result = await fn(...args);
    const outputs = fn.fragment.outputs;
    if (outputs.length === 1 && outputs[0].baseType === 'tuple')
      return plain(result, outputs[0].components ?? undefined);
    if (outputs.length === 1 && outputs[0].baseType === 'array')
      return Array.from(result, (entry) =>
        plain(entry, outputs[0].arrayChildren?.components ?? undefined),
      );
    if (outputs.length === 1) return plain(result);
    return plain(result, outputs);
  }
  async events(name: string, event: string) {
    const contract = await this.contract(name);
    const logs = await queryContractEvents(contract, contract.getEvent(event)());
    return logs
      .filter((log) => 'args' in log)
      .map((log) => {
        const entry = log as any;
        return {
          ...plain(entry.args, entry.fragment.inputs),
          transactionHash: entry.transactionHash,
          blockNumber: entry.blockNumber,
          blockHash: entry.blockHash,
        };
      });
  }
  /** Scans every contract this gateway has read so far up to the confirmed head. */
  async syncEvents() {
    await Promise.all([...this.contracts.values()].map((contract) => syncContractEvents(contract)));
  }
  async prepare(
    actor: string,
    name: string,
    method: string,
    args: unknown[],
    signal?: AbortSignal,
  ) {
    if (Number(BigInt(await this.provider.send('eth_chainId', []))) !== this.chainId)
      throw new Error('The configured RPC chain does not match CHAIN_ID.');
    const contract = await this.contract(name);
    const roadHandoff = name === 'custody' && method === 'createRoadTransfer';
    const occurredAt = roadHandoff ? Number(args[9]) : undefined;
    const block = roadHandoff
      ? await waitForMinedBlockTime(
          async () => {
            const header = await this.provider.send('eth_getBlockByNumber', ['latest', false]);
            return {
              number: Number(BigInt(header.number)),
              timestamp: Number(BigInt(header.timestamp)),
            };
          },
          occurredAt!,
          { signal },
        )
      : undefined;
    signal?.throwIfAborted();
    // Road handoffs must pass mined-state simulation; retain existing pending semantics elsewhere.
    await contract
      .getFunction(method)
      .staticCall(...args, { from: actor, blockTag: block?.number ?? 'pending' });
    signal?.throwIfAborted();
    return {
      ...(roadHandoff
        ? {
            notBeforeTimestamp: occurredAt,
            simulationErrors: contract.interface.fragments
              .filter((f) => f.type === 'error')
              .map((f) => f.format('full')),
          }
        : {}),
      chainId: this.chainId,
      to: String(contract.target),
      data: contract.interface.encodeFunctionData(method, args),
      value: '0x0' as const,
    };
  }
}
