import { Interface, id, keccak256, type JsonRpcPayload, type JsonRpcResult } from 'ethers';

// Official Sepolia deployment: https://github.com/mds1/multicall3/blob/main/deployments.json
export const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const MULTICALL_CODE_HASH =
  '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891';
export const multicallInterface = new Interface([
  'function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[] returnData)',
]);

// Audited explicit-argument TraceChain getters. Calls relying on msg.sender, simulations,
// state overrides, value transfers and unknown selectors never enter this path.
const selectors = new Set(
  [
    'administrator()',
    'applicationCount()',
    'getApplicationIds(uint256,uint256)',
    'getApplication(bytes32)',
    'getStakeholder(address)',
    'roleOf(address)',
    'hasPermission(address,bytes32)',
    'roleHasPermission(uint8,bytes32)',
    'credentialIdByHash(bytes32)',
    'effectiveStatus(bytes32)',
    'getCredential(bytes32)',
    'getBatch(bytes32)',
    'getProduct(bytes32)',
    'getIngredientLinks(bytes32)',
    'getRequest(bytes32)',
    'getItem(bytes32)',
    'getOrder(bytes32)',
    'getShipment(bytes32)',
    'getOrderEvidence(bytes32)',
    'getTransfer(bytes32)',
    'getInventory(bytes32,address)',
    'getReceivedStock(bytes32,address,bytes32)',
    'getListing(bytes32)',
    'getMedia(bytes32)',
    'getCompanyBranding(address)',
    'stakeholders()',
    'credentials()',
    'ingredients()',
    'products()',
    'custody()',
    'evidence()',
    'supplyOrders()',
    'approvedReceiptPolicy()',
    'ingredientDeliveryPolicy()',
    'productDeliveryPolicy()',
    'catalogueUnitPolicy()',
    'requestDecision(bytes32)',
    'requestOnly(bytes32)',
    'requestedBatch(bytes32)',
    'approvedReceivedQuantity(bytes32)',
    'productionRecordedAt(bytes32)',
    'productionLocation(bytes32)',
    'isUsable(bytes32)',
    'isTransferable(bytes32)',
    'get(bytes32)', 'getPosition(bytes32)', 'custodyOrders(bytes32)', 'warehouses(bytes32)',
    'deliveryArranged(bytes32)', 'custodyPolicy()', 'reviewPolicy()', 'fulfilmentPolicy()',
    'ingredientDelivery()', 'productDelivery()', 'locationOwner(bytes32)', 'locationStock(bytes32,bytes32)',
  ].map((signature) => id(signature).slice(0, 10)),
);

type Pending = {
  payload: JsonRpcPayload;
  resolve(value: JsonRpcResult): void;
  reject(error: unknown): void;
};

export class MulticallReads {
  private queue: Pending[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private verification?: Promise<boolean>;
  private nextId = 1_000_000_000;
  constructor(
    private targets: Set<string>,
    private send: (payload: JsonRpcPayload) => Promise<JsonRpcResult[]>,
    private recordBatch: (count: number) => void,
  ) {}

  registerTarget(address: string) { this.targets.add(address.toLowerCase()); }

  private eligible(payload: JsonRpcPayload) {
    const params = payload.params as unknown[];
    const tx = params?.[0] as Record<string, unknown> | undefined;
    return (
      payload.method === 'eth_call' &&
      params?.length === 2 &&
      params[1] === 'latest' &&
      !!tx &&
      Object.keys(tx).every((key) => key === 'to' || key === 'data') &&
      typeof tx.to === 'string' &&
      this.targets.has(tx.to.toLowerCase()) &&
      typeof tx.data === 'string' &&
      selectors.has(tx.data.slice(0, 10))
    );
  }

  async read(payload: JsonRpcPayload): Promise<JsonRpcResult> {
    if (!this.eligible(payload)) return this.single(payload);
    return new Promise((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 15);
    });
  }

  private async single(payload: JsonRpcPayload) {
    const result = (await this.send(payload)).find((value) => value.id === payload.id);
    if (!result) throw new Error('The RPC provider omitted a read response.');
    return result;
  }

  private async verified() {
    if (!this.verification) {
      const verification = this.single({
        jsonrpc: '2.0',
        id: this.nextId--,
        method: 'eth_getCode',
        params: [MULTICALL_ADDRESS, 'latest'],
      }).then((result) => {
        if (!('result' in result) || typeof result.result !== 'string')
          throw new Error('Multicall deployment could not be checked.');
        return keccak256(result.result) === MULTICALL_CODE_HASH;
      });
      this.verification = verification;
      void verification.catch(() => {
        if (this.verification === verification) this.verification = undefined;
      });
    }
    return this.verification;
  }

  private async flush() {
    const queue = this.queue.splice(0);
    // Bound aggregate execution and payload size. Each logical call retains its own result/error.
    for (let start = 0; start < queue.length; start += 32) {
      const group = queue.slice(start, start + 32);
      try {
        if (group.length === 1 || !(await this.verified())) {
          await Promise.all(
            group.map(async (entry) => {
              try {
                entry.resolve(await this.single(entry.payload));
              } catch (error) {
                entry.reject(error);
              }
            }),
          );
          continue;
        }
        const calls = group.map((entry) => {
          const [tx] = entry.payload.params as Array<{ to: string; data: string }>;
          return { target: tx.to, allowFailure: true, callData: tx.data };
        });
        const response = await this.single({
          jsonrpc: '2.0',
          id: this.nextId--,
          method: 'eth_call',
          params: [
            {
              to: MULTICALL_ADDRESS,
              data: multicallInterface.encodeFunctionData('aggregate3', [calls]),
            },
            'latest',
          ],
        });
        const raw = response as unknown as Record<string, unknown>;
        if ('error' in raw) {
          for (const entry of group)
            entry.resolve({ ...raw, id: entry.payload.id } as unknown as JsonRpcResult);
          continue;
        }
        const [results] = multicallInterface.decodeFunctionResult('aggregate3', response.result);
        if (results.length !== group.length)
          throw new Error('Multicall returned an incomplete read response.');
        this.recordBatch(group.length);
        group.forEach((entry, index) => {
          const result = results[index].success
            ? { jsonrpc: '2.0', id: entry.payload.id, result: results[index].returnData }
            : {
                jsonrpc: '2.0',
                id: entry.payload.id,
                error: { code: 3, message: 'execution reverted', data: results[index].returnData },
              };
          entry.resolve(result as unknown as JsonRpcResult);
        });
      } catch (error) {
        for (const entry of group) entry.reject(error);
      }
    }
  }
}
