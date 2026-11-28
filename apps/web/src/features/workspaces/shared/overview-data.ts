import { useCallback, useEffect, useState } from 'react';
import { requestStatus } from '@tracechain/shared';

import {
  getCustodyOffers,
  getInformationRequests,
  getOrders,
  type CompanyProofRequestRow,
  type CustodyOffer,
  type OrderRecord,
} from '../../orders/orders.api';
import { proofStatusLabel, proofStatusVariant } from '../../orders/DeliveryIdentityPanel';
import type { OperationalEvidenceRequest } from '../../blockchain/blockchain.api';
import { formatOperationalQuantity } from './operational-format';
import type { OverviewTask } from './StakeholderOverviewLayout';

/** Loads one overview source; a failure only affects its own section. */
export function useOverviewSource<T>(load: () => Promise<T>, fallback: string) {
  const [state, setState] = useState<{
    data?: T;
    error: string;
    loading: boolean;
    refreshing: boolean;
  }>({
    error: '',
    loading: true,
    refreshing: false,
  });
  const run = useCallback(() => {
    let active = true;
    setState((current) => ({
      ...current,
      loading: current.data === undefined,
      refreshing: current.data !== undefined,
      error: '',
    }));
    load()
      .then((data) => active && setState({ data, error: '', loading: false, refreshing: false }))
      .catch(
        (cause: unknown) =>
          active &&
          setState((current) => ({
            ...current,
            error: cause instanceof Error ? cause.message : fallback,
            loading: false,
            refreshing: false,
          })),
      );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaders are module functions
  }, []);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

/** Orders other companies placed with you that still need your approval. */
export const loadOrdersToApprove = () =>
  getOrders('order-list', { direction: 'received', status: 'attention', pageSize: 50 }).then(
    (result) => result.orders,
  );

/** Your own orders, newest first, for buyer snapshots. */
export const loadMyOrders = () =>
  getOrders('order-list', { direction: 'sent', pageSize: 10 }).then((result) => result.orders);

/** Product and ingredient names for batch IDs (display only). */
export const loadCatalogue = () => getOrders('catalogue').then((result) => result.catalogue);

export function catalogueItem(catalogue: OrderRecord[] | undefined, batchId: string) {
  return catalogue?.find((entry) =>
    entry.batches?.some((batch: string) => batch.toLowerCase() === batchId.toLowerCase()),
  );
}

export const loadCustodyOffers = () => getCustodyOffers().then((result) => result.offers);

export const loadIdentityRequests = () =>
  getInformationRequests().then((result) => result.requests);

export function orderTasks(orders: OrderRecord[], onOpen: () => void): OverviewTask[] {
  return orders.map((order) => {
    const status = requestStatus(order);
    return {
      key: `order:${order.orderId}`,
      task: 'Approve or reject order',
      item: order.item?.name ?? 'Order',
      detail: [
        order.requested && formatOperationalQuantity(order.requested, order.item?.unit),
        order.item?.batchReference,
      ]
        .filter(Boolean)
        .join(' · '),
      counterparty: order.buyerName,
      due: Number(order.expiresAt) || undefined,
      badge: { label: status.label, variant: status.variant },
      actionLabel: 'Review order',
      onAction: onOpen,
    };
  });
}

export const OFFER_STATUS: Record<
  CustodyOffer['status'],
  { label: string; variant: OverviewTask['badge']['variant'] }
> = {
  REQUESTED: { label: 'Awaiting acceptance', variant: 'pending' },
  ACCEPTED: { label: 'Accepted', variant: 'accepted' },
  SCHEDULED: { label: 'Pickup arranged', variant: 'accepted' },
  DISPATCHED: { label: 'In transit', variant: 'shared' },
  RECEIVED: { label: 'Received', variant: 'verified' },
  REJECTED: { label: 'Rejected', variant: 'rejected' },
  EXPIRED: { label: 'Expired', variant: 'rejected' },
};

/** Custody offers waiting on this company: the Distributor accepts, schedules and receives; the sender hands over. */
export function offerTasks(
  offers: CustodyOffer[],
  distributor: boolean,
  onOpen: () => void,
): OverviewTask[] {
  const turn: Record<string, { task: string; action: string } | undefined> = distributor
    ? {
        REQUESTED: { task: 'Accept or reject custody offer', action: 'Review offer' },
        ACCEPTED: { task: 'Arrange pickup time', action: 'Arrange pickup' },
        DISPATCHED: { task: 'Confirm warehouse receipt', action: 'Confirm receipt' },
      }
    : { SCHEDULED: { task: 'Hand over stock at pickup', action: 'Confirm handoff' } };
  return offers.flatMap((offer) => {
    const step = turn[offer.status];
    if (!step || offer.expiresAt * 1000 <= Date.now()) return [];
    return [
      {
        key: `offer:${offer.offerId}`,
        task: step.task,
        item: offer.itemName ?? 'Custody offer',
        detail: `${offer.quantity} ${offer.unit}`,
        counterparty: distributor ? offer.senderName : offer.distributorName,
        due: offer.status === 'SCHEDULED' ? (offer.pickupAt ?? offer.expiresAt) : offer.expiresAt,
        badge: { label: 'Your turn', variant: 'pending' as const },
        actionLabel: step.action,
        onAction: onOpen,
      },
    ];
  });
}

/** Company identity requests: respond when asked, verify when evidence was shared with you. */
export function identityTasks(rows: CompanyProofRequestRow[], onOpen: () => void): OverviewTask[] {
  return rows.flatMap((row) => {
    if (row.expiresAt * 1000 <= Date.now()) return [];
    const respond = row.direction === 'received' && ['REQUESTED', 'PENDING'].includes(row.status);
    const verify = row.direction === 'sent' && ['PRESENTED', 'SHARED'].includes(row.status);
    if (!respond && !verify) return [];
    return [
      {
        key: `identity:${row.requestId}`,
        task: respond ? 'Share company identity' : 'Verify company identity',
        item: row.subject ?? 'Company identity',
        detail: row.purpose,
        counterparty: row.company,
        due: row.expiresAt,
        badge: { label: proofStatusLabel(row.status), variant: proofStatusVariant(row.status) },
        actionLabel: respond ? 'Respond' : 'Verify',
        onAction: onOpen,
      },
    ];
  });
}

/** Ingredient evidence: Suppliers answer requests (status 1); requesters review shared evidence (status 2). */
export function ingredientEvidenceTasks(
  requests: OperationalEvidenceRequest[],
  side: 'supplier' | 'requester',
  itemName: (batchId: string) => string | undefined,
  onOpen: () => void,
): OverviewTask[] {
  const wanted = side === 'supplier' ? 1 : 2;
  return requests
    .filter((request) => request.status === wanted)
    .map((request) => ({
      key: `evidence:${request.requestId}`,
      task:
        side === 'supplier' ? 'Answer ingredient evidence request' : 'Review ingredient evidence',
      item: itemName(request.ingredientBatchId) ?? 'Ingredient batch',
      counterparty: side === 'supplier' ? request.manufacturerName : request.supplierName,
      due: side === 'supplier' ? request.dueAt : request.presentationExpiresAt || undefined,
      badge:
        side === 'supplier'
          ? { label: 'Awaiting response', variant: 'pending' as const }
          : { label: 'Evidence shared', variant: 'shared' as const },
      actionLabel: side === 'supplier' ? 'Respond' : 'Review',
      onAction: onOpen,
    }));
}
