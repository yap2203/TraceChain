import { useMemo, useState } from 'react';
import { Boxes, CalendarClock, FilterX, Search, Warehouse, Building2 } from 'lucide-react';
import { PaginationBar, usePagination } from '../../components/ui/PaginatedTable';
import '../workspaces/supplier/batches/ingredients.css';
import {
  Badge,
  Btn,
  EmptyState,
  Input,
  InventoryFact as Fact,
  InventorySummaryCard,
  InventoryViewToggle,
  SelectField,
  openCardOnClick,
} from '../workspaces/shared/ui';
import { CatalogueImage } from './CatalogueMedia';
import type { OrderRecord } from './orders.api';

type View = 'list' | 'grid';
const VIEW_STORAGE_KEY = 'tracechain:manufacturer-ingredient-view';

/**
 * The Manufacturer's "Supplier ingredients", laid out like the Supplier's "My ingredients"
 * (summary cards, toolbar, list/grid cards), listing only unexpired stock held in Distributor
 * custody and offering "Request quantity" on each card.
 */
export function CustodyIngredientList({
  items,
  custody,
  custodyName,
  onDetails,
  onRequest,
}: {
  items: OrderRecord[];
  /** The custody holdings of an item that can be requested. */
  custody: (item: OrderRecord) => OrderRecord[];
  custodyName: (position: OrderRecord) => string;
  onDetails: (item: OrderRecord) => void;
  onRequest: (item: OrderRecord) => void;
}) {
  const [view, setView] = useState<View>(readView);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [supplier, setSupplier] = useState('all');
  const [sort, setSort] = useState('name');
  const rows = useMemo(
    () =>
      items.map((item) => {
        const holdings = custody(item);
        const expiry = Math.min(
          ...holdings.map((position) => Number(batchExpiry(item, position.batchId)) || Infinity),
        );
        const total = holdings.reduce((sum, position) => sum + BigInt(position.available), 0n);
        return { item, holdings, expiry, total };
      }),
    [custody, items],
  );
  const categories = unique(items.map((item) => item.category));
  const suppliers = unique(items.map((item) => item.sellerName));
  const shown = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows
      .filter(
        ({ item, holdings }) =>
          (!query ||
            [
              item.name,
              item.batchReference,
              item.sellerName,
              ...holdings.map((position) => custodyName(position)),
            ]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase().includes(query))) &&
          (category === 'all' || item.category === category) &&
          (supplier === 'all' || item.sellerName === supplier),
      )
      .sort((left, right) =>
        sort === 'expiry'
          ? left.expiry - right.expiry
          : sort === 'stock'
            ? Number(right.total - left.total)
            : String(left.item.name).localeCompare(String(right.item.name)),
      );
  }, [category, custodyName, rows, search, sort, supplier]);
  const pagination = usePagination(shown.map(({ item }) => item.itemId));
  const filtersActive =
    Boolean(search.trim()) || category !== 'all' || supplier !== 'all' || sort !== 'name';
  const clear = () => {
    setSearch('');
    setCategory('all');
    setSupplier('all');
    setSort('name');
  };
  const changeView = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable; the in-memory choice still works.
    }
  };
  const warehouses = new Set(
    rows.flatMap(({ holdings }) => holdings.map((position) => position.location)),
  ).size;
  const expiring = rows.filter(({ expiry }) => expiry - Date.now() / 1000 <= 30 * 86_400).length;

  return (
    <section className="ingredient-inventory" aria-label="Supplier ingredient catalogue">
      <div className="ingredient-summary-grid" aria-label="Supplier ingredient summary">
        <InventorySummaryCard
          label="Ingredients in custody"
          value={rows.length}
          icon={<Boxes size={21} />}
        />
        <InventorySummaryCard
          label="Suppliers"
          value={suppliers.length}
          icon={<Building2 size={21} />}
        />
        <InventorySummaryCard
          label="Distributor warehouses"
          value={warehouses}
          icon={<Warehouse size={21} />}
        />
        <InventorySummaryCard
          label="Expiring soon"
          value={expiring}
          note="Within 30 days"
          icon={<CalendarClock size={21} />}
        />
      </div>

      <div className="ingredient-toolbar" aria-label="Supplier ingredient filters">
        <Input
          label="Search catalogue"
          type="search"
          icon={<Search size={17} />}
          placeholder="Ingredient, Supplier or warehouse"
          value={search}
          onChange={setSearch}
        />
        <SelectField
          label="Category"
          value={category}
          onChange={setCategory}
          options={[
            { value: 'all', label: 'All categories' },
            ...categories.map((value) => ({ value, label: value })),
          ]}
        />
        <SelectField
          label="Supplier"
          value={supplier}
          onChange={setSupplier}
          options={[
            { value: 'all', label: 'All Suppliers' },
            ...suppliers.map((value) => ({ value, label: value })),
          ]}
        />
        <SelectField
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: 'Name A–Z' },
            { value: 'expiry', label: 'Expiry soonest' },
            { value: 'stock', label: 'Most in custody' },
          ]}
        />
        <Btn
          variant="ghost"
          size="sm"
          icon={<FilterX size={15} />}
          disabled={!filtersActive}
          onClick={clear}
        >
          Clear filters
        </Btn>
      </div>

      <div className="ingredient-results-heading">
        <div className="ingredient-results-copy">
          <strong aria-live="polite">
            {shown.length} {shown.length === 1 ? 'ingredient' : 'ingredients'}
          </strong>
        </div>
        <InventoryViewToggle value={view} onChange={changeView} label="Ingredient view" />
      </div>

      {!rows.length ? (
        <EmptyState
          icon={<Boxes size={44} />}
          title="No ingredients in custody"
          sub="Ingredients appear here once a Supplier's stock is held in Distributor custody and has not expired."
        />
      ) : !shown.length ? (
        <EmptyState
          icon={<Search size={44} />}
          title="No ingredients match these filters"
          sub="Clear or adjust the filters to see more ingredients."
          action={<Btn onClick={clear}>Clear filters</Btn>}
        />
      ) : (
        <>
          <div className={`ingredient-grid ingredient-grid--${view}`}>
            {shown.slice(pagination.start, pagination.end).map(({ item, holdings, expiry }) => (
              <CustodyIngredientCard
                key={item.itemId}
                item={item}
                view={view}
                holdings={holdings}
                expiry={expiry}
                custodyName={custodyName}
                onDetails={() => onDetails(item)}
                onRequest={() => onRequest(item)}
              />
            ))}
          </div>
          <PaginationBar pagination={pagination} label="Ingredient pages" />
        </>
      )}
    </section>
  );
}

