import { CalendarClock, ClipboardCheck, Layers, MessageSquareReply } from 'lucide-react';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { Badge } from '../shared/ui';
import { formatOperationalQuantity } from '../shared/operational-format';
import { StakeholderOverviewLayout } from '../shared/StakeholderOverviewLayout';
import {
  identityTasks,
  ingredientEvidenceTasks,
  loadCustodyOffers,
  loadIdentityRequests,
  loadOrdersToApprove,
  offerTasks,
  orderTasks,
  useOverviewSource,
} from '../shared/overview-data';
import { getIngredientBatches } from './batches/ingredient-batch.api';

const DAY = 24 * 60 * 60;

export function SupplierOverview({ onNav }: { onNav: (tab: string) => void }) {
  const operational = useOperationalData();
  const batches = useOverviewSource(
    () => getIngredientBatches().then((result) => result.batches),
    'Ingredient batches could not be loaded.',
  );
  const orders = useOverviewSource(loadOrdersToApprove, 'Orders could not be loaded.');
  const offers = useOverviewSource(loadCustodyOffers, 'Custody offers could not be loaded.');
  const identity = useOverviewSource(
    loadIdentityRequests,
    'Evidence requests could not be loaded.',
  );

  const now = Date.now() / 1000;
  const allBatches = batches.data ?? [];
  const active = allBatches.filter((batch) => batch.status === 1 && batch.expiresAt > now);
  const inStock = active.filter((batch) => BigInt(batch.availableQuantity) > 0n);
  const expiringSoon = active.filter((batch) => batch.expiresAt - now <= 30 * DAY);
  const batchName = (batchId: string) =>
    allBatches.find((batch) => batch.batchId === batchId)?.ingredientName;
  const evidence = ingredientEvidenceTasks(
    operational.data.evidenceRequests,
    'supplier',
    batchName,
    () => onNav('requests'),
  );
  const identityWork = identityTasks(identity.data ?? [], () => onNav('requests'));
  const tasks = [
    ...orderTasks(orders.data ?? [], () => onNav('orders')),
    ...evidence,
    ...identityWork,
    ...offerTasks(offers.data ?? [], false, () => onNav('transfers')),
  ];

  return (
    <StakeholderOverviewLayout
      title="Supplier overview"
      description="Orders to approve, evidence to answer and the ingredient stock you can sell."
      errors={[batches.error, orders.error, offers.error, identity.error, operational.error]}
      onRefresh={() => {
        batches.reload();
        orders.reload();
        offers.reload();
        identity.reload();
        void operational.reload();
      }}
      metrics={[
        {
          label: 'Orders to approve',
          value: orders.loading ? '…' : (orders.data?.length ?? 0),
          icon: <ClipboardCheck size={21} />,
          onClick: () => onNav('orders'),
        },
        {
          label: 'Evidence to answer',
          value: identity.loading ? '…' : evidence.length + identityWork.length,
          icon: <MessageSquareReply size={21} />,
          onClick: () => onNav('requests'),
        },
        {
          label: 'Batches in stock',
          value: batches.loading ? '…' : inStock.length,
          icon: <Layers size={21} />,
          onClick: () => onNav('batches'),
        },
        {
          label: 'Expiring in 30 days',
          value: batches.loading ? '…' : expiringSoon.length,
          icon: <CalendarClock size={21} />,
          onClick: () => onNav('batches'),
        },
      ]}
      tasks={tasks}
      tasksLoading={orders.loading || offers.loading || identity.loading || operational.loading}
      snapshot={{
        title: 'Your ingredient stock',
        columns: ['Ingredient', 'Batch', 'Available', 'Expires', 'Status'],
        rows: [...active]
          .sort((a, b) => a.expiresAt - b.expiresAt)
          .map((batch) => ({
            key: batch.batchId,
            cells: [
              <strong key="name">{batch.ingredientName}</strong>,
              batch.batchReference,
              formatOperationalQuantity(batch.availableQuantity, batch.unit),
              <span
                key="expiry"
                className={batch.expiresAt - now <= 30 * DAY ? 'is-soon' : undefined}
              >
                {new Date(batch.expiresAt * 1000).toLocaleDateString()}
              </span>,
              BigInt(batch.availableQuantity) > 0n ? (
                <Badge key="status" label="In stock" variant="active" />
              ) : (
                <Badge key="status" label="Sold out" variant="expired" />
              ),
            ],
          })),
        empty: batches.loading
          ? 'Loading your batches…'
          : 'No active ingredient batches. Register a batch to start selling.',
        viewAllLabel: 'View all ingredients',
        onViewAll: () => onNav('batches'),
      }}
    />
  );
}
