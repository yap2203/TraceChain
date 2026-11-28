import { AsyncLocalStorage } from 'node:async_hooks';

type Counts = {
  rpc: number;
  scans: number;
  ipfs: number;
  failovers: number;
  endpointLabels: Set<string>;
  confirmedBlock?: number;
  pinReads: boolean;
  durations: Record<'queue' | 'rpc' | 'scans' | 'ipfs', number>;
};
const context = new AsyncLocalStorage<Counts>();
export function recordReadDuration(kind: keyof Counts['durations'], milliseconds: number) {
  const counts = context.getStore();
  if (counts) counts.durations[kind] += Math.max(0, milliseconds);
}
export async function measureRead<T>(
  kind: 'scans' | 'ipfs',
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    recordReadDuration(kind, performance.now() - started);
  }
}
export function countRead(kind: 'rpc' | 'scans' | 'ipfs') {
  const counts = context.getStore();
  if (counts && typeof counts[kind] === 'number') (counts[kind] as number)++;
}
export function recordRpcEndpoint(label: string, failedOver = false) {
  const counts = context.getStore();
  if (!counts) return;
  counts.endpointLabels.add(label);
  if (failedOver) counts.failovers++;
}
/** True inside a timed page-load request, where reads share one block a few confirmations behind head. */
export function pinsConfirmedReads() {
  return context.getStore()?.pinReads === true;
}
export function currentConfirmedReadBlock() {
  return context.getStore()?.confirmedBlock;
}
export function setConfirmedReadBlock(block: number) {
  const counts = context.getStore();
  if (counts) counts.confirmedBlock = block;
}
// pinReads: only page loads use the confirmed snapshot; actions must check the newest state.
export async function timeOrderRead<T>(operation: () => Promise<T>, pinReads = true) {
  const counts: Counts = {
    rpc: 0,
    scans: 0,
    ipfs: 0,
    failovers: 0,
    endpointLabels: new Set(),
    pinReads,
    durations: { queue: 0, rpc: 0, scans: 0, ipfs: 0 },
  };
  const started = performance.now();
  const result = await context.run(counts, operation);
  return {
    result,
    header: `orders;dur=${(performance.now() - started).toFixed(1)}, rpc;desc="${counts.rpc} transports";dur=${counts.durations.rpc.toFixed(1)}, queue;dur=${counts.durations.queue.toFixed(1)}, scans;desc="${counts.scans} log pages";dur=${counts.durations.scans.toFixed(1)}, ipfs;desc="${counts.ipfs} downloads";dur=${counts.durations.ipfs.toFixed(1)}, failover;desc="${counts.failovers > 0 ? 'yes' : 'no'}", endpoints;desc="${[...counts.endpointLabels].join('+') || 'none'}"${counts.confirmedBlock === undefined ? '' : `, block;desc="${counts.confirmedBlock}"`}`,
  };
}
