import { CheckCircle, FileSearch, Package, ShoppingCart } from 'lucide-react';
import { requestStatus } from '@tracechain/shared';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { Badge } from '../shared/ui';
import { formatOperationalQuantity } from '../shared/operational-format';
import { StakeholderOverviewLayout, type OverviewTask } from '../shared/StakeholderOverviewLayout';
import {
  catalogueItem,
  identityTasks,
  ingredientEvidenceTasks,
  loadCatalogue,
  loadIdentityRequests,
  loadMyOrders,
  useOverviewSource,
} from '../shared/overview-data';

export function RetailerOverview({ onNav }: { onNav: (tab: string) => void }) {
  const operational = useOperationalData();
  const myOrders = useOverviewSource(loadMyOrders, 'Your orders could not be loaded.');
  const identity = useOverviewSource(
    loadIdentityRequests,
    'Evidence requests could not be loaded.',
  );
  const catalogue = useOverviewSource(loadCatalogue, 'Product names could not be loaded.');

  const transfers = operational.data.transfers;
  const arriving = transfers.filter(
    (transfer) => transfer.direction === 'incoming' && transfer.status === 1,
  );
  const received = transfers.filter((transfer) => transfer.status === 2);
  const evidence = ingredientEvidenceTasks(
    operational.data.evidenceRequests,
    'requester',
    (batchId) => catalogueItem(catalogue.data, batchId)?.name,
    () => onNav('requests'),
  );
  const arrivalWork: OverviewTask[] = arriving.map((transfer) => {
    const item = catalogueItem(catalogue.data, transfer.productBatchId);
    return {
      key: `arrival:${transfer.transferId}`,
      task: 'Confirm product receipt',
      item: item?.name ?? 'Incoming product',
      detail: formatOperationalQuantity(transfer.quantity, item?.unit),
      counterparty: transfer.senderName ?? transfer.distributorName,
      due: transfer.expectedAt,
      badge: { label: 'Awaiting receipt', variant: 'pending' },
      actionLabel: 'Receive',
      onAction: () => onNav('shipments'),
    };
  });
  const openOrders = (myOrders.data ?? []).filter(
    (order) => requestStatus(order).group !== 'closed',
  );

  return (
    <StakeholderOverviewLayout
      refreshing={
        operational.refreshing || myOrders.refreshing || identity.refreshing || catalogue.refreshing
      }
      title="Retailer overview"
      description="Products arriving, your open orders and evidence shared with you."
      errors={[myOrders.error, identity.error, operational.error]}
      onRefresh={() => {
        myOrders.reload();
        identity.reload();
        void operational.reload();
      }}
      metrics={[
        {
          label: 'Products arriving',
          value: operational.loading ? '…' : arriving.length,
          icon: <Package size={21} />,
          onClick: () => onNav('shipments'),
        },
        {
          label: 'Open orders',
          value: myOrders.loading ? '…' : openOrders.length,
          icon: <ShoppingCart size={21} />,
          onClick: () => onNav('orders'),
        },
        {
          label: 'Evidence to review',
          value: operational.loading ? '…' : evidence.length,
          icon: <FileSearch size={21} />,
          onClick: () => onNav('requests'),
        },
        {
          label: 'Products received',
          value: operational.loading ? '…' : received.length,
          icon: <CheckCircle size={21} />,
          onClick: () => onNav('history'),
        },
      ]}
      tasks={[
        ...arrivalWork,
        ...evidence,
        ...identityTasks(identity.data ?? [], () => onNav('requests')),
      ]}
      tasksLoading={identity.loading || operational.loading}
      snapshot={{
        title: 'Your recent orders',
        columns: ['Product', 'Seller', 'Quantity', 'Deadline', 'Status'],
        rows: (myOrders.data ?? []).map((order) => {
          const status = requestStatus(order);
          return {
            key: order.orderId,
            cells: [
              <strong key="name">{order.item?.name ?? 'Product'}</strong>,
              order.sellerName ?? '—',
              order.requested ? formatOperationalQuantity(order.requested, order.item?.unit) : '—',
              new Date(Number(order.expiresAt) * 1000).toLocaleDateString(),
              <Badge key="status" label={status.label} variant={status.variant} />,
            ],
          };
        }),
        empty: myOrders.loading
          ? 'Loading your orders…'
          : 'No orders yet. Browse products to place your first order.',
        viewAllLabel: 'View all orders',
        onViewAll: () => onNav('orders'),
      }}
    />
  );
}
