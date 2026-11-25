import { LoadingIndicator } from '../../../components/ui/LoadingIndicator';
import { ArrowUpRight, CheckCircle, Layers, PackageCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { getOrders, type OrdersState } from '../../orders/orders.api';
import { formatOperationalQuantity } from '../shared/operational-format';
import {
  StakeholderOverviewLayout,
  type OverviewRecord,
} from '../shared/StakeholderOverviewLayout';

export function DistributorOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error, loading } = useOperationalData();
  const [orders, setOrders] = useState<OrdersState>();
  useEffect(() => {
    void getOrders('catalogue')
      .then(setOrders)
      .catch(() => undefined);
  }, []);
  if (loading) return <LoadingIndicator page label="Loading Distributor overview" />;

  const incoming = data.transfers.filter(
    (transfer) => transfer.direction === 'incoming' && transfer.status === 1,
  );
  const inventory = data.transfers.filter(
    (transfer, index, all) =>
      all.findIndex((candidate) => candidate.productBatchId === transfer.productBatchId) ===
        index && BigInt(transfer.inventory.available) > 0n,
  );
  const attention: OverviewRecord[] = incoming.map((transfer) =>
    transferRecord(transfer, orders, () => onNav('arrivals'), 'Review arrival'),
  );
  const recent: OverviewRecord[] = data.transfers
    .slice()
    .sort((left, right) => right.dispatchedAt - left.dispatchedAt)
    .slice(0, 5)
    .map((transfer) =>
      transferRecord(transfer, orders, () => onNav('product-shipments'), 'View deliveries'),
    );

  return (
    <>
      <StakeholderOverviewLayout
        errors={[error]}
        title="Distributor overview"
        description="Monitor warehouse arrivals, custody inventory and outbound deliveries."
        metrics={[
          { label: 'Incoming shipments', value: incoming.length, icon: <PackageCheck size={21} /> },
          { label: 'Inventory batches', value: inventory.length, icon: <Layers size={21} /> },
          {
            label: 'Pending transfers',
            value: data.transfers.filter(
              (item) => item.direction === 'outgoing' && item.status === 1,
            ).length,
            icon: <ArrowUpRight size={21} />,
          },
          {
            label: 'Completed transfers',
            value: data.transfers.filter((item) => item.status === 2).length,
            icon: <CheckCircle size={21} />,
          },
        ]}
        attention={attention}
        recent={recent}
        emptyAttention="No warehouse arrivals need attention"
        emptyRecent="No custody transfers recorded"
      />
    </>
  );
}

function transferRecord(
  transfer: ReturnType<typeof useOperationalData>['data']['transfers'][number],
  orders: OrdersState | undefined,
  onAction: () => void,
  actionLabel: string,
): OverviewRecord {
  const item = orders?.catalogue.find((entry) =>
    entry.batches?.some(
      (batch: string) => batch.toLowerCase() === transfer.productBatchId.toLowerCase(),
    ),
  );
  return {
    name: item?.name ?? 'Custody shipment',
    reference: item?.batchReference ?? 'Registered product batch',
    imagePath: item?.imagePath,
    itemCategory: item?.category,
    companyName:
      transfer.direction === 'incoming'
        ? (transfer.senderName ?? transfer.manufacturerName)
        : (transfer.recipientName ?? transfer.retailerName),
    description: `${formatOperationalQuantity(transfer.quantity, item?.unit)}; expected ${new Date(transfer.expectedAt * 1_000).toLocaleString()}.`,
    badge: {
      label: transfer.status === 2 ? 'Received' : 'Awaiting receipt',
      variant: transfer.status === 2 ? 'verified' : 'pending',
    },
    actionLabel,
    onAction,
    technical: [
      { label: 'Transfer ID', value: transfer.transferId },
      { label: 'Product batch ID', value: transfer.productBatchId },
    ],
  };
}
