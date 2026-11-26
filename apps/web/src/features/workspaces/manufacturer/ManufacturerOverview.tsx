import { ClipboardCheck, FileSearch, Package, ShoppingCart } from 'lucide-react';
import { requestStatus } from '@tracechain/shared';

import { useOperationalData } from '../../blockchain/useOperationalData';
import { Badge } from '../shared/ui';
import { formatOperationalQuantity } from '../shared/operational-format';
import { StakeholderOverviewLayout } from '../shared/StakeholderOverviewLayout';
import {
  catalogueItem,
  identityTasks,
  ingredientEvidenceTasks,
  loadCatalogue,
  loadCustodyOffers,
  loadIdentityRequests,
  loadMyOrders,
  loadOrdersToApprove,
  offerTasks,
  orderTasks,
  useOverviewSource,
} from '../shared/overview-data';

export function ManufacturerOverview({ onNav }: { onNav: (tab: string) => void }) {
  const operational = useOperationalData();
  const productOrders = useOverviewSource(loadOrdersToApprove, 'Orders could not be loaded.');
  const myOrders = useOverviewSource(loadMyOrders, 'Ingredient orders could not be loaded.');
  const offers = useOverviewSource(loadCustodyOffers, 'Custody offers could not be loaded.');
  const identity = useOverviewSource(
    loadIdentityRequests,
    'Evidence requests could not be loaded.',
  );
  const catalogue = useOverviewSource(loadCatalogue, 'Product names could not be loaded.');

  const products = operational.data.productBatches;
  const now = Date.now() / 1000;
  const activeProducts = products.filter(
    (product) => product.status === 1 && product.expiresAt > now,
  );
  const ingredientName = (batchId: string) => catalogueItem(catalogue.data, batchId)?.name;
  const evidence = ingredientEvidenceTasks(
    operational.data.evidenceRequests,
    'requester',
    ingredientName,
    () => onNav('requests'),
  );
  const ingredientOrdersOpen = (myOrders.data ?? []).filter(
    (order) => requestStatus(order).group !== 'closed',
  );

  return (
    <StakeholderOverviewLayout
      title="Manufacturer overview"
      description="Product orders to approve, supplier evidence to review and your product batches."
      errors={[
        productOrders.error,
        myOrders.error,
        offers.error,
        identity.error,
        operational.error,
      ]}
      onRefresh={() => {
        productOrders.reload();
        myOrders.reload();
        offers.reload();
        identity.reload();
        void operational.reload();
      }}
      metrics={[
        {
          label: 'Product orders to approve',
          value: productOrders.loading ? '…' : (productOrders.data?.length ?? 0),
          icon: <ClipboardCheck size={21} />,
          onClick: () => onNav('product-orders'),
        },
        {
          label: 'Evidence to review',
          value: operational.loading ? '…' : evidence.length,
          icon: <FileSearch size={21} />,
          onClick: () => onNav('requests'),
        },
        {
          label: 'Ingredient orders open',
          value: myOrders.loading ? '…' : ingredientOrdersOpen.length,
          icon: <ShoppingCart size={21} />,
          onClick: () => onNav('orders'),
        },
        {
          label: 'Active product batches',
          value: operational.loading ? '…' : activeProducts.length,
          icon: <Package size={21} />,
          onClick: () => onNav('products'),
        },
      ]}
      tasks={[
        ...orderTasks(productOrders.data ?? [], () => onNav('product-orders')),
        ...evidence,
        ...identityTasks(identity.data ?? [], () => onNav('requests')),
        ...offerTasks(offers.data ?? [], false, () => onNav('transfers')),
      ]}
      tasksLoading={
        productOrders.loading || offers.loading || identity.loading || operational.loading
      }
      snapshot={{
        title: 'Your product batches',
        columns: ['Product', 'Batch', 'Quantity', 'Ingredients', 'Expires', 'Status'],
        rows: [...products]
          .sort((a, b) => b.producedAt - a.producedAt)
          .map((product) => {
            const item = catalogueItem(catalogue.data, product.batchId);
            const active = product.status === 1 && product.expiresAt > now;
            return {
              key: product.batchId,
              cells: [
                <strong key="name">{item?.name ?? 'Product batch'}</strong>,
                item?.batchReference ?? '—',
                formatOperationalQuantity(product.totalQuantity, product.unit),
                `${product.ingredients.length} linked`,
                new Date(product.expiresAt * 1000).toLocaleDateString(),
                <Badge
                  key="status"
                  label={active ? 'Active' : 'Inactive'}
                  variant={active ? 'active' : 'expired'}
                />,
              ],
            };
          }),
        empty: operational.loading
          ? 'Loading your product batches…'
          : 'No product batches yet. Create one from received ingredients.',
        viewAllLabel: 'View all products',
        onViewAll: () => onNav('products'),
      }}
    />
  );
}
