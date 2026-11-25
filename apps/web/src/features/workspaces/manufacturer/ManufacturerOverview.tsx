import { LoadingIndicator } from '../../../components/ui/LoadingIndicator';
import { ArrowUpRight, CheckCircle, Package, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { getOrders, type OrdersState } from '../../orders/orders.api';
import { formatOperationalQuantity } from '../shared/operational-format';
import {
  StakeholderOverviewLayout,
  type OverviewRecord,
} from '../shared/StakeholderOverviewLayout';

export function ManufacturerOverview({ onNav }: { onNav: (tab: string) => void }) {
  const { data, error, loading } = useOperationalData();
  const [orders, setOrders] = useState<OrdersState>();
  useEffect(() => {
    void getOrders('catalogue')
      .then(setOrders)
      .catch(() => undefined);
  }, []);
  if (loading) return <LoadingIndicator page label="Loading Manufacturer overview" />;

  const pending = data.transfers.filter((transfer) => transfer.status === 1);
  const attention: OverviewRecord[] = pending.map((transfer) => {
    const item = catalogueItem(orders, transfer.productBatchId);
    return {
      name: item?.name ?? 'Product custody transfer',
      reference: item?.batchReference ?? 'Registered product batch',
      imagePath: item?.imagePath,
      itemCategory: item?.category,
      companyName: transfer.recipientName ?? transfer.distributorName ?? 'Receiving Distributor',
      description: `${formatOperationalQuantity(transfer.quantity, item?.unit)} awaiting receipt.`,
      badge: { label: 'Awaiting receipt', variant: 'pending' },
      actionLabel: 'Review shipment',
      onAction: () => onNav('product-shipments'),
      technical: [
        { label: 'Transfer ID', value: transfer.transferId },
        { label: 'Product batch ID', value: transfer.productBatchId },
      ],
    };
  });
  const recent: OverviewRecord[] = data.productBatches.slice(0, 5).map((product) => {
    const item = catalogueItem(orders, product.batchId);
    return {
      name: item?.name ?? 'Registered product batch',
      reference: item?.batchReference ?? 'Batch reference unavailable',
      imagePath: item?.imagePath,
      itemCategory: item?.category,
      companyName: product.manufacturerName,
      companyLogoPath: item?.sellerLogoPath,
      description: `${formatOperationalQuantity(product.totalQuantity, product.unit)}; ${product.ingredients.length} linked ingredient batches.`,
      badge: {
        label: product.status === 1 ? 'Active' : 'Unavailable',
        variant: product.status === 1 ? 'active' : 'pending',
      },
      actionLabel: 'View products',
      onAction: () => onNav('products'),
      technical: [{ label: 'Product batch ID', value: product.batchId }],
    };
  });

  return (
    <>
      <StakeholderOverviewLayout
        errors={[error]}
        title="Manufacturer overview"
        description="Review product production, accepted evidence and custody handoffs."
        metrics={[
          {
            label: 'Product batches',
            value: data.productBatches.length,
            icon: <Package size={21} />,
          },
          {
            label: 'Active products',
            value: data.productBatches.filter((item) => item.status === 1).length,
            icon: <TrendingUp size={21} />,
          },
          {
            label: 'Accepted evidence',
            value: data.evidenceRequests.filter((item) => item.status === 3).length,
            icon: <CheckCircle size={21} />,
          },
          { label: 'Pending transfers', value: pending.length, icon: <ArrowUpRight size={21} /> },
        ]}
        attention={attention}
        recent={recent}
        emptyAttention="No product transfers need attention"
        emptyRecent="No product batches recorded"
      />
    </>
  );
}

function catalogueItem(data: OrdersState | undefined, batchId: string) {
  return data?.catalogue.find((entry) =>
    entry.batches?.some((batch: string) => batch.toLowerCase() === batchId.toLowerCase()),
  );
}
