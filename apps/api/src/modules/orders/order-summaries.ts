import { decodeBytes32String } from 'ethers';
import { DisplaySnapshots } from './display-snapshots.js';
import { CompanyRole, requestStatus } from '@tracechain/shared';
import type { OrdersGateway, ChainRecord } from './orders.gateway.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';

export interface OrderListQuery {
  page: number;
  pageSize: number;
  direction: 'all' | 'sent' | 'received';
  search: string;
  status: string;
  sort: 'newest' | 'oldest' | 'deadline' | 'updated';
  refresh?: boolean;
}
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Display-only snapshots. Never consulted by action preparation or authorization. */
export class OrderSummaryReader {
  private snapshots = new DisplaySnapshots<ChainRecord[]>();
  constructor(
    private gateway: OrdersGateway,
    private directory?: StakeholderDirectory,
    private describe?: (row: ChainRecord) => Promise<ChainRecord | undefined>,
  ) {}

  invalidate() {
    this.snapshots.invalidate();
  }
  private async optional(contract: string, method: string, args: unknown[] = []) {
    try {
      return await this.gateway.read(contract, method, args);
    } catch (cause) {
      const error = cause as { code?: string; data?: string; value?: string };
      if (
        (error.code === 'CALL_EXCEPTION' && error.data === '0x') ||
        (error.code === 'BAD_DATA' && error.value === '0x')
      )
        return undefined;
      throw cause;
    }
  }

  async list(actor: string, role: string, query: OrderListQuery) {
    // The reader belongs to exactly one gateway/deployment. Include role and wallet for privacy.
    const key = `${this.gateway.chainId}:${this.gateway.address.toLowerCase()}:${actor.toLowerCase()}:${role}`;
    const snapshot = await this.snapshots.get(key, () => this.read(actor, role), query.refresh);
    const rows = snapshot.value
      .filter((row) =>
        query.direction === 'sent'
          ? same(row.buyer, actor)
          : query.direction === 'received'
            ? same(row.seller, actor)
            : true,
      )
      .map((row) => {
        const delivery = row.delivery;
        if (
          delivery &&
          ((Number(delivery.stage) === 1 &&
            Number(delivery.assignmentDeadline) <= Date.now() / 1000) ||
            ([1, 2, 3].includes(Number(delivery.stage)) &&
              (Number(row.expiresAt) <= Date.now() / 1000 || Number(row.status) === 3)))
        )
          return { ...row, delivery: { ...delivery, stage: '6' } };
        return row;
      });
    const counts = { all: rows.length, attention: 0, evidence: 0, approved: 0, closed: 0 };
    for (const row of rows) counts[requestStatus(row).group]++;
    const search = query.search.trim().toLowerCase();
    // Name/reference searching must cover the complete authorized set, not just this page.
    // Resolve optional display metadata only when it is needed for a search.
    if (search && this.describe) {
      let cursor = 0;
      const labels = new Map<string, Promise<ChainRecord | undefined>>();
      await Promise.all(
        Array.from({ length: Math.min(4, rows.length) }, async () => {
          while (cursor < rows.length) {
            const row = rows[cursor++];
            let label = labels.get(row.itemId);
            if (!label) {
              label = this.describe!(row);
              labels.set(row.itemId, label);
            }
            const summary = await label;
            if (summary) row.item = { ...row.item, ...summary };
          }
        }),
      );
    }
    const filtered = rows
      .filter((row) => {
        const state = requestStatus(row);
        return (
          (query.status === 'all' || query.status === state.group || query.status === state.key) &&
          (!search ||
            [
              row.item.name,
              row.item.batchReference,
              row.buyerName,
              row.sellerName,
              row.orderId,
              row.requestedBatch,
            ].some((value) =>
              String(value ?? '')
                .toLowerCase()
                .includes(search),
            ))
        );
      })
      .sort((a, b) => {
        const time = (row: ChainRecord) =>
          Number(
            query.sort === 'deadline'
              ? row.expiresAt
              : query.sort === 'updated'
                ? row.updatedAt
                : row.requestedBlock,
          ) || 0;
        const difference =
          query.sort === 'oldest' || query.sort === 'deadline'
            ? time(a) - time(b)
            : time(b) - time(a);
        return difference || a.orderId.localeCompare(b.orderId);
      });
    const page = Math.min(query.page, Math.max(1, Math.ceil(filtered.length / query.pageSize)));
    const orders = filtered.slice((page - 1) * query.pageSize, page * query.pageSize);
    return {
      actor,
      role,
      chainId: this.gateway.chainId,
      ordersAddress: this.gateway.address,
      orders,
      catalogue: orders.map((row) => row.item),
      locations: [],
      shipments: [],
      pagination: { page, pageSize: query.pageSize, total: filtered.length, counts },
      readModel: snapshot.readModel,
    };
  }

