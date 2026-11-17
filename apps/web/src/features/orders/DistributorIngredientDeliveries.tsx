import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpDown,
  Building2,
  CalendarClock,
  CheckCircle2,
  Factory,
  FilterX,
  PackageCheck,
  Scale,
  Search,
  SlidersHorizontal,
  Truck,
  Warehouse,
} from 'lucide-react';

import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord, OrdersState } from './orders.api';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Input,
  InventorySummaryCard,
  SelectField,
  StatusTabs,
  StatusTimeline,
  TechnicalDetails,
} from '../workspaces/shared/ui';

type DeliveryTab =
  'all' | 'needs-action' | 'scheduled' | 'in-transit' | 'awaiting-receipt' | 'completed';
type DeliveryStatus = 'awaiting-dispatch' | 'in-transit' | 'awaiting-receipt' | 'completed';

interface DeliveryRecord {
  batchId: string;
  batchReference: string;
  destination: string;
  expectedAt?: number;
  id: string;
  imagePath?: string;
  itemCategory?: string;
  itemName: string;
  kind: 'job' | 'shipment';
  manufacturerLogoPath?: string;
  manufacturerName: string;
  nextAction: string;
  order: OrderRecord;
  pickupAt?: number;
  quantity: string;
  reference: string;
  shipment?: OrderRecord;
  sortTime: number;
  status: DeliveryStatus;
  statusLabel: string;
  supplierLogoPath?: string;
  supplierName: string;
  tab: Exclude<DeliveryTab, 'all'>;
  unit: string;
  vehicle?: string;
  warehouse: string;
}

