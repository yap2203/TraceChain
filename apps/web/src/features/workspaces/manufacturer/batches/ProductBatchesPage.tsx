import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import {
  Archive,
  Boxes,
  CalendarClock,
  FilterX,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { OperationalProductBatch } from '../../../blockchain/blockchain.api';
import { useOperationalData } from '../../../blockchain/useOperationalData';
import { CatalogueImage, CompanyAvatar } from '../../../orders/CatalogueMedia';
import { OrdersPage } from '../../../orders/OrdersPage';
import { getOrders, type OrderRecord, type OrdersState } from '../../../orders/orders.api';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Input,
  InventoryExpandButton,
  InventoryFact,
  InventorySummaryCard,
  InventoryViewToggle,
  SectionTitle,
  SelectField,
  TechnicalDetails,
  type InventoryView,
} from '../../shared/ui';
import {
  chainDate,
  formatOperationalPrice,
  formatOperationalQuantity,
  operationalUnit,
  shortChainId,
} from '../../shared/operational-format';

type ProductStatus = 'active' | 'archived' | 'expired' | 'recalled' | 'suspended';
type ProductItem = {
  metadata: OrderRecord;
  product: OperationalProductBatch;
  status: ProductStatus;
};

const PRODUCT_VIEW_STORAGE_KEY = 'tracechain.manufacturer.products.view';

export function ProductBatches({
  onNew,
  onTransfer,
  onDetail,
  section = 'products',
  ingredientBatchId,
}: {
  onNew: () => void;
  onTransfer: () => void;
  onDetail: (id: string) => void;
  section?: 'products' | 'ingredients';
  onSectionChange?: (section: 'products' | 'ingredients') => void;
  ingredientBatchId?: string;
}) {
  if (section === 'ingredients')
    return <OrdersPage role="manufacturer" mode="browse" initialBatchId={ingredientBatchId} />;
  return <OwnedProducts onNew={onNew} onDetail={onDetail} onTransfer={onTransfer} />;
}

