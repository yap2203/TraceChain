import type { ChainRecord } from './orders.gateway.js';

const same = (a: string, b: string) => a?.toLowerCase() === b?.toLowerCase();
const positive = (value: bigint) => (value > 0n ? value : 0n);

/** Demand projection only. Request-only orders do not reserve or transfer on-chain stock. */
export function supplierStock(
  actor: string,
  catalogue: ChainRecord[],
  orders: ChainRecord[],
  now: number,
) {
  const batches = new Map<
    string,
    {
      batchId: string;
      unit: string;
      available: bigint;
      pending: bigint;
      approved: bigint;
      requestCount: number;
      complete: boolean;
    }
  >();
  const ownItems = catalogue.filter((item) => Number(item.kind) === 1 && same(item.seller, actor));
  for (const item of ownItems) {
    for (const batch of item.batchDetails ?? []) {
      batches.set(batch.batchId.toLowerCase(), {
        batchId: batch.batchId,
        unit: item.unit,
        available: BigInt(batch.supplierAvailable),
        pending: 0n,
        approved: 0n,
        requestCount: 0,
        complete: true,
      });
    }
  }
  for (const order of orders) {
    if (
      !same(order.seller, actor) ||
      !order.isRequestOnly ||
      Number(order.status) !== 1 ||
      Number(order.expiresAt) <= now ||
      Number(order.decision?.status) === 2
    )
      continue;
    const item = ownItems.find((entry) => same(entry.itemId, order.itemId));
    if (!item) continue;
    const bound =
      order.requestedBatch && !/^0x0{64}$/i.test(order.requestedBatch)
        ? order.requestedBatch
        : item.batches.length === 1
          ? item.batches[0]
          : undefined;
    const batch =
      bound && item.batches.some((id: string) => same(id, bound))
        ? batches.get(bound.toLowerCase())
        : undefined;
    if (!batch) {
      // Older multi-batch items have no trustworthy batch binding: do not guess.
      for (const id of item.batches) {
        const affected = batches.get(id.toLowerCase());
        if (affected) affected.complete = false;
      }
      continue;
    }
    const outstanding = positive(
      BigInt(order.requested) - BigInt(order.approvedReceivedQuantity ?? '0'),
    );
    if (!outstanding) continue;
    batch.requestCount++;
    if (![0, 1].includes(Number(order.decision?.status))) {
      batch.complete = false;
      continue;
    }
    if (Number(order.decision.status) === 1) batch.approved += outstanding;
    else batch.pending += outstanding;
  }
  return [...batches.values()].map((batch) => ({
    batchId: batch.batchId,
    unit: batch.unit,
    availableQuantity: batch.available.toString(),
    pendingQuantity: batch.pending.toString(),
    approvedQuantity: batch.approved.toString(),
    outstandingQuantity: (batch.pending + batch.approved).toString(),
    remainingAfterRequests: batch.complete
      ? positive(batch.available - batch.pending - batch.approved).toString()
      : null,
    shortfall: batch.complete
      ? positive(batch.pending + batch.approved - batch.available).toString()
      : null,
    requestCount: batch.requestCount,
  }));
}
