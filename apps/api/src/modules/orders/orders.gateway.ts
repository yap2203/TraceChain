import { readFileSync } from 'node:fs';
import { Contract, Interface, JsonRpcProvider } from 'ethers';
import type { PreparedTransaction } from '../blockchain/blockchain-gateway.service.js';

export type ChainRecord = Record<string, any>;
export interface OrdersGateway {
  assertDeployment?(): Promise<void>;
  chainId: number;
  address: string;
  read(contract: string, method: string, args?: unknown[]): Promise<any>;
  events(contract: string, event: string): Promise<ChainRecord[]>;
  prepare(
    actor: string,
    contract: string,
    method: string,
    args: unknown[],
  ): Promise<PreparedTransaction>;
}
const artifactNames: Record<string, string> = {
  orders: 'traceability/SupplyChainOrders',
  ingredients: 'traceability/IngredientRegistry',
  products: 'traceability/ProductRegistry',
  custody: 'traceability/CustodyTransfer',
  evidence: 'traceability/EvidenceRegistry',
  stakeholders: 'access/StakeholderRegistry',
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
  async assertDeployment() {
    if (Number(BigInt(await this.provider.send('eth_chainId', []))) !== this.chainId)
      throw new Error('Wrong RPC chain.');
    if ((await this.provider.getCode(this.address)) === '0x')
      throw new Error('Order registry is not deployed.');
    for (const name of ['stakeholders', 'ingredients', 'products', 'evidence', 'custody']) {
      if (
        String(await this.read('orders', name)).toLowerCase() !==
        this.addresses[name]?.toLowerCase()
      )
        throw new Error('Order registry deployment references do not match.');
    }
    for (const name of ['ingredients', 'custody']) {
      if (
        String(await this.read(name, 'supplyOrders')).toLowerCase() !== this.address.toLowerCase()
      )
        throw new Error('Order ledger is not wired into inventory.');
    }
  }
  private contracts = new Map<string, Contract>();
  private provider: JsonRpcProvider;
  constructor(
    public chainId: number,
    public address: string,
    rpc: string,
    private addresses: Record<string, string>,
  ) {
    this.provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  }
  private contract(name: string) {
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
      contract = new Contract(
        name === 'orders' ? this.address : this.addresses[name],
        new Interface(artifact.abi),
        this.provider,
      );
      this.contracts.set(name, contract);
    }
    return contract;
  }
  async read(name: string, method: string, args: unknown[] = []) {
    const contract = this.contract(name);
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
    const contract = this.contract(name);
    const logs = await contract.queryFilter(contract.getEvent(event)());
    return logs
      .filter((log) => 'args' in log)
      .map((log) => {
        const entry = log as any;
        return {
          ...plain(entry.args, entry.fragment.inputs),
          transactionHash: entry.transactionHash,
          blockNumber: entry.blockNumber,
        };
      });
  }
  async prepare(actor: string, name: string, method: string, args: unknown[]) {
    if (Number(BigInt(await this.provider.send('eth_chainId', []))) !== this.chainId)
      throw new Error('The configured RPC chain does not match CHAIN_ID.');
    const contract = this.contract(name);
    await contract.getFunction(method).staticCall(...args, { from: actor });
    return {
      chainId: this.chainId,
      to: String(contract.target),
      data: contract.interface.encodeFunctionData(method, args),
      value: '0x0' as const,
    };
  }
}