function CustodyIngredientCard({
  item,
  view,
  holdings,
  expiry,
  custodyName,
  onDetails,
  onRequest,
}: {
  item: OrderRecord;
  view: View;
  holdings: OrderRecord[];
  expiry: number;
  custodyName: (position: OrderRecord) => string;
  onDetails: () => void;
  onRequest: () => void;
}) {
  const credentialActive = Number(item.credentialStatus) === 1;
  const inCustody = (
    <span className="catalogue-custody-lines">
      {holdings.map((position) => (
        <span className="catalogue-custody-line" key={position.positionId}>
          {custodyName(position)} · {amount(position.available, item.unit)}
        </span>
      ))}
    </span>
  );
  const actions = (
    <div className="ingredient-card__primary-actions">
      <Btn variant="outline" onClick={onDetails}>
        View details
      </Btn>
      <Btn disabled={!item.active} onClick={onRequest}>
        Request quantity
      </Btn>
    </div>
  );
  const credential = (
    <Badge
      label={credentialActive ? 'Active' : 'Status unavailable'}
      variant={credentialActive ? 'verified' : 'pending'}
      size="xs"
    />
  );
  const status = item.active
    ? { label: 'Available', variant: 'active' as const }
    : { label: 'Unavailable', variant: 'pending' as const };
  const identity = (
    <div className="ingredient-card__identity">
      <h3 title={item.name}>{item.name}</h3>
      <p>
        {[item.batchReference, item.sellerName ?? 'Verified Supplier'].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
  return (
    <article
      className={`ingredient-card ingredient-card--${view} is-clickable`}
      onClick={openCardOnClick(onDetails)}
    >
      <div className="ingredient-card__media">
        <CatalogueImage
          path={item.imagePath}
          category={item.category}
          alt={`Supplier-provided image of ${item.name}`}
        />
        {view === 'grid' && (
          <div className="ingredient-card__status">
            <Badge {...status} />
          </div>
        )}
      </div>
      {view === 'grid' ? (
        <div className="ingredient-card__body">
          {identity}
          <dl className="ingredient-card__highlights">
            <Fact label="In custody" value={inCustody} />
            <Fact label="Indicative price" value={price(item)} />
          </dl>
          <dl className="ingredient-card__dates ingredient-card__dates--collapsed">
            <Fact label="Expires" value={date(expiry)} />
          </dl>
          <div className="ingredient-card__credential">
            <span>Credential</span>
            {credential}
          </div>
          {actions}
        </div>
      ) : (
        <>
          <div className="ingredient-card__list-content">
            <div className="ingredient-card__list-heading">
              {identity}
              <div className="ingredient-card__list-status" aria-label="Availability">
                <span>Status</span>
                <Badge {...status} />
              </div>
            </div>
            <dl className="ingredient-card__list-metrics">
              <Fact label="In custody" value={inCustody} />
              <Fact label="Indicative price" value={price(item)} />
              <Fact label="Expires" value={date(expiry)} />
              <Fact label="Credential status" value={credential} />
            </dl>
          </div>
          {actions}
        </>
      )}
    </article>
  );
}

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

function batchExpiry(item: OrderRecord, batchId: string) {
  return item.batchDetails?.find(
    (entry: OrderRecord) => String(entry.batchId).toLowerCase() === String(batchId).toLowerCase(),
  )?.expiresAt;
}

function unique(values: unknown[]) {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())),
    ),
  ].sort();
}

function amount(value: unknown, unit: string) {
  const number = Number(value);
  return `${Number.isFinite(number) ? number.toLocaleString() : String(value)} ${unit}`;
}

function price(item: OrderRecord) {
  return item.price !== undefined
    ? `${item.currency ?? 'MYR'} ${item.price} / ${item.priceBasis || item.unit}`
    : 'Not provided';
}

function date(seconds: number) {
  return Number.isFinite(seconds)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(seconds * 1_000)
    : 'Not recorded';
}
