import { BackNavigation } from '../../components/ui/BackNavigation';
import { useCallback, useEffect, useState } from 'react';
import { Boxes, FilterX, Layers, MapPin, RefreshCw, Search, Warehouse } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { reportError } from '../../components/ui/feedback';
import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import { getOrders, type OrderRecord, type OrdersState } from './orders.api';
import { ReadModelStatus } from './ReadModelStatus';
import { formatOperationalQuantity } from '../workspaces/shared/operational-format';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  InventoryExpandButton,
  InventoryFact,
  InventorySummaryCard,
  InventoryViewToggle,
  openCardOnClick,
  LoadFailed,
  SectionTitle,
  SelectField,
  TechnicalDetails,
  type InventoryView,
} from '../workspaces/shared/ui';

type InventoryRole = 'supplier' | 'distributor' | 'manufacturer';
type InventoryKind = 'ingredient' | 'product';
type StockStatus = 'available' | 'reserved' | 'empty' | 'inactive' | 'unknown';
type InventoryRow = OrderRecord & { id: string; kind: InventoryKind };

const same = (left?: string, right?: string) =>
  !!left && !!right && left.toLowerCase() === right.toLowerCase();
const short = (value?: string) =>
  value ? `${value.slice(0, 10)}…${value.slice(-6)}` : 'Unavailable';

