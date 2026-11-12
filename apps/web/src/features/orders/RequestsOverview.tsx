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
import type { OrderRecord } from './orders.api';

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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const records = useMemo(
    () =>
      orders.filter((entry) => {
        const item = catalogue.find((candidate) => candidate.itemId === entry.itemId);
        const state = requestStatus(entry).key;
        const query = search.toLocaleLowerCase();
        return (
          (status === 'all' || status === state) &&
          (!query ||
            [item?.name, entry.sellerName, entry.buyerName, entry.orderId]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase().includes(query)))
        );
      }),
    [catalogue, orders, search, status],
  );
  if (!orders.length)
    return (
      <EmptyState
        icon={<ClipboardList size={44} />}
        title={role === 'supplier' ? 'No incoming requests' : 'No requests yet'}
        sub="Quantity and information requests appear here when they are recorded."
      />
    );
  return (
    <section className="requests-overview" aria-labelledby="requests-title">
      <div className="requests-overview__heading">
        <div>
          <h3 id="requests-title">
            {role === 'supplier' ? 'Incoming Manufacturer requests' : 'My requests'}
          </h3>
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
                role === 'supplier' ? 'Manufacturer' : 'Supplier',
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

function requestStatus(order: OrderRecord) {
  if (
    /^\d+$/.test(String(order.approvedReceivedQuantity)) &&
    BigInt(order.approvedReceivedQuantity) > 0n
  ) {
    return BigInt(order.approvedReceivedQuantity) >= BigInt(order.requested)
      ? { key: 'completed', label: 'Received', variant: 'verified' as const }
      : { key: 'approved', label: 'Partially received', variant: 'accepted' as const };
  }
  if (Number(order.decision?.status) === 1)
    return { key: 'approved', label: 'Approved', variant: 'accepted' as const };
  if (Number(order.decision?.status) === 2)
    return { key: 'rejected', label: 'Rejected', variant: 'rejected' as const };
  if (Number(order.status) === 3)
    return { key: 'completed', label: 'Completed', variant: 'verified' as const };
  if (Number(order.expiresAt) <= Date.now() / 1000)
    return { key: 'expired', label: 'Expired', variant: 'expired' as const };
  return { key: 'submitted', label: 'Awaiting Supplier response', variant: 'pending' as const };
}

function nextAction(order: OrderRecord, actor: string) {
  const state = requestStatus(order).key;
  if (state !== 'submitted')
    return state === 'approved' ? 'Coordinate separately' : 'No action required';
  return same(order.seller, actor) ? 'Review request' : 'Await Supplier response';
}

function dateTime(value: string | number | undefined) {
  return Number(value) ? new Date(Number(value) * 1000).toLocaleString() : 'Not recorded';
}

function same(left: string, right: string) {
  return left?.toLowerCase() === right?.toLowerCase();
}

function counterpartyName(order: OrderRecord, actor: string) {
  return same(order.seller, actor)
    ? (order.buyerName ?? 'Verified Manufacturer unavailable')
    : (order.sellerName ?? 'Verified Supplier unavailable');
}
