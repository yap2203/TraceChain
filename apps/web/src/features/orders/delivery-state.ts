import type { OrderRecord } from './orders.api';
import { requestStatus } from '@tracechain/shared';

export const sameWallet = (left?: string, right?: string) =>
  !!left && !!right && left.toLowerCase() === right.toLowerCase();

/** Presentation only; on-chain status and server pagination groups stay unchanged. */
export function requestDisplayStatus(order: OrderRecord, actor?: string) {
  const state = requestStatus(order);
  const needsAction = !!actor && sameWallet(order.seller, actor) && state.group === 'attention';
  if (actor && sameWallet(order.buyer, actor) && state.group === 'evidence')
    return { ...state, label: 'Company evidence requested', needsAction };
  if (actor && !sameWallet(order.seller, actor) && state.group === 'attention')
    return {
      ...state,
      label:
        Number(order.kind) === 2 || order.productDelivery
          ? 'Waiting for Manufacturer'
          : 'Waiting for Supplier',
      needsAction,
    };
  return { ...state, needsAction };
}

/** Resolve only records actually returned by the authorized shipment service. */
export function confirmedOrderShipment(order: OrderRecord | undefined, shipments: OrderRecord[]) {
  if (!order) return undefined;
  const transferId = order.productDelivery?.transferId ?? order.delivery?.transferId;
  const exact = shipments.find((shipment) => sameWallet(shipment.shipmentId, transferId));
  if (exact) return exact;
  return shipments
    .filter(
      (shipment) =>
        sameWallet(shipment.orderId, order.orderId) &&
        (!order.custodyOrder || Number(shipment.leg) !== 1),
    )
    .sort((left, right) => Number(right.dispatchedAt ?? 0) - Number(left.dispatchedAt ?? 0))[0];
}

export function shipmentNeedsAction(shipment: OrderRecord, actor?: string) {
  if (!actor) return false;
  if (shipment.workflowOrderId)
    return (
      sameWallet(shipment.productDelivery?.distributor, actor) &&
      [2, 3].includes(Number(shipment.productDelivery?.stage))
    );
  if (shipment.pickupOfferId) return sameWallet(shipment.sender, actor);
  if (sameWallet(shipment.recipient, actor))
    return shipment.kind === 'product'
      ? Number(shipment.status) === 1
      : [1, 2].includes(Number(shipment.status));
  return (
    shipment.kind === 'ingredient' &&
    Number(shipment.leg) === 1 &&
    Number(shipment.status) === 4 &&
    sameWallet(shipment.sender, actor)
  );
}

/** Uses the same viewer eligibility as shipment filters and navigation counts. */
export function shipmentNextAction(shipment: OrderRecord, actor: string) {
  if (shipmentNeedsAction(shipment, actor)) {
    if (shipment.workflowOrderId)
      return Number(shipment.productDelivery?.stage) === 2
        ? 'Review delivery request'
        : 'Record dispatch';
    if (shipment.pickupOfferId) return 'Confirm handoff';
    if (sameWallet(shipment.sender, actor) && Number(shipment.status) === 4)
      return 'Confirm returned goods';
    return 'Confirm receipt';
  }
  if (shipment.pickupOfferId)
    return `Waiting for ${shipment.senderName ?? 'sender'} to confirm handoff`;
  if (shipment.workflowOrderId) return 'Waiting for the assigned Distributor';
  if (shipmentNeedsAction(shipment, shipment.recipient))
    return `Waiting for ${shipment.recipientName ?? (shipment.kind === 'product' && shipment.orderId ? 'Retailer' : 'recipient')} to confirm receipt`;
  return 'No action required';
}