export function CustodyInventoryPage({
  role,
  initialKind,
}: {
  role: InventoryRole;
  initialKind?: InventoryKind;
}) {
  const kind: InventoryKind =
    role === 'manufacturer'
      ? 'product'
      : role === 'supplier'
        ? 'ingredient'
        : (initialKind ?? 'ingredient');
  const [data, setData] = useState<OrdersState>();
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StockStatus>('all');
  const [sort, setSort] = useState('name');
  const [view, setView] = useState<InventoryView>(() => readInventoryView(role, kind));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [params, setParams] = useSearchParams();

  const load = useCallback(async (refresh = false) => {
    setError('');
    try {
      setData(await getOrders('custody-inventory', { refresh }));
    } catch (cause) {
      setError(reportError(cause, 'Custody inventory unavailable.'));
      setData((current) =>
        current?.readModel
          ? {
              ...current,
              readModel: { ...current.readModel, refreshing: false, refreshFailed: true },
            }
          : current,
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeView = (nextView: InventoryView) => {
    setView(nextView);
    try {
      window.localStorage.setItem(inventoryViewKey(role, kind), nextView);
    } catch {
      // The current selection remains usable when browser storage is unavailable.
    }
  };

  if (!data)
    return error ? (
      <LoadFailed message={error} onRetry={() => void load()} />
    ) : (
      <LoadingIndicator page label="Reading your authorized custody inventory…" />
    );

  const ingredientRows: InventoryRow[] = (data.logistics?.positions ?? [])
    .filter((entry) =>
      role === 'distributor'
        ? same(entry.distributor, data.actor)
        : same(entry.supplier, data.actor),
    )
    .map((entry) => ({ ...entry, kind: 'ingredient', id: entry.positionId }));
  const productRows: InventoryRow[] =
    role === 'distributor' || role === 'manufacturer'
      ? (role === 'manufacturer'
          ? (data.logistics?.productPositions ?? [])
          : (data.logistics?.productStock ?? [])
        ).map((entry) => ({
          ...entry,
          kind: 'product',
          id:
            role === 'manufacturer'
              ? `${entry.batchId}:${entry.distributor}:${entry.location}`
              : entry.batchId,
        }))
      : [];
  const rows = [...ingredientRows, ...productRows];
  const selected = rows.find((entry) => same(entry.id, params.get('id') ?? ''));
  const openId = params.get('id');
  const kindRows = rows.filter((entry) => entry.kind === kind);
  const locations = Array.from(
    new Map(
      kindRows
        .filter((entry) => entry.location)
        .map((entry) => [entry.location, locationName(data, entry)]),
    ),
  );
  const query = search.trim().toLocaleLowerCase();
  const matchingRows = kindRows
    .filter((entry) => {
      const item = presentation(data, entry);
      const status = stockStatus(entry, item);
      return (
        (!locationFilter || same(entry.location, locationFilter)) &&
        (statusFilter === 'all' || status === statusFilter) &&
        (!query ||
          [
            title(entry, item),
            item.batchReference,
            item.category,
            sourceCompanyName(data, entry, item),
            custodianCompanyName(data, entry, role),
            locationName(data, entry),
            entry.batchId,
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase()
            .includes(query))
      );
    })
    .sort((left, right) => compareInventoryRows(data, left, right, sort));
  const summary = inventorySummary(kindRows);
  const filtersActive =
    Boolean(search.trim()) || locationFilter !== '' || statusFilter !== 'all' || sort !== 'name';
  const copy = inventoryCopy(role, kind);

  const clearFilters = () => {
    setSearch('');
    setLocationFilter('');
    setStatusFilter('all');
    setSort('name');
  };
  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section className="ingredient-inventory custody-inventory" aria-label={copy.title}>
      <SectionTitle
        title={copy.title}
        sub={copy.subtitle}
        action={
          <Btn variant="outline" icon={<RefreshCw size={16} />} onClick={() => void load(true)}>
            Refresh inventory
          </Btn>
        }
      />

      <ReadModelStatus state={data} />
      {error && <Alert type="error" message={error} />}
      {!data.warehouseSupported && (
        <Alert
          type="warning"
          message="This deployment does not support warehouse custody inventory."
        />
      )}

      {openId && !selected ? (
        <Alert
          type="warning"
          message="This custody record was not found or is not available to your company."
        />
      ) : selected ? (
        <CustodyInventoryDetail
          data={data}
          entry={selected}
          role={role}
          onBack={() => setParams({})}
        />
      ) : (
        <>
          <div className="ingredient-summary-grid" aria-label={`${copy.title} summary`}>
            <InventorySummaryCard
              label={kind === 'ingredient' ? 'Ingredient batches' : 'Product batches'}
              value={kindRows.length}
              icon={<Layers size={21} />}
            />
            <InventorySummaryCard
              label="Available quantity"
              value={summary.available.value}
              note={summary.available.note}
              icon={<Boxes size={21} />}
            />
            <InventorySummaryCard
              label="Reserved quantity"
              value={summary.reserved.value}
              note={summary.reserved.note}
              icon={<Warehouse size={21} />}
            />
            <InventorySummaryCard
              label="Custody locations"
              value={summary.locations}
              note="Authorized locations"
              icon={<MapPin size={21} />}
            />
          </div>

          <div
            className="ingredient-toolbar custody-inventory-toolbar"
            aria-label={`${copy.title} filters`}
          >
            <Input
              label="Search custody inventory"
              type="search"
              icon={<Search size={16} />}
              placeholder="Batch, company or location"
              value={search}
              onChange={setSearch}
            />
            <SelectField
              label="Location"
              value={locationFilter}
              onChange={setLocationFilter}
              options={[
                { value: '', label: 'All locations' },
                ...locations.map(([value, label]) => ({ value, label })),
              ]}
            />
            <SelectField
              label="Stock status"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as typeof statusFilter)}
              options={[
                { value: 'all', label: 'All stock statuses' },
                { value: 'available', label: 'Available' },
                { value: 'reserved', label: 'Fully reserved' },
                { value: 'empty', label: 'No available stock' },
                { value: 'inactive', label: 'Inactive batch' },
                { value: 'unknown', label: 'Status unavailable' },
              ]}
            />
            <SelectField
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'name', label: 'Name A–Z' },
                { value: 'available-high', label: 'Highest available' },
                { value: 'available-low', label: 'Lowest available' },
                { value: 'location', label: 'Location A–Z' },
              ]}
            />
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
                {matchingRows.length} {matchingRows.length === 1 ? 'record' : 'records'}
              </strong>
              <span>{copy.resultNote}</span>
            </div>
            <InventoryViewToggle
              value={view}
              onChange={changeView}
              label="Custody inventory view"
            />
          </div>

          {kindRows.length && matchingRows.length ? (
            <div className={`ingredient-grid ingredient-grid--${view} custody-inventory-grid`}>
              {matchingRows.map((entry) => (
                <CustodyInventoryCard
                  key={entry.id}
                  data={data}
                  entry={entry}
                  role={role}
                  view={view}
                  expanded={expandedIds.has(entry.id)}
                  onDetails={() => setParams({ id: entry.id })}
                  onToggle={() => toggleExpanded(entry.id)}
                />
              ))}
            </div>
          ) : kindRows.length ? (
            <EmptyState
              icon={<Search size={36} />}
              title="No matching inventory"
              sub="Try another search, location, stock status or sort order."
              action={<Btn onClick={clearFilters}>Clear filters</Btn>}
            />
          ) : (
            <EmptyState
              icon={<Warehouse size={36} />}
              title={`No ${kind} custody inventory`}
              sub="Only authorized custody records appear after physical receipt."
            />
          )}
        </>
      )}
    </section>
  );
}

