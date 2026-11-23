import { AsyncLocalStorage } from 'node:async_hooks';

type Counts = { rpc: number; scans: number; ipfs: number };
const context = new AsyncLocalStorage<Counts>();
export function countRead(kind: keyof Counts) {
  const counts = context.getStore();
  if (counts) counts[kind]++;
}
export async function timeOrderRead<T>(operation: () => Promise<T>) {
  const counts: Counts = { rpc: 0, scans: 0, ipfs: 0 };
  const started = performance.now();
  const result = await context.run(counts, operation);
  return {
    result,
    header: `orders;dur=${(performance.now() - started).toFixed(1)}, rpc;desc="${counts.rpc} transports", scans;desc="${counts.scans} log pages", ipfs;desc="${counts.ipfs} downloads"`,
  };
}
