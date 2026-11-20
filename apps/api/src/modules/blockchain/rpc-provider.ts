import { JsonRpcProvider, type JsonRpcPayload, type JsonRpcResult } from 'ethers';

const providers = new Map<string, JsonRpcProvider>();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const reads = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getCode',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_getBalance',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
]);

/** One transport per configured network, shared by all API contract gateways. */
export function blockchainProvider(url: string, chainId: number): JsonRpcProvider {
  const key = `${chainId}:${url}`;
  let provider = providers.get(key);
  if (!provider) {
    provider =
      chainId === 31337
        ? new JsonRpcProvider(url, chainId, { staticNetwork: true })
        : new ApiRpcProvider(url, chainId, { staticNetwork: true, batchMaxCount: 1 });
    providers.set(key, provider);
  }
  return provider;
}

export class ApiRpcProvider extends JsonRpcProvider {
  private admission = Promise.resolve();
  private nextRequestAt = 0;
  private readonly inFlight = new Map<string, Promise<Array<JsonRpcResult>>>();

  override async _send(
    payload: JsonRpcPayload | Array<JsonRpcPayload>,
  ): Promise<Array<JsonRpcResult>> {
    if (Array.isArray(payload)) {
      const results: JsonRpcResult[] = [];
      for (const entry of payload) results.push(...(await this._send(entry)));
      return results;
    }
    const read = reads.has(payload.method);
    const key = JSON.stringify([payload.method, payload.params]);
    const pending = read ? this.inFlight.get(key) : undefined;
    if (pending) return (await pending).map((result) => ({ ...result, id: payload.id }));
    const operation = this.perform(payload, read);
    if (read) this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      if (read && this.inFlight.get(key) === operation) this.inFlight.delete(key);
    }
  }

  private async admit(method: string) {
    const slot = this.admission.then(async () => {
      await wait(Math.max(0, this.nextRequestAt - Date.now()));
      this.nextRequestAt = Date.now() + (method === 'eth_getLogs' ? 650 : 200);
    });
    this.admission = slot.catch(() => undefined);
    await slot;
  }

  private async perform(payload: JsonRpcPayload, read: boolean): Promise<Array<JsonRpcResult>> {
    for (let attempt = 0; ; attempt++) {
      await this.admit(payload.method);
      try {
        const result = await super._send(payload);
        // Some providers return bare batch errors without JSON-RPC IDs.
        const rateLimited = result.some((entry) => isThrottled(entry));
        if (!read || !rateLimited || attempt >= 2) return result;
      } catch (error) {
        if (!read || !isThrottled(error) || attempt >= 2) throw error;
      }
      await wait(1_000 * 2 ** attempt);
    }
  }
}

function isThrottled(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const error = value as {
    code?: number;
    message?: string;
    error?: unknown;
    info?: { responseStatus?: string; error?: unknown };
  };
  return (
    error.code === 429 ||
    error.code === -32005 ||
    /too many requests|rate.?limit|\b429\b/i.test(error.message ?? '') ||
    /\b429\b/.test(error.info?.responseStatus ?? '') ||
    isThrottled(error.error) ||
    isThrottled(error.info?.error)
  );
}
