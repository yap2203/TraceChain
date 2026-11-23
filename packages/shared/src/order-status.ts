export function requestStatus(order: Record<string, any>) {
  if (Number(order.productDelivery?.stage) === 5)
    return {
      key: 'completed',
      group: 'closed' as const,
      label: 'Received by Retailer',
      variant: 'verified' as const,
    };
  if (Number(order.productDelivery?.stage) === 6)
    return {
      key: 'cancelled',
      group: 'closed' as const,
      label: 'Product delivery cancelled / expired',
      variant: 'rejected' as const,
    };
  if (Number(order.productDelivery?.stage) === 4)
    return {
      key: 'in-transit',
      group: 'approved' as const,
      label: 'In transit to Retailer',
      variant: 'accepted' as const,
    };
  if (
    order.custodyOrder &&
    BigInt(order.custodyOrder.dispatched) < BigInt(order.requested) &&
    Number(order.expiresAt) <= Date.now() / 1000
  )
    return {
      key: 'expired',
      group: 'closed' as const,
      label:
        BigInt(order.custodyOrder.dispatched) > BigInt(order.custodyOrder.received)
          ? 'Remainder expired; shipment in transit'
          : 'Expired',
      variant: 'expired' as const,
    };
  if (Number(order.delivery?.stage) === 6)
    return {
      key: 'completed',
      group: 'closed' as const,
      label: 'Delivery cancelled',
      variant: 'rejected' as const,
    };
  if (
    /^\d+$/.test(String(order.approvedReceivedQuantity)) &&
    BigInt(order.approvedReceivedQuantity) > 0n
  ) {
    return BigInt(order.approvedReceivedQuantity) >= BigInt(order.requested)
      ? {
          key: 'completed',
          group: 'closed' as const,
          label: 'Received',
          variant: 'verified' as const,
        }
      : {
          key: 'approved',
          group: 'approved' as const,
          label: 'Partially received',
          variant: 'accepted' as const,
        };
  }
  if (Number(order.decision?.status) === 1)
    return {
      key: 'approved',
      group: 'approved' as const,
      label: Number(order.delivery?.stage) === 4 ? 'In transit' : 'Approved',
      variant: 'accepted' as const,
    };
  if (Number(order.decision?.status) === 2)
    return {
      key: 'rejected',
      group: 'closed' as const,
      label: 'Rejected',
      variant: 'rejected' as const,
    };
  if (Number(order.expiresAt) <= Date.now() / 1000)
    return {
      key: 'expired',
      group: 'closed' as const,
      label: 'Expired',
      variant: 'expired' as const,
    };
  if (Number(order.status) >= 3)
    return {
      key: 'completed',
      group: 'closed' as const,
      label: 'Closed',
      variant: 'default' as const,
    };
  if (hasValue(order.identityChallenge) && !hasValue(order.identityCredentialHash))
    return {
      key: 'evidence',
      group: 'evidence' as const,
      label: 'Waiting for Manufacturer proof',
      variant: 'requested' as const,
    };
  return {
    key: 'submitted',
    group: 'attention' as const,
    label: 'Needs your review',
    variant: 'pending' as const,
  };
}

function hasValue(value: unknown) {
  return typeof value === 'string' && !!value && !/^0x0+$/.test(value);
}