export function DistributorIngredientDeliveries({
  data,
  readyOrders,
  shipments,
  hasDirectDeliveries,
  locationName,
  onReviewOrder,
  onRecordOrder,
  onReviewShipment,
}: {
  data: OrdersState;
  readyOrders: OrderRecord[];
  shipments: OrderRecord[];
  hasDirectDeliveries: boolean;
  locationName: (location?: string) => string;
  onReviewOrder: (orderId: string) => void;
  onRecordOrder: (orderId: string) => void;
  onReviewShipment: (shipmentId: string) => void;
}) {
  const [tab, setTab] = useState<DeliveryTab>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | DeliveryStatus>('all');
  const [warehouse, setWarehouse] = useState('');
  const [supplier, setSupplier] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [sort, setSort] = useState('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const records = useMemo(
    () => buildDeliveryRecords(data, readyOrders, shipments, locationName),
    [data, locationName, readyOrders, shipments],
  );
  const warehouses = unique(records.map((record) => record.warehouse));
  const suppliers = unique(records.map((record) => record.supplierName));
  const manufacturers = unique(records.map((record) => record.manufacturerName));
  const query = search.trim().toLocaleLowerCase();
  const shown = records
    .filter(
      (record) =>
        (tab === 'all' || record.tab === tab) &&
        (status === 'all' || record.status === status) &&
        (!warehouse || record.warehouse === warehouse) &&
        (!supplier || record.supplierName === supplier) &&
        (!manufacturer || record.manufacturerName === manufacturer) &&
        (!query ||
          [
            record.itemName,
            record.batchReference,
            record.reference,
            record.supplierName,
            record.manufacturerName,
            record.warehouse,
            record.destination,
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(query)),
    )
    .sort((left, right) => {
      if (sort === 'oldest') return left.sortTime - right.sortTime;
      if (sort === 'expected')
        return (
          (left.expectedAt ?? Number.MAX_SAFE_INTEGER) -
          (right.expectedAt ?? Number.MAX_SAFE_INTEGER)
        );
      return right.sortTime - left.sortTime;
    });
  const summary = {
    awaitingDispatch: records.filter((record) => record.status === 'awaiting-dispatch').length,
    inTransit: records.filter((record) => record.status === 'in-transit').length,
    awaitingReceipt: records.filter((record) => record.status === 'awaiting-receipt').length,
    completed: records.filter((record) => record.status === 'completed').length,
  };
  const tabs: Array<{ count: number; label: string; value: DeliveryTab }> = [
    { value: 'all', label: 'All', count: records.length },
    {
      value: 'needs-action',
      label: 'Needs action',
      count: records.filter((record) => record.tab === 'needs-action').length,
    },
    {
      value: 'scheduled',
      label: 'Scheduled',
      count: records.filter((record) => record.tab === 'scheduled').length,
    },
    {
      value: 'in-transit',
      label: 'In transit',
      count: records.filter((record) => record.tab === 'in-transit').length,
    },
    {
      value: 'awaiting-receipt',
      label: 'Awaiting receipt',
      count: records.filter((record) => record.tab === 'awaiting-receipt').length,
    },
    {
      value: 'completed',
      label: 'Completed',
      count: records.filter((record) => record.tab === 'completed').length,
    },
  ];
  const detailedFiltersActive =
    status !== 'all' || warehouse !== '' || supplier !== '' || manufacturer !== '';
  const filtersActive =
    tab !== 'all' || Boolean(search.trim()) || detailedFiltersActive || sort !== 'newest';
  const clearFilters = () => {
    setTab('all');
    setSearch('');
    setStatus('all');
    setWarehouse('');
    setSupplier('');
    setManufacturer('');
    setSort('newest');
  };
  const filterSummary = (next: DeliveryStatus) => {
    setTab('all');
    setStatus(next);
  };

  return (
    <section className="distributor-deliveries" aria-label="Ingredient delivery records">
      <div
        className="ingredient-summary-grid distributor-deliveries__summary"
        aria-label="Ingredient delivery summary"
      >
        <InventorySummaryCard
          label="Awaiting dispatch"
          value={summary.awaitingDispatch}
          icon={<PackageCheck size={29} />}
          selected={status === 'awaiting-dispatch'}
          onClick={() => filterSummary('awaiting-dispatch')}
          variant="navigation"
        />
        <InventorySummaryCard
          label="In transit"
          value={summary.inTransit}
          icon={<Truck size={29} />}
          selected={status === 'in-transit'}
          onClick={() => filterSummary('in-transit')}
          variant="navigation"
        />
        <InventorySummaryCard
          label="Awaiting Manufacturer receipt"
          value={summary.awaitingReceipt}
          icon={<CalendarClock size={29} />}
          selected={status === 'awaiting-receipt'}
          onClick={() => filterSummary('awaiting-receipt')}
          variant="navigation"
        />
        <InventorySummaryCard
          label="Completed"
          value={summary.completed}
          icon={<CheckCircle2 size={29} />}
          selected={status === 'completed'}
          onClick={() => filterSummary('completed')}
          variant="navigation"
        />
      </div>

      <StatusTabs
        label="Ingredient delivery status"
        tabs={tabs}
        value={tab}
        variant="connected"
        onChange={(next) => {
          setTab(next);
          setStatus('all');
        }}
      />

      <div className="distributor-deliveries__controls">
        <Input
          label="Search deliveries"
          type="search"
          icon={<Search size={17} />}
          placeholder="Search deliveries..."
          value={search}
          onChange={setSearch}
        />
        <Btn
          variant="outline"
          size="sm"
          icon={<SlidersHorizontal size={16} />}
          aria-expanded={filtersOpen}
          aria-controls="ingredient-delivery-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{detailedFiltersActive ? ' •' : ''}
        </Btn>
        <label className="distributor-deliveries__sort">
          <span className="sr-only">Sort deliveries</span>
          <ArrowUpDown size={15} aria-hidden="true" />
          <select
            aria-label="Sort deliveries"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="expected">Expected arrival</option>
          </select>
        </label>
      </div>

      {filtersOpen && (
        <div id="ingredient-delivery-filters" className="distributor-deliveries__filter-panel">
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => setStatus(value as typeof status)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'awaiting-dispatch', label: 'Awaiting dispatch' },
              { value: 'in-transit', label: 'In transit' },
              { value: 'awaiting-receipt', label: 'Awaiting receipt' },
              { value: 'completed', label: 'Completed' },
            ]}
          />
          <SelectField
            label="Warehouse"
            value={warehouse}
            onChange={setWarehouse}
            options={[
              { value: '', label: 'All warehouses' },
              ...warehouses.map((value) => ({ value, label: value })),
            ]}
          />
          <SelectField
            label="Supplier"
            value={supplier}
            onChange={setSupplier}
            options={[
              { value: '', label: 'All Suppliers' },
              ...suppliers.map((value) => ({ value, label: value })),
            ]}
          />
          <SelectField
            label="Manufacturer"
            value={manufacturer}
            onChange={setManufacturer}
            options={[
              { value: '', label: 'All Manufacturers' },
              ...manufacturers.map((value) => ({ value, label: value })),
            ]}
          />
          <div className="distributor-deliveries__filter-footer">
            <strong aria-live="polite">
              {shown.length} {shown.length === 1 ? 'delivery' : 'deliveries'}
            </strong>
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
        </div>
      )}

      {!filtersOpen && (
        <div className="distributor-deliveries__result-count" aria-live="polite">
          {shown.length} {shown.length === 1 ? 'delivery' : 'deliveries'}
        </div>
      )}

      {shown.length ? (
        <div className="distributor-deliveries__list">
          {shown.some((record) => record.kind === 'job') && (
            <DeliveryGroup
              title="Delivery jobs"
              description="Reserved stock awaiting Distributor action"
            >
              {shown
                .filter((record) => record.kind === 'job')
                .map((record) => (
                  <DeliveryCard
                    key={`${record.kind}:${record.id}`}
                    record={record}
                    onReview={() => onReviewOrder(record.id)}
                    onSecondary={() => onRecordOrder(record.id)}
                  />
                ))}
            </DeliveryGroup>
          )}
          {shown.some((record) => record.kind === 'shipment') && (
            <DeliveryGroup
              title="Shipment history"
              description="On-chain deliveries and receipt status"
            >
              {shown
                .filter((record) => record.kind === 'shipment')
                .map((record) => (
                  <DeliveryCard
                    key={`${record.kind}:${record.id}`}
                    record={record}
                    onReview={() => onReviewShipment(record.id)}
                    onSecondary={() => onReviewShipment(record.id)}
                  />
                ))}
            </DeliveryGroup>
          )}
        </div>
      ) : records.length ? (
        <EmptyState
          icon={<Search size={36} />}
          title="No deliveries match your filters."
          sub="Clear or adjust the filters to see other ingredient deliveries."
          action={
            !filtersOpen ? (
              <Btn variant="outline" onClick={clearFilters}>
                Clear filters
              </Btn>
            ) : undefined
          }
        />
      ) : hasDirectDeliveries ? null : (
        <EmptyState
          icon={<Truck size={36} />}
          title="No ingredient deliveries yet."
          sub="Approved and arranged Supplier orders will appear here."
        />
      )}
    </section>
  );
}

function DeliveryGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="distributor-deliveries__group" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      <div>{children}</div>
    </section>
  );
}

function DeliveryCard({
  record,
  onReview,
  onSecondary,
}: {
  record: DeliveryRecord;
  onReview: () => void;
  onSecondary: () => void;
}) {
  const secondaryLabel =
    record.kind === 'job'
      ? 'Record dispatch'
      : record.status === 'completed'
        ? 'View completed delivery'
        : record.status === 'awaiting-receipt'
          ? 'Awaiting Manufacturer receipt'
          : 'View tracking';
  const secondaryDisabled = record.kind === 'shipment' && record.status === 'awaiting-receipt';
  return (
    <article className="distributor-delivery-card">
      <header className="distributor-delivery-card__meta">
        <div>
          <Badge
            label={record.statusLabel}
            variant={record.status === 'completed' ? 'verified' : 'pending'}
          />
          <span>{record.reference}</span>
        </div>
        <span className="distributor-delivery-card__batch">{record.batchReference}</span>
      </header>

      <div className="distributor-delivery-card__main">
        <div className="distributor-delivery-card__image">
          <CatalogueImage
            path={record.imagePath}
            category={record.itemCategory ?? 'Ingredient'}
            alt={`${record.itemName} presentation image`}
          />
        </div>
        <div className="distributor-delivery-card__identity">
          <span>Ingredient shipment</span>
          <h3>{record.itemName}</h3>
          <p className="distributor-delivery-card__quantity">
            <Scale size={18} aria-hidden="true" />
            <strong>
              {record.quantity} {record.unit}
            </strong>
          </p>
          <div className="distributor-delivery-card__companies" aria-label="Shipment companies">
            <CompanyLine
              label="From"
              name={record.supplierName}
              logoPath={record.supplierLogoPath}
            />
            <ArrowRight size={18} aria-hidden="true" />
            <CompanyLine
              label="To"
              name={record.manufacturerName}
              logoPath={record.manufacturerLogoPath}
            />
          </div>
        </div>
        <div className="distributor-delivery-card__actions action-row">
          <Btn variant="outline" disabled={secondaryDisabled} onClick={onSecondary}>
            {secondaryLabel}
          </Btn>
          <Btn onClick={onReview}>Review delivery</Btn>
        </div>
      </div>

      <div className="distributor-delivery-card__progress">
        <StatusTimeline
          label={`Route for ${record.itemName}`}
          steps={deliveryRoute(record)}
          variant="route"
        />
        <dl className="distributor-delivery-card__facts">
          <div>
            <dt>
              <Truck size={14} aria-hidden="true" /> Vehicle
            </dt>
            <dd>{record.vehicle || 'Not recorded'}</dd>
          </div>
          <div>
            <dt>
              <CalendarClock size={14} aria-hidden="true" /> Pickup date
            </dt>
            <dd>{formatTime(record.pickupAt, 'Not scheduled')}</dd>
          </div>
          <div>
            <dt>
              <CalendarClock size={14} aria-hidden="true" /> Expected arrival
            </dt>
            <dd>{formatTime(record.expectedAt, 'Not recorded')}</dd>
          </div>
        </dl>
      </div>

      <Alert type="info" message={`Next action: ${record.nextAction}`} />
      <div className="distributor-delivery-card__technical">
        <TechnicalDetails fields={technicalFields(record)} />
      </div>
    </article>
  );
}

