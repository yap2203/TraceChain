import { requestDisplayStatus as requestStatus } from './delivery-state';
export { requestDisplayStatus as requestStatus } from './delivery-state';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { ClipboardList, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SelectField,
  StatusTabs,
  Table,
  TD,
  TR,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord, OrdersState, OrderListOptions } from './orders.api';

type RequestGroup = 'attention' | 'evidence' | 'approved' | 'closed';
type RequestFilter = 'all' | RequestGroup;
type RequestSort = 'newest' | 'oldest' | 'deadline' | 'updated';

export function RequestsOverview({
  actor,
  catalogue,
  orders,
  role,
  onView,
  pagination,
  options,
  onQueryChange,
  direction,
}: {
  actor: string;
  catalogue: OrderRecord[];
  orders: OrderRecord[];
  role: string;
  onView: (orderId: string) => void;
  pagination?: OrdersState['pagination'];
  options?: OrderListOptions;
  onQueryChange?: (query: OrderListOptions) => void;
  direction?: 'received' | 'sent';
}) {
  const responding = direction
    ? direction === 'received'
    : role === 'supplier' || orders.some((entry) => same(entry.seller, actor));
  const supplierView = role === 'supplier';
  const [search, setSearchText] = useState(options?.search ?? '');
  const [status, setStatusValue] = useState(options?.status ?? 'all');
  const [sort, setSortValue] = useState<RequestSort>(options?.sort ?? 'newest');
  const queryCallback = useRef(onQueryChange);
  queryCallback.current = onQueryChange;
  useEffect(() => {
    if (!pagination || search === (options?.search ?? '')) return;
    const timer = setTimeout(() => queryCallback.current?.({ search, page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [search, options?.search, Boolean(pagination)]);
  const setSearch = (value: string) => setSearchText(value);
  const setStatus = (value: string) => {
    setStatusValue(value);
    if (pagination) onQueryChange?.({ status: value, page: 1 });
  };
  const setSort = (value: RequestSort) => {
    setSortValue(value);
    if (pagination) onQueryChange?.({ sort: value, page: 1 });
  };
  const summaries = useMemo(
    () => ({
      attention: orders.filter((entry) => requestStatus(entry, actor).group === 'attention').length,
      evidence: orders.filter((entry) => requestStatus(entry, actor).group === 'evidence').length,
      approved: orders.filter((entry) => requestStatus(entry, actor).group === 'approved').length,
      closed: orders.filter((entry) => requestStatus(entry, actor).group === 'closed').length,
    }),
    [orders, actor],
  );
  const records = useMemo(() => {
    if (pagination) return orders;
    const query = search.trim().toLocaleLowerCase();
    return orders
      .filter((entry) => {
        const item = catalogue.find((candidate) => candidate.itemId === entry.itemId);
        const state = requestStatus(entry, actor);
        const matchesStatus =
          status === 'all' || status === state.group || (!supplierView && status === state.key);
        return (
          matchesStatus &&
          (!query ||
            [item?.name, item?.batchReference, entry.sellerName, entry.buyerName, entry.orderId]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase().includes(query)))
        );
      })
      .sort((left, right) => compareRequests(left, right, sort));
  }, [catalogue, orders, search, sort, status, supplierView, pagination, actor]);
  const total = pagination?.total ?? records.length;
  const summaryCount = (group: string, fallback: number) => pagination?.counts[group] ?? fallback;
  const pager = pagination && (
    <nav aria-label="Order pages" className="flex flex-wrap items-center justify-end gap-3 mt-4">
      <span>
        Page {pagination.page} of {Math.max(1, Math.ceil(total / pagination.pageSize))} · {total}{' '}
        results
      </span>
      <Btn
        variant="outline"
        disabled={pagination.page <= 1}
        onClick={() => onQueryChange?.({ page: pagination.page - 1 })}
      >
        Previous page
      </Btn>
      <Btn
        variant="outline"
        disabled={pagination.page * pagination.pageSize >= total}
        onClick={() => onQueryChange?.({ page: pagination.page + 1 })}
      >
        Next page
      </Btn>
    </nav>
  );

  if (!orders.length && (!pagination || pagination.counts.all === 0))
    return (
      <EmptyState
        icon={<ClipboardList size={44} />}
        title={supplierView ? 'No incoming requests' : 'No requests yet'}
        sub={
          supplierView
            ? 'New Manufacturer quantity requests will appear here when they are recorded.'
            : 'Quantity and information requests appear here when they are recorded.'
        }
      />
    );

  if (supplierView)
    return (
      <section className="requests-overview supplier-request-inbox" aria-label="Quantity requests">
        <div className="request-summary-grid" aria-label="Filter requests by status">
          <SummaryFilter
            label="All requests"
            value={summaryCount('all', orders.length)}
            tone="all"
            selected={status === 'all'}
            onSelect={() => setStatus('all')}
          />
          <SummaryFilter
            label="Needs review"
            value={summaryCount('attention', summaries.attention)}
            tone="attention"
            selected={status === 'attention'}
            onSelect={() => setStatus('attention')}
          />
          <SummaryFilter
            label="Waiting for company evidence"
            value={summaryCount('evidence', summaries.evidence)}
            tone="evidence"
            selected={status === 'evidence'}
            onSelect={() => setStatus('evidence')}
          />
          <SummaryFilter
            label="Approved"
            value={summaryCount('approved', summaries.approved)}
            tone="approved"
            selected={status === 'approved'}
            onSelect={() => setStatus('approved')}
          />
          <SummaryFilter
            label="Rejected or closed"
            value={summaryCount('closed', summaries.closed)}
            tone="closed"
            selected={status === 'closed'}
            onSelect={() => setStatus('closed')}
          />
        </div>

        <div className="supplier-request-toolbar">
          <Input
            label="Search requests"
            type="search"
            icon={<Search size={17} />}
            value={search}
            onChange={setSearch}
            placeholder="Ingredient, batch or Manufacturer"
          />
          <SelectField
            label="Sort"
            value={sort}
            onChange={(value) => setSort(value as RequestSort)}
            options={[
              { value: 'newest', label: 'Newest request' },
              { value: 'oldest', label: 'Oldest request' },
              { value: 'deadline', label: 'Deadline soonest' },
              { value: 'updated', label: 'Recently updated' },
            ]}
          />
          <strong aria-live="polite">{total} results</strong>
        </div>

        {!records.length ? (
          <EmptyState
            icon={<Search size={44} />}
            title="No requests match these filters"
            sub="Change the search or selected status to see other requests."
            action={
              <Btn
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                  setSort('newest');
                }}
              >
                Clear filters
              </Btn>
            }
          />
        ) : (
          <div className="supplier-requests-list" aria-label="Responsive request list">
            {records.map((entry) => (
              <SupplierRequestCard
                key={entry.orderId}
                entry={entry}
                item={catalogue.find((candidate) => candidate.itemId === entry.itemId)}
                onView={onView}
              />
            ))}
          </div>
        )}
        {pager}
      </section>
    );

  return (
    <section className="requests-overview" aria-label="Requests">
      <div className="flex justify-end">
        <strong>{total} results</strong>
      </div>
      <StatusTabs
        label="Filter requests by status"
        value={status as RequestFilter}
        onChange={setStatus}
        tabs={[
          { value: 'all', label: 'All', count: summaryCount('all', orders.length) },
          {
            value: 'attention',
            label: responding ? 'Needs action' : 'Awaiting response',
            count: summaryCount('attention', summaries.attention),
          },
          {
            value: 'evidence',
            label: 'Evidence',
            count: summaryCount('evidence', summaries.evidence),
          },
          {
            value: 'approved',
            label: 'Approved',
            count: summaryCount('approved', summaries.approved),
          },
          { value: 'closed', label: 'Closed', count: summaryCount('closed', summaries.closed) },
        ]}
      />
      <div className="requests-toolbar">
        <Input
          label="Search requests"
          type="search"
          icon={<Search size={17} />}
          value={search}
          onChange={setSearch}
          placeholder="Ingredient or Supplier"
        />
        <SelectField
          label="Sort"
          value={sort}
          onChange={(value) => setSort(value as RequestSort)}
          options={[
            { value: 'newest', label: 'Newest request' },
            { value: 'oldest', label: 'Oldest request' },
            { value: 'deadline', label: 'Deadline soonest' },
            { value: 'updated', label: 'Recently updated' },
          ]}
        />
      </div>
      {!records.length ? (
        <EmptyState
          icon={<Search size={44} />}
          title="No requests match these filters"
          sub="Change the search or status filter to see other requests."
          action={
            <Btn
              onClick={() => {
                setSearch('');
                setStatus('all');
              }}
            >
              Clear filters
            </Btn>
          }
        />
      ) : (
        <>
          <div className="requests-desktop">
            <Table
              paginate={!pagination}
              headers={[
                'Item',
                responding ? 'Retailer' : role === 'manufacturer' ? 'Supplier' : 'Manufacturer',
                'Quantity',
                'Status',
                'Next action',
                '',
              ]}
            >
              {records.map((entry) => {
                const item = catalogue.find((candidate) => candidate.itemId === entry.itemId);
                const state = requestStatus(entry, actor);
                return (
                  <TR key={entry.orderId}>
                    <TD bold>
                      {item?.name ?? 'Item name unavailable'}
                      <small className="block text-ws-text2">
                        ORD-{String(entry.orderId).replace(/^0x/, '').slice(0, 8).toUpperCase()}
                      </small>
                    </TD>
                    <TD>
                      <span className="workspace-company-cell">
                        <CompanyAvatar
                          name={counterpartyName(entry, actor)}
                          logoPath={counterpartyLogoPath(entry, actor)}
                          size="sm"
                        />
                        {counterpartyName(entry, actor)}
                      </span>
                    </TD>
                    <TD>
                      {entry.requested} {item?.unit ?? ''}
                    </TD>
                    <TD>
                      <Badge label={state.label} variant={state.variant} />
                    </TD>
                    <TD>{nextAction(entry, actor)}</TD>
                    <TD>
                      <Btn size="xs" variant="outline" onClick={() => onView(entry.orderId)}>
                        View details
                      </Btn>
                    </TD>
                  </TR>
                );
              })}
            </Table>
          </div>
          <div className="requests-mobile">
            {records.map((entry) => {
              const item = catalogue.find((candidate) => candidate.itemId === entry.itemId);
              const state = requestStatus(entry, actor);
              return (
                <Card key={entry.orderId}>
                  <div className="requests-mobile__image">
                    <CatalogueImage
                      path={item?.imagePath}
                      category={item?.category}
                      alt={`${item?.name ?? 'Requested item'} image`}
                    />
                  </div>
                  <div className="requests-mobile__title">
                    <h4>{item?.name ?? 'Item name unavailable'}</h4>
                    <Badge label={state.label} variant={state.variant} />
                  </div>
                  <p className="workspace-company-cell">
                    <CompanyAvatar
                      name={counterpartyName(entry, actor)}
                      logoPath={counterpartyLogoPath(entry, actor)}
                      size="sm"
                    />
                    {counterpartyName(entry, actor)}
                  </p>
                  <p>
                    <strong>
                      {entry.requested} {item?.unit ?? ''}
                    </strong>{' '}
                    · {nextAction(entry, actor)}
                  </p>
                  <Btn size="sm" variant="outline" onClick={() => onView(entry.orderId)}>
                    View details
                  </Btn>
                  <TechnicalDetails fields={[{ label: 'Request ID', value: entry.orderId }]} />
                </Card>
              );
            })}
          </div>
        </>
      )}
      {pager}
    </section>
  );
}

export function RequestsLoading() {
  return <LoadingIndicator page layout="table" label="Loading requests" />;
}

function SummaryFilter({
  label,
  value,
  tone,
  selected,
  onSelect,
}: {
  label: string;
  value: number;
  tone: RequestFilter;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`request-summary-filter request-summary-filter--${tone}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}

function SupplierRequestCard({
  entry,
  item,
  onView,
}: {
  entry: OrderRecord;
  item?: OrderRecord;
  onView: (orderId: string) => void;
}) {
  const state = requestStatus(entry, entry.seller);
  const manufacturer = entry.buyerName ?? 'Company name unavailable';
  return (
    <Card padding="20px">
      <article className="supplier-request-row supplier-request-card">
        <CatalogueImage
          path={item?.imagePath}
          alt={`${item?.name ?? 'Ingredient'} catalogue image`}
          category={item?.category}
        />
        <div className="supplier-request-item-info">
          <div className="supplier-request-item-copy">
            <h4>{item?.name ?? 'Item name unavailable'}</h4>
            <small>ORD-{String(entry.orderId).replace(/^0x/, '').slice(0, 8).toUpperCase()}</small>
            <span>Batch reference: {item?.batchReference || 'Not disclosed'}</span>
          </div>
          <div className="supplier-request-company">
            <CompanyAvatar name={manufacturer} logoPath={entry.buyerLogoPath} size="lg" />
            <div>
              <span>Manufacturer</span>
              <strong>{manufacturer}</strong>
            </div>
          </div>
        </div>
        <dl className="supplier-request-facts">
          <div>
            <dt>Requested quantity</dt>
            <dd>
              {entry.requested} {item?.unit ?? ''}
            </dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{dateTime(entry.createdAt ?? entry.requestedAt)}</dd>
          </div>
          <div>
            <dt>Response deadline</dt>
            <dd>{dateTime(entry.expiresAt)}</dd>
          </div>
        </dl>
        <div className="supplier-request-state">
          <Badge label={state.label} variant={state.variant} />
          <p>{nextAction(entry, entry.seller)}</p>
          <strong className={deadlineClass(entry.expiresAt)}>
            {deadlineText(entry.expiresAt)}
          </strong>
          <div className="supplier-request-action action-row">
            <Btn variant="outline" onClick={() => onView(entry.orderId)}>
              View details
            </Btn>
          </div>
        </div>
      </article>
    </Card>
  );
}

export function companyEvidenceStatus(order: OrderRecord) {
  if (
    hasValue(order.identityCredentialHash) &&
    Number(order.identityValidUntil) > Date.now() / 1000
  )
    return 'Company evidence verified and recorded';
  if (hasValue(order.identityChallenge)) return 'Waiting for Manufacturer proof';
  return 'Not requested';
}

export function nextAction(order: OrderRecord, actor: string) {
  if (order.productDelivery) {
    const stage = Number(order.productDelivery.stage);
    if (stage === 2) return 'The requested Distributor must accept or decline product delivery.';
    if (stage === 3)
      return Number(order.productDelivery.mode) === 1
        ? 'The assigned Distributor scans the product-order label and confirms pickup.'
        : 'The custodian records dispatch of the reserved products.';
    if (stage === 4) return 'The Retailer scans the shipment label and confirms physical receipt.';
    if (stage === 5)
      return 'Product delivery completed. Retailer stock reflects confirmed receipt.';
    if (stage === 6)
      return 'Delivery closed. Release any expired reservation before reusing that stock.';
  }
  const state = requestStatus(order, actor);
  if (order.delivery && !order.custodyOrder && state.group === 'approved') {
    const stage = Number(order.delivery.stage);
    if (stage === 1)
      return same(actor, order.seller)
        ? 'Choose direct Distributor delivery or sufficient received custody stock.'
        : 'The Supplier is choosing direct delivery or custody fulfilment.';
    if (stage === 2) return 'The requested Distributor must accept or reject direct delivery.';
    if (stage === 3)
      return 'The Distributor must scan the Supplier label and confirm physical pickup.';
    if (stage === 4)
      return 'The Manufacturer must scan the delivered label and confirm physical receipt.';
  }
  if (order.custodyOrder && state.group === 'approved') {
    if (same(actor, order.buyer))
      return 'Open Shipments, scan the package label and confirm physical receipt after delivery.';
    if (same(actor, order.custodyOrder.distributor))
      return 'Open Shipments to dispatch the approved reserved quantity from your warehouse.';
    return 'The Distributor dispatches the reserved warehouse stock; track it in Shipments.';
  }
  if (state.group === 'evidence')
    return same(actor, order.buyer)
      ? 'Review the request and share your company evidence.'
      : 'Wait for the requesting company to share its evidence.';
  if (state.group === 'approved' && (order.productDelivery || Number(order.kind) === 2))
    return same(actor, order.seller)
      ? 'Arrange product delivery.'
      : 'Await the Manufacturer delivery arrangement.';
  if (state.group === 'approved') return 'Decision recorded. Coordinate any next steps separately.';
  if (state.group === 'closed') return 'No action required.';
  if (same(actor, order.seller) && hasValue(order.identityCredentialHash))
    return 'Review the verified company evidence and record your decision.';
  return same(order.seller, actor)
    ? 'Review the request and record your decision.'
    : Number(order.kind) === 2 || order.productDelivery
      ? 'Await the Manufacturer response.'
      : 'Await the Supplier response.';
}

function compareRequests(left: OrderRecord, right: OrderRecord, sort: RequestSort) {
  const createdLeft = numericTime(left.createdAt ?? left.requestedAt);
  const createdRight = numericTime(right.createdAt ?? right.requestedAt);
  if (sort === 'oldest') return createdLeft - createdRight;
  if (sort === 'deadline') return numericTime(left.expiresAt) - numericTime(right.expiresAt);
  if (sort === 'updated')
    return (
      numericTime(right.updatedAt ?? right.decision?.recordedAt ?? right.createdAt) -
      numericTime(left.updatedAt ?? left.decision?.recordedAt ?? left.createdAt)
    );
  return createdRight - createdLeft;
}

function dateTime(value: string | number | undefined) {
  return Number(value) ? new Date(Number(value) * 1000).toLocaleString() : 'Not recorded';
}

function numericTime(value: string | number | undefined) {
  const time = Number(value);
  return Number.isFinite(time) ? time : 0;
}

function deadlineText(value: string | number | undefined) {
  const deadline = numericTime(value);
  if (!deadline) return 'Deadline not recorded';
  const remaining = deadline - Date.now() / 1000;
  if (remaining <= 0) return 'Deadline passed';
  if (remaining <= 48 * 60 * 60) return 'Due within 48 hours';
  return 'Response window open';
}

function deadlineClass(value: string | number | undefined) {
  const remaining = numericTime(value) - Date.now() / 1000;
  return remaining <= 0
    ? 'request-deadline request-deadline--overdue'
    : remaining <= 48 * 60 * 60
      ? 'request-deadline request-deadline--soon'
      : 'request-deadline';
}

function hasValue(value: unknown) {
  return typeof value === 'string' && !!value && !/^0x0+$/.test(value);
}

function same(left: string, right: string) {
  return left?.toLowerCase() === right?.toLowerCase();
}

function counterpartyName(order: OrderRecord, actor: string) {
  return same(order.seller, actor)
    ? (order.buyerName ?? 'Company name unavailable')
    : (order.sellerName ?? 'Company name unavailable');
}

function counterpartyLogoPath(order: OrderRecord, actor: string) {
  return same(order.seller, actor) ? order.buyerLogoPath : order.sellerLogoPath;
}
