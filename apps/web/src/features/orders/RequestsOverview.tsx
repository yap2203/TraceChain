import { ClipboardList, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SelectField,
  Table,
  TD,
  TR,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord } from './orders.api';

type RequestGroup = 'attention' | 'evidence' | 'approved' | 'closed';
type RequestFilter = 'all' | RequestGroup;
type RequestSort = 'newest' | 'oldest' | 'deadline' | 'updated';

export function RequestsOverview({
  actor,
  catalogue,
  orders,
  role,
  onView,
}: {
  actor: string;
  catalogue: OrderRecord[];
  orders: OrderRecord[];
  role: string;
  onView: (orderId: string) => void;
}) {
  const supplierView = role === 'supplier';
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<RequestSort>('newest');
  const summaries = useMemo(
    () => ({
      attention: orders.filter((entry) => requestStatus(entry).group === 'attention').length,
      evidence: orders.filter((entry) => requestStatus(entry).group === 'evidence').length,
      approved: orders.filter((entry) => requestStatus(entry).group === 'approved').length,
      closed: orders.filter((entry) => requestStatus(entry).group === 'closed').length,
    }),
    [orders],
  );
  const records = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return orders
      .filter((entry) => {
        const item = catalogue.find((candidate) => candidate.itemId === entry.itemId);
        const state = requestStatus(entry);
        const matchesStatus = supplierView
          ? status === 'all' || status === state.group
          : status === 'all' || status === state.key;
        return (
          matchesStatus &&
          (!query ||
            [item?.name, item?.batchReference, entry.sellerName, entry.buyerName, entry.orderId]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase().includes(query)))
        );
      })
      .sort((left, right) => compareRequests(left, right, sort));
  }, [catalogue, orders, search, sort, status, supplierView]);

  if (!orders.length)
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
            value={orders.length}
            tone="all"
            selected={status === 'all'}
            onSelect={() => setStatus('all')}
          />
          <SummaryFilter
            label="Needs review"
            value={summaries.attention}
            tone="attention"
            selected={status === 'attention'}
            onSelect={() => setStatus('attention')}
          />
          <SummaryFilter
            label="Waiting for company evidence"
            value={summaries.evidence}
            tone="evidence"
            selected={status === 'evidence'}
            onSelect={() => setStatus('evidence')}
          />
          <SummaryFilter
            label="Approved"
            value={summaries.approved}
            tone="approved"
            selected={status === 'approved'}
            onSelect={() => setStatus('approved')}
          />
          <SummaryFilter
            label="Rejected or closed"
            value={summaries.closed}
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
          <strong aria-live="polite">{records.length} results</strong>
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
      </section>
    );

  return (
    <section className="requests-overview" aria-labelledby="requests-title">
      <div className="requests-overview__heading">
        <div>
          <h3 id="requests-title">My requests</h3>
          <p>Review the latest state and next expected action. Requests do not reserve stock.</p>
        </div>
        <strong>{records.length} results</strong>
      </div>
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
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'submitted', label: 'Awaiting Supplier response' },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
            { value: 'completed', label: 'Completed' },
            { value: 'expired', label: 'Expired' },
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
              headers={[
                'Item',
                'Supplier',
                'Quantity',
                'Requested',
                'Updated',
                'Status',
                'Next action',
                '',
              ]}
            >
              {records.map((entry) => {
                const item = catalogue.find((candidate) => candidate.itemId === entry.itemId);
                const state = requestStatus(entry);
                return (
                  <TR key={entry.orderId}>
                    <TD bold>{item?.name ?? 'Item name unavailable'}</TD>
                    <TD>{counterpartyName(entry, actor)}</TD>
                    <TD>
                      {entry.requested} {item?.unit ?? ''}
                    </TD>
                    <TD>{dateTime(entry.createdAt ?? entry.requestedAt)}</TD>
                    <TD>{dateTime(entry.updatedAt ?? entry.decision?.recordedAt)}</TD>
                    <TD>
                      <Badge label={state.label} variant={state.variant} />
                    </TD>
                    <TD>{nextAction(entry, actor)}</TD>
                    <TD>
                      <Btn size="xs" variant="outline" onClick={() => onView(entry.orderId)}>
                        View request
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
              const state = requestStatus(entry);
              return (
                <Card key={entry.orderId}>
                  <div className="requests-mobile__title">
                    <h4>{item?.name ?? 'Item name unavailable'}</h4>
                    <Badge label={state.label} variant={state.variant} />
                  </div>
                  <p>{counterpartyName(entry, actor)}</p>
                  <p>
                    <strong>
                      {entry.requested} {item?.unit ?? ''}
                    </strong>{' '}
                    · {nextAction(entry, actor)}
                  </p>
                  <p>Updated {dateTime(entry.updatedAt ?? entry.decision?.recordedAt)}</p>
                  <Btn size="sm" variant="outline" onClick={() => onView(entry.orderId)}>
                    View request
                  </Btn>
                  <TechnicalDetails fields={[{ label: 'Request ID', value: entry.orderId }]} />
                </Card>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function RequestsLoading() {
  return (
    <div className="supplier-request-loading" role="status" aria-label="Loading requests">
      <span>Loading incoming quantity requests…</span>
      {[0, 1, 2].map((key) => (
        <div className="supplier-request-loading__row" aria-hidden="true" key={key} />
      ))}
    </div>
  );
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
  const state = requestStatus(entry);
  const manufacturer = entry.buyerName ?? 'Verified Manufacturer unavailable';
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
            <span>Batch reference: {item?.batchReference || 'Not disclosed'}</span>
          </div>
          <div className="supplier-request-company">
            <CompanyAvatar name={manufacturer} size="lg" />
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
          <div className="supplier-request-action">
            <Btn variant="outline" onClick={() => onView(entry.orderId)}>
              Review request
            </Btn>
          </div>
        </div>
      </article>
    </Card>
  );
}

export function requestStatus(order: OrderRecord) {
  if (Number(order.decision?.status) === 1)
    return {
      key: 'approved',
      group: 'approved' as const,
      label: 'Approved',
      variant: 'accepted' as const,
    };
  if (Number(order.decision?.status) === 2)
    return {
      key: 'rejected',
      group: 'closed' as const,
      label: 'Rejected',
      variant: 'rejected' as const,
    };
  if (Number(order.expiresAt) <= Date.now() / 1000)
    return {
      key: 'expired',
      group: 'closed' as const,
      label: 'Expired',
      variant: 'expired' as const,
    };
  if (Number(order.status) >= 3)
    return {
      key: 'completed',
      group: 'closed' as const,
      label: 'Closed',
      variant: 'default' as const,
    };
  if (hasValue(order.identityChallenge) && !hasValue(order.identityCredentialHash))
    return {
      key: 'evidence',
      group: 'evidence' as const,
      label: 'Waiting for Manufacturer proof',
      variant: 'requested' as const,
    };
  return {
    key: 'submitted',
    group: 'attention' as const,
    label: 'Needs your review',
    variant: 'pending' as const,
  };
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
  const state = requestStatus(order);
  if (state.group === 'evidence') return 'Wait for the Manufacturer to share its company proof.';
  if (state.group === 'approved') return 'Decision recorded. Coordinate any next steps separately.';
  if (state.group === 'closed') return 'No action required.';
  if (hasValue(order.identityCredentialHash))
    return 'Review the verified company evidence and record your decision.';
  return same(order.seller, actor)
    ? 'Review the request and record your decision.'
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
    ? (order.buyerName ?? 'Verified Manufacturer unavailable')
    : (order.sellerName ?? 'Verified Supplier unavailable');
}