function CompanyLine({
  label,
  name,
  logoPath,
}: {
  label: string;
  name: string;
  logoPath?: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        <CompanyAvatar name={name} logoPath={logoPath} size="sm" />
        {name}
      </strong>
    </div>
  );
}

function deliveryRoute(record: DeliveryRecord) {
  const shipped = record.kind === 'shipment';
  const completed = record.status === 'completed';
  return [
    {
      actor: record.supplierName,
      icon: <Building2 size={19} />,
      label: 'Supplier',
      state: 'complete' as const,
    },
    {
      actor: record.warehouse,
      icon: <Warehouse size={19} />,
      label: 'Distributor warehouse',
      state: shipped ? ('complete' as const) : ('current' as const),
    },
    {
      actor: record.manufacturerName,
      detail: record.destination,
      icon: <Factory size={19} />,
      label: 'Manufacturer',
      state: completed
        ? ('complete' as const)
        : shipped
          ? ('current' as const)
          : ('pending' as const),
    },
  ];
}

function technicalFields(record: DeliveryRecord) {
  const shipment = record.shipment;
  return [
    { label: 'Shipment ID', value: String(shipment?.shipmentId ?? '') },
    { label: 'Order ID', value: String(record.order.orderId ?? '') },
    { label: 'Ingredient batch ID', value: String(record.batchId ?? '') },
    { label: 'Supplier wallet', value: String(record.order.seller ?? shipment?.sender ?? '') },
    {
      label: 'Distributor wallet',
      value: String(record.order.custodyOrder?.distributor ?? shipment?.sender ?? ''),
    },
    {
      label: 'Manufacturer wallet',
      value: String(record.order.buyer ?? shipment?.recipient ?? ''),
    },
    {
      label: 'Origin location ID',
      value: String(record.order.custodyOrder?.location ?? shipment?.fromLocation ?? ''),
    },
    {
      label: 'Destination location ID',
      value: String(record.order.custodyOrder?.receivingLocation ?? shipment?.toLocation ?? ''),
    },
  ];
}

