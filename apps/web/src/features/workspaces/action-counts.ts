import { useSyncExternalStore } from 'react';
import { authRequestScope } from '../auth/auth-request-scope';
import { requestDisplayStatus, sameWallet, shipmentNeedsAction } from '../orders/delivery-state';
import type { OrderRecord } from '../orders/orders.api';

type Pages = Record<string, string[] | null>;
type Source = { pages: Pages; failed?: boolean };
type Entry = { wallet: string; role: string; sources: Map<string, Source>; snapshot: Pages };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const empty: Pages = Object.freeze({});

function publish(entry: Entry) {
  const pages: Pages = {};
  for (const source of entry.sources.values())
    for (const [page, ids] of Object.entries(source.pages)) {
      if (pages[page] === null || source.failed || ids === null) pages[page] = null;
      else pages[page] = [...new Set([...(pages[page] ?? []), ...ids])];
    }
  // A company-only count is not the complete Evidence Exchange count.
  if (!entry.sources.has('company') || !entry.sources.has('ingredients')) {
    if ('requests' in pages) pages.requests = null;
    if ('sent-requests' in pages) pages['sent-requests'] = null;
  }
  entry.snapshot = pages;
  for (const listener of listeners) listener();
}

export function registerActionCountScope(wallet: string, role: string, scope = authRequestScope()) {
  const existing = entries.get(scope);
  if (existing && sameWallet(existing.wallet, wallet) && existing.role === role) return existing;
  const entry: Entry = { wallet, role, sources: new Map(), snapshot: empty };
  entries.set(scope, entry);
  // Auth epochs isolate wallets and networks. Retain only a bounded number of prior epochs.
  if (entries.size > 8) entries.delete(entries.keys().next().value!);
  return entry;
}

export function useNavigationActions(wallet?: string, role = '') {
  const scope = authRequestScope();
  const entry = wallet ? registerActionCountScope(wallet, role, scope) : undefined;
  return useSyncExternalStore(
    subscribe,
    () => entry?.snapshot ?? empty,
    () => empty,
  );
}

export function navigationActionCount(pages: Pages, destinations: string[]) {
  const values = destinations.map((id) => pages[id]);
  if (values.some((value) => value === null)) return null;
  if (values.every((value) => value === undefined)) return undefined;
  return new Set(values.flatMap((value) => value ?? [])).size;
}

export function ingredientEvidenceActionGroup(
  row: { status: number; dueAt: number },
  side: 'received' | 'sent',
) {
  if (Number(row.status) === 1 && Number(row.dueAt) * 1000 > Date.now())
    return side === 'received' ? ('action' as const) : ('open' as const);
  if (Number(row.status) === 2) return side === 'sent' ? ('action' as const) : ('open' as const);
  return 'closed' as const;
}

export function companyEvidenceNeedsAction(row: OrderRecord) {
  return (
    Number(row.expiresAt) * 1000 > Date.now() &&
    (row.direction === 'received'
      ? ['REQUESTED', 'PENDING'].includes(row.status)
      : ['PRESENTED', 'SHARED'].includes(row.status))
  );
}

export function invalidateNavigationActions(scope = authRequestScope()) {
  const entry = entries.get(scope);
  if (!entry) return;
  for (const source of entry.sources.values()) source.failed = true;
  publish(entry);
}

