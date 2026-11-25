import { LoadingIndicator } from '../../../components/ui/LoadingIndicator';
import { CheckCircle, ClipboardList, Package, Store } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { getOrders, type OrdersState } from '../../orders/orders.api';
import { formatOperationalQuantity } from '../shared/operational-format';
import {
  StakeholderOverviewLayout,
  type OverviewRecord,
} from '../shared/StakeholderOverviewLayout';

export function RetailerOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error, loading } = useOperationalData();
  const [orders, setOrders] = useState<OrdersState>();
  useEffect(() => {
    void getOrders('catalogue')
      .then(setOrders)
      .catch(() => undefined);
  }, []);
  if (loading) return <LoadingIndicator page label="Loading Retailer overview" />;

  const incoming = data.transfers.filter(
    (transfer) => transfer.direction === 'incoming' && transfer.status === 1,
  );
  const stock = data.transfers
    .filter(
      (transfer, index, all) =>
        all.findIndex((candidate) => candidate.productBatchId === transfer.productBatchId) ===
        index,
    )
    .reduce((sum, transfer) => sum + BigInt(transfer.inventory.available), 0n);
  const record = (transfer: (typeof data.transfers)[number], received = false): OverviewRecord => {
    const item = orders?.catalogue.find((entry) =>
      entry.batches?.some(
        (batch: string) => batch.toLowerCase() === transfer.productBatchId.toLowerCase(),
      ),
    );
    return {
      name: item?.name ?? 'Incoming product',
      reference: item?.batchReference ?? 'Registered product batch',
      imagePath: item?.imagePath,
      itemCategory: item?.category,
      companyName: transfer.senderName ?? transfer.distributorName ?? 'Sending Distributor',
      description: `${formatOperationalQuantity(transfer.quantity, item?.unit)}; ${received ? 'receipt recorded' : `expected ${new Date(transfer.expectedAt * 1_000).toLocaleString()}`}.`,
      badge: received
        ? { label: 'Received', variant: 'verified' }
        : { label: 'Awaiting receipt', variant: 'pending' },
      actionLabel: received ? 'View traceability' : 'Review shipment',
      onAction: () => onNav(received ? 'history' : 'shipments'),
      technical: [
        { label: 'Transfer ID', value: transfer.transferId },
        { label: 'Product batch ID', value: transfer.productBatchId },
      ],
    };
  };

  return (
    <>
      <StakeholderOverviewLayout
        errors={[error]}
        title="Retailer overview"
        description="Review incoming products, confirmed receipts and product traceability."
        metrics={[
          { label: 'Incoming shipments', value: incoming.length, icon: <Package size={21} /> },
          { label: 'Products in stock', value: stock.toString(), icon: <Store size={21} /> },
          {
            label: 'Evidence requests',
            value: data.evidenceRequests.length,
            icon: <ClipboardList size={21} />,
          },
          {
            label: 'Received transfers',
            value: data.transfers.filter((item) => item.status === 2).length,
            icon: <CheckCircle size={21} />,
          },
        ]}
        attention={incoming.map((transfer) => record(transfer))}
        recent={data.transfers
          .filter((transfer) => transfer.status === 2)
          .slice(0, 5)
          .map((transfer) => record(transfer, true))}
        emptyAttention="No incoming products need receipt"
        emptyRecent="No received products recorded"
      />
    </>
  );
}