function OwnedProducts({
  onNew,
  onDetail,
  onTransfer,
}: {
  onNew: () => void;
  onDetail: (id: string) => void;
  onTransfer: () => void;
}) {
  const { data, error, loading, reload } = useOperationalData();
  const [orders, setOrders] = useState<OrdersState>();
  const [metadataError, setMetadataError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | ProductStatus>('all');
  const [expiry, setExpiry] = useState<'all' | 'expired' | '30-days' | '90-days'>('all');
  const [sort, setSort] = useState<'newest' | 'name' | 'expiry' | 'quantity'>('newest');
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<InventoryView>(readProductView);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const loadMetadata = useCallback(async () => {
    setMetadataError('');
    try {
      setOrders(await getOrders());
    } catch {
      setMetadataError(
        'Readable product metadata is unavailable. Registered product records are still shown.',
      );
    }
  }, []);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await Promise.all([reload(), loadMetadata()]);
    setRefreshing(false);
  };

  const items = useMemo(
    () =>
      data.productBatches
        .filter(
          (product) =>
            !!data.actorWallet &&
            product.manufacturer.toLowerCase() === data.actorWallet.toLowerCase(),
        )
        .map((product): ProductItem => {
          const catalogueItem = orders?.catalogue.find((entry) =>
            entry.batches?.some(
              (batchId: string) => batchId.toLowerCase() === product.batchId.toLowerCase(),
            ),
          );
          const summary = catalogueItem?.batchSummaries?.[product.batchId] ?? {};
          const details =
            catalogueItem?.batchDetails?.find(
              (entry: OrderRecord) =>
                String(entry.batchId).toLowerCase() === product.batchId.toLowerCase(),
            ) ?? {};
          const metadata = { ...catalogueItem, ...summary, ...details };
          return { product, metadata, status: productStatus(product, metadata) };
        }),
    [data.actorWallet, data.productBatches, orders],
  );

  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const now = Date.now() / 1_000;
    const expiryLimit = expiry === '30-days' ? now + 30 * 86400 : now + 90 * 86400;
    return items
      .filter((item) => {
        if (!showArchived && item.status === 'archived' && status !== 'archived') return false;
        if (status !== 'all' && item.status !== status) return false;
        if (expiry === 'expired' && item.status !== 'expired') return false;
        if (
          (expiry === '30-days' || expiry === '90-days') &&
          (item.product.expiresAt <= now || item.product.expiresAt > expiryLimit)
        )
          return false;
        return (
          !query ||
          [productName(item), batchReference(item), item.product.batchId]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)
        );
      })
      .sort((left, right) => compareProducts(left, right, sort));
  }, [expiry, items, search, showArchived, sort, status]);

  const summary = productSummary(items);
  const filtersActive =
    !!search.trim() || status !== 'all' || expiry !== 'all' || sort !== 'newest' || showArchived;
  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setExpiry('all');
    setSort('newest');
    setShowArchived(false);
  };
  const changeView = (next: InventoryView) => {
    setView(next);
    try {
      window.localStorage.setItem(PRODUCT_VIEW_STORAGE_KEY, next);
    } catch {
      // The selected view remains usable when browser storage is unavailable.
    }
  };
  const toggleExpanded = (batchId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  return (
    <section className="ingredient-inventory manufacturer-product-inventory" aria-label="Products">
      <SectionTitle
        title="Products"
        sub="Manage products made by your company."
        action={
          <div className="ingredient-page-actions action-row">
            <Btn
              variant="outline"
              icon={<RefreshCw size={16} />}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Btn>
            <Btn icon={<Plus size={16} />} onClick={onNew}>
              Create product batch
            </Btn>
          </div>
        }
      />

      {error && !loading && (
        <div className="ingredient-page-alert">
          <Alert type="error" message={error} />
          <Btn variant="outline" size="sm" onClick={() => void refresh()}>
            Try again
          </Btn>
        </div>
      )}
      {metadataError && <Alert type="warning" message={metadataError} />}

      {loading ? (
        <LoadingIndicator page label="Loading registered products…" />
      ) : error ? null : (
        <>
          <div className="ingredient-summary-grid" aria-label="Product inventory summary">
            <InventorySummaryCard
              label="Active batches"
              value={summary.active}
              icon={<PackageCheck size={21} />}
            />
            <InventorySummaryCard
              label="Total available units"
              value={summary.quantity.value}
              note={summary.quantity.note}
              icon={<Boxes size={21} />}
            />
            <InventorySummaryCard
              label="Expiring soon"
              value={summary.expiring}
              note="Within 30 days"
              icon={<CalendarClock size={21} />}
            />
            <InventorySummaryCard
              label="Archived batches"
              value={summary.archived}
              icon={<Archive size={21} />}
            />
          </div>

          <div className="ingredient-toolbar" aria-label="Product batch filters">
            <Input
              label="Search products"
              type="search"
              icon={<Search size={17} />}
              placeholder="Product name, batch reference or batch ID"
              value={search}
              onChange={setSearch}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(value) => setStatus(value as typeof status)}
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'suspended', label: 'Suspended' },
                { value: 'recalled', label: 'Recalled' },
                { value: 'expired', label: 'Expired' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
            <SelectField
              label="Expiry"
              value={expiry}
              onChange={(value) => setExpiry(value as typeof expiry)}
              options={[
                { value: 'all', label: 'Any expiry' },
                { value: '30-days', label: 'Within 30 days' },
                { value: '90-days', label: 'Within 90 days' },
                { value: 'expired', label: 'Already expired' },
              ]}
            />
            <SelectField
              label="Sort"
              value={sort}
              onChange={(value) => setSort(value as typeof sort)}
              options={[
                { value: 'newest', label: 'Newest' },
                { value: 'name', label: 'Name A–Z' },
                { value: 'expiry', label: 'Expiry soonest' },
                { value: 'quantity', label: 'Highest quantity' },
              ]}
            />
            <label className="ingredient-archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Show archived
            </label>
            <Btn
              variant="ghost"
              size="sm"
              icon={<FilterX size={15} />}
              disabled={!filtersActive}
              onClick={clearFilters}
            >
              Clear filters
            </Btn>
          </div>

          <div className="ingredient-results-heading">
            <div className="ingredient-results-copy">
              <strong aria-live="polite">
                {shown.length} {shown.length === 1 ? 'product' : 'products'}
              </strong>
              <span>Quantities and status come from registered product records.</span>
            </div>
            <InventoryViewToggle value={view} onChange={changeView} label="Product view" />
          </div>

          {!items.length ? (
            <EmptyState
              icon={<Package size={44} />}
              title="No products registered"
              sub="Create your first product batch after receiving usable ingredient stock."
              action={<Btn onClick={onNew}>Create product batch</Btn>}
            />
          ) : !shown.length ? (
            <EmptyState
              icon={<Search size={44} />}
              title="No products match these filters"
              sub="Clear or adjust the filters to see more product batches."
              action={<Btn onClick={clearFilters}>Clear filters</Btn>}
            />
          ) : (
            <div className={`ingredient-grid ingredient-grid--${view} manufacturer-product-grid`}>
              {shown.map((item) => (
                <ProductCard
                  key={item.product.batchId}
                  item={item}
                  locations={orders?.locations ?? []}
                  view={view}
                  expanded={expandedIds.has(item.product.batchId)}
                  onDetail={() => onDetail(item.product.batchId)}
                  onTransfer={onTransfer}
                  onToggle={() => toggleExpanded(item.product.batchId)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ProductCard({
  item,
  locations,
  view,
  expanded,
  onDetail,
  onTransfer,
  onToggle,
}: {
  item: ProductItem;
  locations: OrderRecord[];
  view: InventoryView;
  expanded: boolean;
  onDetail: () => void;
  onTransfer: () => void;
  onToggle: () => void;
}) {
  const { product, metadata } = item;
  const name = productName(item);
  const reference = batchReference(item);
  const badge = productStatusBadge(item.status);
  const detailsId = `product-card-details-${safeId(product.batchId)}`;
  const storage = Array.isArray(metadata.storageLocations) ? metadata.storageLocations : [];
  const productionLocation =
    metadata.productionLocationName ?? locationLabel(metadata.productionLocation, locations);
  const manufacturer = product.manufacturerName ?? metadata.sellerName ?? 'Verified Manufacturer';
  const actions = (
    <div className="ingredient-card__primary-actions manufacturer-product-card__actions">
      <Btn onClick={onDetail}>View details</Btn>
      <Btn variant="outline" onClick={onTransfer}>
        Transfer product
      </Btn>
      <InventoryExpandButton expanded={expanded} controls={detailsId} onClick={onToggle} />
    </div>
  );

  return (
    <article
      className={`ingredient-card ingredient-card--${view} manufacturer-product-card${expanded ? ' is-expanded' : ''}`}
      data-product-id={product.batchId}
    >
      <div className="ingredient-card__media">
        <CatalogueImage
          path={metadata.imagePath}
          category={metadata.category ?? 'Product'}
          alt={`${name} product image`}
        />
        {view === 'grid' && (
          <div className="ingredient-card__status">
            <Badge {...badge} />
          </div>
        )}
      </div>

      {view === 'grid' ? (
        <div className="ingredient-card__body">
          <ProductIdentity name={name} reference={reference} />
          <dl className="ingredient-card__highlights">
            <InventoryFact
              label="Available quantity"
              value={formatOperationalQuantity(product.totalQuantity, product.unit)}
            />
            <InventoryFact
              label="Indicative price"
              value={formatOperationalPrice(metadata.currency, metadata.price, product.unit)}
            />
          </dl>
          <dl className="ingredient-card__dates">
            <InventoryFact label="Produced" value={chainDate(product.producedAt)} />
            <InventoryFact label="Expires" value={chainDate(product.expiresAt)} />
          </dl>
          <div className="ingredient-card__credential">
            <span>{product.ingredients.length} linked ingredient batches</span>
            <Badge {...badge} size="xs" />
          </div>
          {storage.length > 0 && (
            <p className="manufacturer-product-card__custody">
              {storage.length} recorded custody {storage.length === 1 ? 'location' : 'locations'}
            </p>
          )}
          {actions}
        </div>
      ) : (
        <>
          <div className="ingredient-card__list-content">
            <div className="ingredient-card__list-heading">
              <ProductIdentity name={name} reference={reference} />
              <div className="ingredient-card__list-status" aria-label="Product status">
                <span>Product status</span>
                <Badge {...badge} />
              </div>
            </div>
            <dl className="ingredient-card__list-metrics manufacturer-product-card__metrics">
              <InventoryFact
                label="Available quantity"
                value={formatOperationalQuantity(product.totalQuantity, product.unit)}
              />
              <InventoryFact
                label="Indicative price"
                value={formatOperationalPrice(metadata.currency, metadata.price, product.unit)}
              />
              <InventoryFact label="Produced" value={chainDate(product.producedAt)} />
              <InventoryFact label="Expires" value={chainDate(product.expiresAt)} />
              <InventoryFact label="Linked ingredients" value={product.ingredients.length} />
            </dl>
            {storage.length > 0 && (
              <p className="manufacturer-product-card__custody">
                Current custody: {storage.length} recorded{' '}
                {storage.length === 1 ? 'location' : 'locations'}
              </p>
            )}
          </div>
          {actions}
        </>
      )}

      <div
        id={detailsId}
        className="ingredient-card__expandable"
        aria-hidden={!expanded}
        inert={!expanded || undefined}
      >
        <div className="ingredient-card__expandable-inner">
          <dl className="ingredient-card__expanded-facts">
            <InventoryFact
              label="Manufacturer"
              value={
                <span className="workspace-company-cell">
                  <CompanyAvatar name={manufacturer} logoPath={metadata.sellerLogoPath} size="sm" />
                  {manufacturer}
                </span>
              }
            />
            <InventoryFact label="Production location" value={productionLocation} />
            <InventoryFact
              label="Linked ingredients"
              value={`${product.ingredients.length} registered batches`}
            />
            <InventoryFact label="Custody location" value={custodySummary(storage, locations)} />
          </dl>
          <div className="ingredient-card__description">
            <span>Description</span>
            <p>{metadata.description || 'No product description provided.'}</p>
          </div>
          <TechnicalDetails
            fields={[
              { label: 'Product batch ID', value: product.batchId },
              { label: 'Manufacturer wallet', value: product.manufacturer },
              { label: 'Metadata hash', value: product.metadataHash },
              { label: 'Public CID', value: product.publicCid },
              { label: 'Raw on-chain unit', value: operationalUnit(product.unit).raw },
              ...product.ingredients.map((ingredient, index) => ({
                label: `Ingredient ${index + 1}`,
                value: `${ingredient.batchId} · ${ingredient.quantity}`,
              })),
            ]}
          />
        </div>
      </div>
    </article>
  );
}

function ProductIdentity({ name, reference }: { name: string; reference: string }) {
  return (
    <div className="ingredient-card__identity">
      <h3 title={name}>{name}</h3>
      <p title={reference}>{reference}</p>
    </div>
  );
}

function productName(item: ProductItem) {
  return item.metadata.name ?? 'Registered product';
}

function batchReference(item: ProductItem) {
  return item.metadata.batchReference ?? shortChainId(item.product.batchId);
}

function productStatus(product: OperationalProductBatch, metadata: OrderRecord): ProductStatus {
  if (metadata.archived) return 'archived';
  if (product.expiresAt <= Date.now() / 1_000) return 'expired';
  if (product.status === 2) return 'suspended';
  if (product.status === 3) return 'recalled';
  return 'active';
}

function productStatusBadge(status: ProductStatus) {
  if (status === 'active') return { label: 'Active', variant: 'active' as const };
  if (status === 'archived') return { label: 'Archived', variant: 'default' as const };
  if (status === 'expired') return { label: 'Expired', variant: 'expired' as const };
  if (status === 'suspended') return { label: 'Suspended', variant: 'pending' as const };
  return { label: 'Recalled', variant: 'revoked' as const };
}

function productSummary(items: ProductItem[]) {
  const now = Date.now() / 1_000;
  const quantities = items.flatMap((item) => {
    if (!/^\d+$/.test(item.product.totalQuantity)) return [];
    const unit = operationalUnit(item.product.unit);
    return unit.canonical
      ? [{ unit: unit.canonical, quantity: BigInt(item.product.totalQuantity) }]
      : [];
  });
  const units = [...new Set(quantities.map((entry) => entry.unit))];
  const quantity = !quantities.length
    ? { value: 'Unavailable', note: 'No readable quantities' }
    : units.length === 1
      ? {
          value: quantities.reduce((total, entry) => total + entry.quantity, 0n).toLocaleString(),
          note: operationalUnit(units[0]).quantityLabel,
        }
      : { value: `Across ${quantities.length} batches`, note: 'Different units are not combined' };
  return {
    active: items.filter((item) => item.status === 'active').length,
    archived: items.filter((item) => item.status === 'archived').length,
    expiring: items.filter(
      (item) => item.product.expiresAt > now && item.product.expiresAt <= now + 30 * 86400,
    ).length,
    quantity,
  };
}

function compareProducts(left: ProductItem, right: ProductItem, sort: string) {
  if (sort === 'name') return productName(left).localeCompare(productName(right));
  if (sort === 'expiry') return left.product.expiresAt - right.product.expiresAt;
  if (sort === 'quantity') {
    const leftQuantity = /^\d+$/.test(left.product.totalQuantity)
      ? BigInt(left.product.totalQuantity)
      : -1n;
    const rightQuantity = /^\d+$/.test(right.product.totalQuantity)
      ? BigInt(right.product.totalQuantity)
      : -1n;
    return leftQuantity === rightQuantity ? 0 : leftQuantity > rightQuantity ? -1 : 1;
  }
  return right.product.producedAt - left.product.producedAt;
}

function locationLabel(value: unknown, locations: OrderRecord[]) {
  if (!value) return 'Not recorded';
  return (
    locations.find(
      (location) => String(location.location).toLowerCase() === String(value).toLowerCase(),
    )?.label ?? shortChainId(String(value))
  );
}

function custodySummary(storage: OrderRecord[], locations: OrderRecord[]) {
  if (!storage.length) return 'No custody location recorded';
  const labels = storage.map(
    (entry) =>
      entry.warehouseName ??
      locations.find(
        (location) =>
          String(location.location).toLowerCase() === String(entry.location).toLowerCase(),
      )?.label ??
      shortChainId(String(entry.location ?? '')),
  );
  return [...new Set(labels)].join(', ');
}

function readProductView(): InventoryView {
  try {
    return window.localStorage.getItem(PRODUCT_VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