function buildDeliveryRecords(
  data: OrdersState,
  readyOrders: OrderRecord[],
  shipments: OrderRecord[],
  locationName: (location?: string) => string,
) {
  const jobs: DeliveryRecord[] = readyOrders.map((order) => {
    const item = catalogueItem(data, order.custodyOrder.batchId);
    const pickupAt = timestamp(order.custodyOrder.pickupAt);
    const arrangedAt = timestamp(order.custodyOrder.arrangedAt);
    const scheduled = pickupAt > Date.now() / 1_000;
    return {
      batchId: order.custodyOrder.batchId,
      batchReference: item?.batchReference ?? 'Batch reference unavailable',
      destination: locationName(order.custodyOrder.receivingLocation),
      expectedAt: timestamp(order.custodyOrder.expectedAt) || undefined,
      id: order.orderId,
      imagePath: item?.imagePath,
      itemCategory: item?.category,
      itemName: item?.name ?? 'Registered ingredient',
      kind: 'job',
      manufacturerLogoPath: order.buyerLogoPath,
      manufacturerName: order.buyerName ?? companyName(data, order.buyer, 'Manufacturer'),
      nextAction: 'Review the reserved stock and route before recording physical dispatch.',
      order,
      pickupAt: pickupAt || undefined,
      quantity: (BigInt(order.requested) - BigInt(order.custodyOrder.dispatched)).toString(),
      reference: `Order ${shortReference(order.orderId)}`,
      sortTime: pickupAt || arrangedAt || 0,
      status: 'awaiting-dispatch',
      statusLabel: scheduled ? 'Scheduled' : 'Awaiting dispatch',
      supplierLogoPath: order.sellerLogoPath ?? item?.sellerLogoPath,
      supplierName:
        order.sellerName ?? item?.sellerName ?? companyName(data, order.seller, 'Supplier'),
      tab: scheduled ? 'scheduled' : 'needs-action',
      unit: order.custodyOrder.unit,
      vehicle: order.custodyOrder.vehicle,
      warehouse: order.custodyOrder.warehouseName ?? locationName(order.custodyOrder.location),
    };
  });
  const shipmentRecords: DeliveryRecord[] = shipments.map((shipment) => {
    const order = data.orders.find((candidate) => same(candidate.orderId, shipment.orderId)) ?? {};
    const item = catalogueItem(data, shipment.batchId);
    const complete = Number(shipment.status) >= 3;
    const awaitingReceipt =
      !complete &&
      (Number(shipment.status) === 2 || Number(shipment.expectedAt) <= Date.now() / 1_000);
    const status: DeliveryStatus = complete
      ? 'completed'
      : awaitingReceipt
        ? 'awaiting-receipt'
        : 'in-transit';
    return {
      batchId: shipment.batchId,
      batchReference: item?.batchReference ?? 'Batch reference unavailable',
      destination: locationName(shipment.toLocation),
      expectedAt: Number(shipment.expectedAt) || undefined,
      id: shipment.shipmentId,
      imagePath: item?.imagePath,
      itemCategory: item?.category,
      itemName: shipment.itemName ?? item?.name ?? 'Registered ingredient',
      kind: 'shipment',
      manufacturerLogoPath: order.buyerLogoPath ?? shipment.recipientLogoPath,
      manufacturerName:
        order.buyerName ??
        shipment.recipientName ??
        companyName(data, shipment.recipient, 'Manufacturer'),
      nextAction: complete
        ? 'Review the completed delivery record.'
        : awaitingReceipt
          ? 'The Manufacturer must verify the shipment and confirm physical receipt.'
          : 'Track the shipment until it reaches the Manufacturer.',
      order,
      pickupAt: Number(shipment.dispatchedAt) || undefined,
      quantity: String(shipment.quantity),
      reference: `SHP-${String(shipment.shipmentId).slice(2, 10).toUpperCase()}`,
      shipment,
      sortTime: Number(shipment.dispatchedAt ?? shipment.recordedAt ?? 0),
      status,
      statusLabel:
        status === 'completed'
          ? 'Completed'
          : status === 'awaiting-receipt'
            ? 'Awaiting Manufacturer receipt'
            : 'In transit',
      supplierLogoPath: order.sellerLogoPath ?? item?.sellerLogoPath,
      supplierName:
        order.sellerName ??
        item?.sellerName ??
        companyName(data, order.seller, 'Registered Supplier'),
      tab: status,
      unit: String(shipment.unit),
      vehicle: shipment.vehicle,
      warehouse: locationName(shipment.fromLocation),
    };
  });
  return [...jobs, ...shipmentRecords];
}

function catalogueItem(data: OrdersState, batchId?: string) {
  return data.catalogue.find((item) =>
    item.batches?.some((candidate: string) => same(candidate, batchId)),
  );
}

function companyName(data: OrdersState, wallet: string | undefined, fallback: string) {
  return data.companies?.find((company) => same(company.wallet, wallet))?.companyName ?? fallback;
}

function same(left?: string, right?: string) {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function timestamp(value: unknown) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1_000) : 0;
  }
  return Number(value) || 0;
}

function formatTime(value: number | undefined, fallback: string) {
  return value ? new Date(value * 1_000).toLocaleString() : fallback;
}

function shortReference(value: string) {
  return value ? `${value.slice(0, 10)}…${value.slice(-6)}` : 'Unavailable';
}
