import { ArrowUpRight, Inbox, Layers, PackageCheck } from 'lucide-react';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { Badge } from '../shared/ui';
import { formatOperationalQuantity } from '../shared/operational-format';
import { StakeholderOverviewLayout, type OverviewTask } from '../shared/StakeholderOverviewLayout';
import {
  OFFER_STATUS,
  catalogueItem,
  identityTasks,
  loadCatalogue,
  loadCustodyOffers,
  loadIdentityRequests,
  offerTasks,
  useOverviewSource,
} from '../shared/overview-data';

export function DistributorOverview({ onNav }: { onNav: (tab: string) => void }) {
  const operational = useOperationalData();
  const offers = useOverviewSource(loadCustodyOffers, 'Custody offers could not be loaded.');
  const identity = useOverviewSource(
    loadIdentityRequests,
    'Evidence requests could not be loaded.',
  );
  const catalogue = useOverviewSource(loadCatalogue, 'Product names could not be loaded.');

  const transfers = operational.data.transfers;
  const arrivals = transfers.filter(
    (transfer) => transfer.direction === 'incoming' && transfer.status === 1,
  );
  const outbound = transfers.filter(
    (transfer) => transfer.direction === 'outgoing' && transfer.status === 1,
  );
  const inCustody = transfers.filter(
    (transfer, index, all) =>
      all.findIndex((candidate) => candidate.productBatchId === transfer.productBatchId) ===
        index && BigInt(transfer.inventory.available) > 0n,
  );
  const offerWork = offerTasks(offers.data ?? [], true, () => onNav('intake'));
  const arrivalWork: OverviewTask[] = arrivals.map((transfer) => {
    const item = catalogueItem(catalogue.data, transfer.productBatchId);
    return {
      key: `arrival:${transfer.transferId}`,
      task: 'Receive product arrival',
      item: item?.name ?? 'Product shipment',
      detail: formatOperationalQuantity(transfer.quantity, item?.unit),
      counterparty: transfer.senderName ?? transfer.manufacturerName,
      due: transfer.expectedAt,
      badge: { label: 'Awaiting receipt', variant: 'pending' },
      actionLabel: 'Receive',
      onAction: () => onNav('arrivals'),
    };
  });
  const recentOffers = [...(offers.data ?? [])].sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  );

  return (
    <StakeholderOverviewLayout
      refreshing={
        operational.refreshing || offers.refreshing || identity.refreshing || catalogue.refreshing
      }
      title="Distributor overview"
      description="Custody offers to handle, arrivals to receive and the stock in your warehouses."
      errors={[offers.error, identity.error, operational.error]}
      onRefresh={() => {
        offers.reload();
        identity.reload();
        void operational.reload();
      }}
      metrics={[
        {
          label: 'Offers waiting on you',
          value: offers.loading ? '…' : offerWork.length,
          icon: <Inbox size={21} />,
          onClick: () => onNav('intake'),
        },
        {
          label: 'Arrivals to receive',
          value: operational.loading ? '…' : arrivals.length,
          icon: <PackageCheck size={21} />,
          onClick: () => onNav('arrivals'),
        },
        {
          label: 'Batches in custody',
          value: operational.loading ? '…' : inCustody.length,
          icon: <Layers size={21} />,
          onClick: () => onNav('inventory'),
        },
        {
          label: 'Outbound in transit',
          value: operational.loading ? '…' : outbound.length,
          icon: <ArrowUpRight size={21} />,
          onClick: () => onNav('product-shipments'),
        },
      ]}
      tasks={[
        ...offerWork,
        ...arrivalWork,
        ...identityTasks(identity.data ?? [], () => onNav('requests')),
      ]}
      tasksLoading={offers.loading || identity.loading || operational.loading}
      snapshot={{
        title: 'Recent custody offers',
        columns: ['Item', 'From', 'Quantity', 'Pickup', 'Status'],
        rows: recentOffers.map((offer) => ({
          key: offer.offerId,
          cells: [
            <strong key="item">{offer.itemName}</strong>,
            offer.senderName,
            `${offer.quantity} ${offer.unit}`,
            offer.pickupAt ? new Date(offer.pickupAt * 1000).toLocaleString() : 'Not arranged',
            <Badge key="status" {...OFFER_STATUS[offer.status]} />,
          ],
        })),
        empty: offers.loading
          ? 'Loading custody offers…'
          : 'No custody offers yet. Suppliers and Manufacturers send them when they need warehouse space.',
        viewAllLabel: 'View all offers',
        onViewAll: () => onNav('intake'),
      }}
    />
  );
}