  private async read(actor: string, role: string) {
    const admin = role === CompanyRole.SYSTEM_ADMIN;
    const [events, listed, approved, ingredient, product] = await Promise.all([
      this.gateway.events('orders', 'OrderRequested'),
      this.gateway.events('orders', 'ItemListed'),
      this.optional('orders', 'approvedReceiptPolicy'),
      this.optional('orders', 'ingredientDeliveryPolicy'),
      this.optional('custody', 'productDeliveryPolicy'),
    ]);
    const warehouse =
      Number(ingredient) === 1 &&
      Number(await this.gateway.read('delivery', 'custodyPolicy')) === 1;
    const items = new Map<string, Promise<ChainRecord>>();
    const batches = new Map<string, Set<string>>();
    for (const entry of listed)
      if (entry.itemId && entry.batchId) {
        const values = batches.get(entry.itemId) ?? new Set<string>();
        values.add(entry.batchId);
        batches.set(entry.itemId, values);
      }
    // Inspect public event participants before fetching records. Distributor membership needs delivery state.
    const candidates = events.filter(
      (e) =>
        admin ||
        role === CompanyRole.DISTRIBUTOR ||
        same(e.buyer, actor) ||
        same(e.seller, actor) ||
        (!e.buyer && !e.seller),
    );
    const unique = [...new Map(candidates.map((e) => [e.orderId, e])).values()];
    const rows: ChainRecord[] = [];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, unique.length) }, async () => {
        while (cursor < unique.length) {
          const event = unique[cursor++];
          const order = await this.gateway.read('orders', 'getOrder', [event.orderId]);
          const [decision, received, delivery, productDelivery, custody] = await Promise.all([
            this.optional('orders', 'requestDecision', [event.orderId]),
            Number(approved) === 1
              ? this.gateway.read('orders', 'approvedReceivedQuantity', [event.orderId])
              : undefined,
            Number(ingredient) === 1
              ? this.gateway.read('delivery', 'get', [event.orderId])
              : undefined,
            Number(product) === 1
              ? this.gateway.read('productDelivery', 'get', [event.orderId])
              : undefined,
            warehouse ? this.gateway.read('delivery', 'custodyOrders', [event.orderId]) : undefined,
          ]);
          if (
            !admin &&
            !same(order.buyer, actor) &&
            !same(order.seller, actor) &&
            !same(delivery?.distributor, actor) &&
            !same(productDelivery?.distributor, actor)
          )
            continue;
          let item = items.get(order.itemId);
          if (!item) {
            item = this.gateway.read('orders', 'getItem', [order.itemId]);
            items.set(order.itemId, item!);
          }
          const value = await item!;
          const knownBatches = [...(batches.get(order.itemId) ?? [])];
          const imageBatch =
            order.proposedBatch && !/^0x0+$/.test(order.proposedBatch)
              ? order.proposedBatch
              : knownBatches.length === 1
                ? knownBatches[0]
                : undefined;
          rows.push({
            // Explicit whitelist: never include details CID, decrypted notes, evidence or documents.
            orderId: event.orderId,
            orderReference: event.orderId,
            buyer: order.buyer,
            seller: order.seller,
            itemId: order.itemId,
            proposedBatch: order.proposedBatch,
            requested: order.requested,
            allocated: order.allocated,
            dispatched: order.dispatched,
            status: order.status,
            expiresAt: order.expiresAt,
            identityChallenge: order.identityChallenge,
            identityCredentialHash: order.identityCredentialHash,
            identityValidUntil: order.identityValidUntil,
            decision: decision
              ? { status: decision.status, recordedAt: decision.recordedAt }
              : undefined,
            approvedReceivedQuantity: received,
            requestedBlock: event.blockNumber,
            updatedAt: decision?.recordedAt,
            custodyOrder:
              custody?.positionId && !/^0x0+$/.test(String(custody.positionId))
                ? {
                    dispatched: custody.dispatched,
                    received: custody.received,
                  }
                : undefined,
            delivery:
              Number(delivery?.stage) > 0
                ? {
                    stage: delivery.stage,
                    distributor: delivery.distributor,
                    assignmentDeadline: delivery.assignmentDeadline,
                  }
                : undefined,
            productDelivery:
              Number(productDelivery?.mode) > 0
                ? {
                    mode: productDelivery.mode,
                    stage: productDelivery.stage,
                    distributor: productDelivery.distributor,
                  }
                : undefined,
            item: {
              itemId: order.itemId,
              name: value.name,
              kind: value.kind,
              unit: decodeBytes32String(value.unit),
              batches: imageBatch ? [imageBatch] : [],
              imagePath: imageBatch
                ? `/catalogue/${Number(value.kind) === 1 ? 'ingredients' : 'products'}/${imageBatch}/image`
                : undefined,
            },
          });
        }
      }),
    );
    const identities =
      (await this.directory?.resolveMany([...new Set(rows.flatMap((r) => [r.buyer, r.seller]))])) ??
      [];
    const name = (wallet: string) =>
      identities.find((i) => same(i.walletAddress, wallet))?.companyName;
    return rows.map((row) => ({
      ...row,
      buyerName: name(row.buyer),
      sellerName: name(row.seller),
    }));
  }
}