function CustodyInventoryCard({
  data,
  entry,
  role,
  view,
  expanded,
  onDetails,
  onToggle,
}: {
  data: OrdersState;
  entry: InventoryRow;
  role: InventoryRole;
  view: InventoryView;
  expanded: boolean;
  onDetails: () => void;
  onToggle: () => void;
}) {
  const item = presentation(data, entry);
  const name = title(entry, item);
  const source = sourceCompany(data, entry, item);
  const custodian = custodianCompany(data, entry, role);
  const status = stockBadge(stockStatus(entry, item));
  const detailsId = `custody-inventory-details-${safeId(entry.id)}`;
  const primaryActions = (
    <div className="ingredient-card__primary-actions">
      <Btn onClick={onDetails}>View details</Btn>
      <InventoryExpandButton expanded={expanded} controls={detailsId} onClick={onToggle} />
    </div>
  );

  return (
    <article
      className={`ingredient-card ingredient-card--${view} custody-inventory-card is-clickable${expanded ? ' is-expanded' : ''}`}
      data-inventory-id={entry.id}
      onClick={openCardOnClick(onDetails)}
    >
      <div className="ingredient-card__media">
        <CatalogueImage
          path={item.imagePath}
          category={item.category ?? (entry.kind === 'ingredient' ? 'Ingredient' : 'Product')}
          alt={`${name} presentation image`}
        />
        {view === 'grid' && (
          <div className="ingredient-card__status">
            <Badge {...status} />
          </div>
        )}
      </div>

      {view === 'grid' ? (
        <div className="ingredient-card__body">
          <InventoryIdentity name={name} reference={item.batchReference ?? short(entry.batchId)} />
          <CompanyIdentity company={source} />
          <dl className="ingredient-card__highlights">
            <InventoryFact
              label="Available"
              value={formatOperationalQuantity(entry.available, entry.unit)}
            />
            <InventoryFact label="Location" value={locationName(data, entry)} />
          </dl>
          <dl className="ingredient-card__dates ingredient-card__dates--collapsed">
            <InventoryFact
              label="Physical quantity"
              value={formatOperationalQuantity(entry.quantity, entry.unit)}
            />
          </dl>
          <div className="ingredient-card__credential">
            <span>Stock status</span>
            <Badge {...status} size="xs" />
          </div>
          {primaryActions}
        </div>
      ) : (
        <>
          <div className="ingredient-card__list-content">
            <div className="ingredient-card__list-heading">
              <div className="custody-inventory-card__identity-group">
                <InventoryIdentity
                  name={name}
                  reference={item.batchReference ?? short(entry.batchId)}
                />
                <CompanyIdentity company={source} />
              </div>
              <div className="ingredient-card__list-status" aria-label="Stock status">
                <span>Stock status</span>
                <Badge {...status} />
              </div>
            </div>
            <dl className="ingredient-card__list-metrics">
              <InventoryFact
                label="Available quantity"
                value={formatOperationalQuantity(entry.available, entry.unit)}
              />
              <InventoryFact
                label="Physical quantity"
                value={formatOperationalQuantity(entry.quantity, entry.unit)}
              />
              <InventoryFact
                label="Reserved quantity"
                value={
                  entry.reserved === undefined
                    ? 'Unavailable'
                    : formatOperationalQuantity(entry.reserved, entry.unit)
                }
              />
              <InventoryFact label="Custody location" value={locationName(data, entry)} />
            </dl>
          </div>
          {primaryActions}
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
            <InventoryFact label="Original company" value={source.name} />
            <InventoryFact label="Current custodian" value={custodian.name} />
            <InventoryFact label="Batch category" value={item.category || 'Not recorded'} />
            <InventoryFact label="Custody location" value={locationName(data, entry)} />
            <InventoryFact
              label="Received / physical quantity"
              value={formatOperationalQuantity(entry.quantity, entry.unit)}
            />
            <InventoryFact
              label="Available quantity"
              value={formatOperationalQuantity(entry.available, entry.unit)}
            />
            <InventoryFact
              label="Reserved quantity"
              value={
                entry.reserved === undefined
                  ? 'Unavailable'
                  : formatOperationalQuantity(entry.reserved, entry.unit)
              }
            />
            <InventoryFact label="Expiry" value={formatDate(item.expiresAt ?? item.expiryDate)} />
          </dl>
          {item.description && (
            <div className="ingredient-card__description">
              <span>Description</span>
              <p>{item.description}</p>
            </div>
          )}
          <TechnicalDetails
            fields={[
              { label: 'Batch ID', value: entry.batchId },
              { label: 'Custody position', value: entry.positionId ?? 'Product location ledger' },
              { label: 'Original company wallet', value: source.wallet },
              { label: 'Custodian wallet', value: custodian.wallet },
              { label: 'Location ID', value: entry.location ?? '' },
            ]}
          />
        </div>
      </div>
    </article>
  );
}

function CustodyInventoryDetail({
  data,
  entry,
  role,
  onBack,
}: {
  data: OrdersState;
  entry: InventoryRow;
  role: InventoryRole;
  onBack: () => void;
}) {
  const item = presentation(data, entry);
  const name = title(entry, item);
  const source = sourceCompany(data, entry, item);
  const custodian = custodianCompany(data, entry, role);
  const status = stockBadge(stockStatus(entry, item));
  const related = (data.logistics?.shipments ?? []).filter(
    (shipment) =>
      same(shipment.batchId, entry.batchId) &&
      (entry.kind !== 'ingredient' || same(shipment.positionId, entry.positionId)),
  );

  return (
    <Card>
      <BackNavigation onClick={onBack}>Custody inventory</BackNavigation>
      <div className="custody-inventory-detail__hero">
        <CatalogueImage
          path={item.imagePath}
          category={item.category ?? (entry.kind === 'ingredient' ? 'Ingredient' : 'Product')}
          alt={`${name} presentation image`}
          large
        />
        <div className="custody-inventory-detail__summary">
          <Badge {...status} />
          <div>
            <h3>{name}</h3>
            <p>{item.batchReference ?? short(entry.batchId)}</p>
          </div>
          <CompanyIdentity company={source} large />
        </div>
      </div>
      <dl className="custody-inventory-detail__facts">
        <InventoryFact label="Original company" value={source.name} />
        <InventoryFact label="Current custodian" value={custodian.name} />
        <InventoryFact label="Warehouse" value={locationName(data, entry)} />
        <InventoryFact
          label="Received / physical quantity"
          value={formatOperationalQuantity(entry.quantity, entry.unit)}
        />
        <InventoryFact
          label={
            entry.kind === 'product'
              ? 'Reserved / in transit (outside available stock)'
              : 'Reserved quantity'
          }
          value={
            entry.reserved === undefined
              ? 'Unavailable'
              : formatOperationalQuantity(entry.reserved, entry.unit)
          }
        />
        <InventoryFact
          label="Available quantity"
          value={formatOperationalQuantity(entry.available, entry.unit)}
        />
      </dl>
      {!!entry.locations?.length && (
        <section className="custody-inventory-detail__locations">
          <h4>Location balances</h4>
          {entry.locations.map((location: OrderRecord) => (
            <p key={location.location}>
              <span>
                {data.locations.find((candidate) => same(candidate.location, location.location))
                  ?.label ?? short(location.location)}
              </span>
              <strong>{formatOperationalQuantity(location.available, entry.unit)}</strong>
            </p>
          ))}
        </section>
      )}
      <section className="custody-inventory-detail__shipments">
        <h4>Related shipments</h4>
        {related.length ? (
          related.map((shipment) => (
            <p key={shipment.shipmentId}>
              {shipment.senderName ?? short(shipment.sender)} →{' '}
              {shipment.recipientName ?? short(shipment.recipient)} ·{' '}
              {formatOperationalQuantity(shipment.quantity, shipment.unit)} · Received{' '}
              {formatOperationalQuantity(shipment.received ?? '0', shipment.unit)}
            </p>
          ))
        ) : (
          <p>No related shipments are available.</p>
        )}
      </section>
      <TechnicalDetails
        fields={[
          { label: 'Original batch ID', value: entry.batchId },
          { label: 'Custody position', value: entry.positionId ?? 'Product location ledger' },
          { label: 'Original company wallet', value: source.wallet },
          { label: 'Custodian wallet', value: custodian.wallet },
          { label: 'Warehouse location ID', value: entry.location ?? '' },
        ]}
      />
    </Card>
  );
}

function InventoryIdentity({ name, reference }: { name: string; reference: string }) {
  return (
    <div className="ingredient-card__identity">
      <h3 title={name}>{name}</h3>
      <p title={reference}>{reference}</p>
    </div>
  );
}

function CompanyIdentity({
  company,
  large = false,
}: {
  company: { logoPath?: string; name: string; wallet: string };
  large?: boolean;
}) {
  return (
    <div className="custody-inventory-card__company">
      <CompanyAvatar name={company.name} logoPath={company.logoPath} size={large ? 'lg' : 'sm'} />
      <span>{company.name}</span>
    </div>
  );
}

function presentation(data: OrdersState, entry: InventoryRow) {
  const catalogue = data.catalogue.find((candidate) =>
    candidate.batches?.some((batch: string) => same(batch, entry.batchId)),
  );
  const summary = catalogue?.batchSummaries?.[entry.batchId] ?? {};
  const detail =
    catalogue?.batchDetails?.find((batch: OrderRecord) => same(batch.batchId, entry.batchId)) ?? {};
  return { ...catalogue, ...summary, ...detail } as OrderRecord;
}

function title(entry: InventoryRow, item: OrderRecord) {
  return (
    item.name ?? (entry.kind === 'ingredient' ? 'Registered ingredient' : 'Registered product')
  );
}

function locationName(data: OrdersState, entry: InventoryRow) {
  return (
    entry.warehouseName ??
    data.locations.find((location) => same(location.location, entry.location))?.label ??
    'Product location ledger'
  );
}

function sourceCompany(data: OrdersState, entry: InventoryRow, item: OrderRecord) {
  const wallet = entry.supplier ?? item.seller ?? '';
  const company = data.companies?.find((candidate) => same(candidate.wallet, wallet));
  return {
    wallet,
    name:
      entry.supplierName ??
      item.sellerName ??
      company?.companyName ??
      (entry.kind === 'ingredient' ? 'Registered Supplier' : 'Registered Manufacturer'),
    logoPath: company?.logoPath ?? item.sellerLogoPath,
  };
}

function sourceCompanyName(data: OrdersState, entry: InventoryRow, item: OrderRecord) {
  return sourceCompany(data, entry, item).name;
}

function custodianCompany(data: OrdersState, entry: InventoryRow, role: InventoryRole) {
  const wallet = entry.distributor ?? (role === 'distributor' ? data.actor : '');
  const company = data.companies?.find((candidate) => same(candidate.wallet, wallet));
  return {
    wallet,
    name:
      entry.distributorName ??
      company?.companyName ??
      (role === 'distributor' ? 'Your Distributor company' : 'Registered Distributor'),
    logoPath: company?.logoPath,
  };
}

function custodianCompanyName(data: OrdersState, entry: InventoryRow, role: InventoryRole) {
  return custodianCompany(data, entry, role).name;
}

function stockStatus(entry: InventoryRow, item: OrderRecord): StockStatus {
  const expiresAt = Number(item.expiresAt ?? item.expiryDate ?? 0);
  if (
    item.active === false ||
    [2, 3].includes(Number(item.status)) ||
    (expiresAt > 0 && expiresAt <= Date.now() / 1_000)
  )
    return 'inactive';
  const available = wholeQuantity(entry.available);
  if (available === undefined) return 'unknown';
  if (available > 0n) return 'available';
  const reserved = wholeQuantity(entry.reserved);
  return reserved !== undefined && reserved > 0n ? 'reserved' : 'empty';
}

function stockBadge(status: StockStatus) {
  if (status === 'available') return { label: 'Available', variant: 'active' as const };
  if (status === 'reserved') return { label: 'Fully reserved', variant: 'pending' as const };
  if (status === 'empty') return { label: 'No available stock', variant: 'expired' as const };
  if (status === 'inactive') return { label: 'Inactive batch', variant: 'revoked' as const };
  return { label: 'Status unavailable', variant: 'default' as const };
}

function inventorySummary(rows: InventoryRow[]) {
  return {
    available: quantitySummary(rows, 'available'),
    reserved: quantitySummary(rows, 'reserved'),
    locations: new Set(rows.map((entry) => entry.location).filter(Boolean)).size,
  };
}

function quantitySummary(rows: InventoryRow[], field: 'available' | 'reserved') {
  const comparable = rows.flatMap((entry) => {
    const value = wholeQuantity(entry[field]);
    return value === undefined ? [] : [{ unit: String(entry.unit ?? ''), value }];
  });
  const units = [...new Set(comparable.map((entry) => entry.unit))];
  if (!comparable.length) return { value: 'Unavailable', note: 'No comparable quantities' };
  if (units.length !== 1)
    return {
      value: `Across ${comparable.length} records`,
      note: 'Different units are not combined',
    };
  return {
    value: comparable.reduce((total, entry) => total + entry.value, 0n).toLocaleString(),
    note: units[0] || 'Unit unavailable',
  };
}

function compareInventoryRows(
  data: OrdersState,
  left: InventoryRow,
  right: InventoryRow,
  sort: string,
) {
  if (sort === 'location') return locationName(data, left).localeCompare(locationName(data, right));
  if (sort.startsWith('available')) {
    const leftQuantity = wholeQuantity(left.available) ?? -1n;
    const rightQuantity = wholeQuantity(right.available) ?? -1n;
    if (leftQuantity === rightQuantity) return 0;
    const comparison = leftQuantity < rightQuantity ? -1 : 1;
    return sort === 'available-low' ? comparison : -comparison;
  }
  return title(left, presentation(data, left)).localeCompare(
    title(right, presentation(data, right)),
  );
}

function wholeQuantity(value: unknown) {
  return /^\d+$/.test(String(value ?? '')) ? BigInt(String(value)) : undefined;
}

function formatDate(value: unknown) {
  return Number(value)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(Number(value) * 1_000)
    : 'Not recorded';
}

function inventoryCopy(role: InventoryRole, kind: InventoryKind) {
  if (role === 'distributor')
    return kind === 'ingredient'
      ? {
          title: 'Ingredient stock',
          subtitle: 'Ingredient stock physically held at your authorized warehouses.',
          resultNote: 'Physical custody balances for your Distributor company.',
        }
      : {
          title: 'Product stock',
          subtitle: 'Finished-product stock physically held at your authorized warehouses.',
          resultNote: 'Physical custody balances for your Distributor company.',
        };
  if (role === 'manufacturer')
    return {
      title: 'Stock at distributors',
      subtitle: 'Your finished-product stock held at authorized Distributor locations.',
      resultNote: 'Manufacturer-owned stock in Distributor custody.',
    };
  return {
    title: 'Stock at distributors',
    subtitle: 'Your ingredient batches physically held by authorized Distributors.',
    resultNote: 'Supplier-owned stock in Distributor custody.',
  };
}

function inventoryViewKey(role: InventoryRole, kind: InventoryKind) {
  return `tracechain:${role}-${kind}-custody-view`;
}

function readInventoryView(role: InventoryRole, kind: InventoryKind): InventoryView {
  try {
    return window.localStorage.getItem(inventoryViewKey(role, kind)) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
