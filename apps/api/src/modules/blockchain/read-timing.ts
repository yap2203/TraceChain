import { AsyncLocalStorage } from 'node:async_hooks';

type Counts = {
  rpc: number;
  scans: number;
  ipfs: number;
  failovers: number;
  endpointLabels: Set<string>;
  confirmedBlock?: number;
  pinReads: boolean;
};
const context = new AsyncLocalStorage<Counts>();
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
  };
  const started = performance.now();
  const result = await context.run(counts, operation);
  return {
    result,
    header: `orders;dur=${(performance.now() - started).toFixed(1)}, rpc;desc="${counts.rpc} transports", scans;desc="${counts.scans} log pages", ipfs;desc="${counts.ipfs} downloads", failover;desc="${counts.failovers > 0 ? 'yes' : 'no'}", endpoints;desc="${[...counts.endpointLabels].join('+') || 'none'}"${counts.confirmedBlock === undefined ? '' : `, block;desc="${counts.confirmedBlock}"`}`,
  };
}
