import type { NetworkHooks } from 'hardhat/types/hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Transaction } from 'ethers';

// Keep the Ignition graph/journal unchanged: delegated accounts may only have
// one in-flight transaction. Return each hash immediately so Ignition records it.
export default async (): Promise<Partial<NetworkHooks>> => {
  const queues = new WeakMap<object, Promise<unknown>>();
  const lastHashes = new WeakMap<object, string>();
  return {
    async onRequest(context, connection, request, next) {
      if (connection.networkName !== 'sepolia' || !['eth_sendTransaction', 'eth_sendRawTransaction'].includes(request.method)) {
        return next(context, connection, request);
      }
      const previous = queues.get(connection) ?? Promise.resolve();
      const operation = previous.catch(() => undefined).then(async () => {
        const params = request.params as unknown[];
        const sender = request.method === 'eth_sendRawTransaction'
          ? Transaction.from(params[0] as string).from
          : (params[0] as { from?: string })?.from;
        if (!sender) throw new Error('Sepolia transaction sender is missing.');
        const deadline = Date.now() + 300_000;
        const read = (method: string, params: unknown[]) => connection.provider.request({ method, params });
        while (true) {
          const hash = lastHashes.get(connection);
          const receipt = hash ? await read('eth_getTransactionReceipt', [hash]) : true;
          const latest = await read('eth_getTransactionCount', [sender, 'latest']);
          const pending = await read('eth_getTransactionCount', [sender, 'pending']);
          if (receipt && BigInt(latest) === BigInt(pending)) break;
          if (Date.now() >= deadline) {
            throw new Error('A Sepolia transaction is still pending. Wait for confirmation, then resume the same deployment without resetting its journal.');
          }
          await delay(2_000);
        }
        const response = await next(context, connection, request);
        if ('result' in response && typeof response.result === 'string') {
          lastHashes.set(connection, response.result);
        }
        return response;
      });
      queues.set(connection, operation);
      return operation;
    },
  };
};