/** Observe existing authorized queries only. This module never fetches or polls. */
function collectNavigationData(
  path: string,
  data: OrderRecord | undefined,
  scope: string,
  failed = false,
) {
  if (scope !== authRequestScope()) return;
  const entry = entries.get(scope);
  if (!entry) return;
  const actor = data?.actor ?? data?.actorWallet;
  if (actor && !sameWallet(actor, entry.wallet)) {
    invalidateNavigationActions(scope);
    return;
  }
  let source: string;
  let pages: Pages;
  const wallet = entry.wallet;
  const add = (page: string, key: string) => {
    (pages[page] ??= [])!.push(key);
  };
  if (path === '/information-requests') {
    source = 'company';
    pages = { requests: [], 'sent-requests': [] };
    for (const row of data?.requests ?? [])
      if (companyEvidenceNeedsAction(row))
        add(
          row.direction === 'received' ? 'requests' : 'sent-requests',
          `company:${row.requestId.toLowerCase()}`,
        );
  } else if (path === '/custody-offers') {
    source = 'offers';
    pages = entry.role === 'distributor' ? { intake: [] } : { transfers: [] };
    for (const offer of data?.offers ?? []) {
      if (Number(offer.expiresAt) * 1000 <= Date.now()) continue;
      if (
        entry.role === 'distributor' &&
        sameWallet(offer.distributor, wallet) &&
        ['REQUESTED', 'ACCEPTED'].includes(offer.status)
      )
        add('intake', `offer:${offer.offerId.toLowerCase()}`);
      if (sameWallet(offer.sender, wallet) && offer.status === 'SCHEDULED')
        add('transfers', `offer:${offer.offerId.toLowerCase()}`);
    }
  } else if (path === '/operations' || path === '/evidence-requests') {
    source = 'ingredients';
    pages = { requests: [], 'sent-requests': [] };
    for (const row of data?.evidenceRequests ?? data?.requests ?? []) {
      if (
        sameWallet(row.supplier, wallet) &&
        ingredientEvidenceActionGroup(row, 'received') === 'action'
      )
        add('requests', `ingredient:${row.requestId.toLowerCase()}`);
      if (
        sameWallet(row.requester, wallet) &&
        ingredientEvidenceActionGroup(row, 'sent') === 'action'
      )
        add('sent-requests', `ingredient:${row.requestId.toLowerCase()}`);
    }
  } else if (path === '/applications' && entry.role === 'admin') {
    source = 'applications';
    pages = { applications: [] };
    for (const row of data?.applications ?? [])
      if (row.status === 'pending' || row.status === 0)
        add('applications', `application:${String(row.applicationId ?? row.id).toLowerCase()}`);
  } else if (!path || path.startsWith('?')) {
    const query = new URLSearchParams(path.replace(/^\?/, ''));
    const kind = query.get('scope');
    if (kind === 'order-list' && query.get('direction') === 'sent') return;
    if (!kind) observeNavigationData('?scope=shipment-workspace', data, scope, failed);
    if (kind && !['shipment-workspace', 'order-list', 'order-detail'].includes(kind)) return;
    source = kind === 'shipment-workspace' ? 'shipments' : 'orders';
    pages =
      source === 'shipments'
        ? { arrivals: [], shipments: [], 'product-shipments': [] }
        : { orders: [], 'product-orders': [] };
    if (source === 'orders') {
      // Detail reads update known records without dropping the rest of an already loaded list.
      if (kind === 'order-detail')
        pages = structuredClone(entry.sources.get(source)?.pages ?? pages);
      for (const row of data?.orders ?? []) {
        const page = entry.role === 'manufacturer' ? 'product-orders' : 'orders';
        const key = `order:${row.orderId.toLowerCase()}`;
        pages[page] = (pages[page] ?? []).filter((id) => id !== key);
        if (requestDisplayStatus(row, wallet).needsAction) add(page, key);
      }
      const attention = data?.pagination?.counts?.attention;
      if (typeof attention === 'number' && query.get('direction') === 'received') {
        const page = entry.role === 'manufacturer' ? 'product-orders' : 'orders';
        // The server's all-results aggregate prevents a paginated list undercount.
        if (attention > (pages[page]?.length ?? 0)) {
          const ids = pages[page] ?? [];
          while (ids.length < Math.min(attention, 100)) ids.push(`aggregate:${page}:${ids.length}`);
          pages[page] = ids;
        }
      }
    }
    if (source === 'shipments') {
      pages.arrivals ??= [];
      pages.shipments ??= [];
      pages['product-shipments'] ??= [];
      for (const row of data?.logistics?.shipments ?? [])
        if (shipmentNeedsAction(row, wallet)) {
          const page =
            entry.role === 'distributor' && sameWallet(row.recipient, wallet)
              ? 'arrivals'
              : row.kind === 'product' && entry.role !== 'retailer'
                ? 'product-shipments'
                : 'shipments';
          add(page, `shipment:${row.shipmentId.toLowerCase()}`);
        }
      for (const row of data?.orders ?? []) {
        const delivery = row.productDelivery ?? row.delivery;
        if (sameWallet(delivery?.distributor, wallet) && [2, 3].includes(Number(delivery?.stage)))
          add(
            row.productDelivery ? 'product-shipments' : 'shipments',
            `order:${row.orderId.toLowerCase()}`,
          );
        if (
          row.custodyOrder?.arranged &&
          sameWallet(row.custodyOrder.distributor, wallet) &&
          Number(row.decision?.status) === 1 &&
          Number(row.status) === 1 &&
          Number(row.expiresAt) * 1000 > Date.now() &&
          BigInt(row.requested ?? '0') > BigInt(row.custodyOrder.dispatched ?? '0')
        )
          add('shipments', `order:${row.orderId.toLowerCase()}`);
      }
    }
  } else return;
  entry.sources.set(source, {
    pages,
    failed: failed || !!data?.readModel?.stale || !!data?.readModel?.refreshFailed,
  });
  publish(entry);
}

export function observeNavigationData(
  path: string,
  data: OrderRecord | undefined,
  scope: string,
  failed = false,
) {
  try {
    collectNavigationData(path, data, scope, failed);
  } catch {
    invalidateNavigationActions(scope);
  }
}
