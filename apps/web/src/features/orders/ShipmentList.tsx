import { shipmentNeedsAction, shipmentNextAction } from './delivery-state';
import { useMemo, useState } from 'react';
import { CheckCircle2, Package, Search, Truck } from 'lucide-react';
import { PaginationBar, usePagination } from '../../components/ui/PaginatedTable';

import { shipmentStatusAccent, shipmentStatusVariant } from '../workspaces/shared/shipment-status';
import {
  Badge,
  Btn,
  EmptyState,
  Input,
  SelectField,
  StatusTabs,
  openCardOnClick,
} from '../workspaces/shared/ui';
import { formatOperationalQuantity } from '../workspaces/shared/operational-format';
import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord } from './orders.api';

type ShipmentFilter = 'all' | 'attention' | 'pickup' | 'transit' | 'receipt' | 'completed';
type ShipmentSort = 'newest' | 'arrival' | 'item';

export function ShipmentList({
  shipments,
  actor,
  catalogue,
  locationName,
  statusLabel,
  onOpen,
}: {
  shipments: OrderRecord[];
  actor?: string;
  catalogue: OrderRecord[];
  locationName: (id?: string) => string;
  statusLabel: (shipment: OrderRecord) => string;
  onOpen: (shipmentId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ShipmentFilter>('all');
  const [sort, setSort] = useState<ShipmentSort>('newest');
  const counts = useMemo(
    () => ({
      attention: shipments.filter((entry) =>
        actor
          ? shipmentNeedsAction(entry, actor)
          : shipmentGroup(entry, statusLabel(entry)) === 'attention',
      ).length,
      pickup: shipments.filter((entry) => shipmentGroup(entry, statusLabel(entry)) === 'pickup')
        .length,
      transit: shipments.filter((entry) => shipmentGroup(entry, statusLabel(entry)) === 'transit')
        .length,
      receipt: shipments.filter((entry) => shipmentGroup(entry, statusLabel(entry)) === 'receipt')
        .length,
      completed: shipments.filter(
        (entry) => shipmentGroup(entry, statusLabel(entry)) === 'completed',
      ).length,
    }),
    [shipments, statusLabel, actor],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return shipments
      .filter(
        (entry) =>
          filter === 'all' ||
          (filter === 'attention' && actor
            ? shipmentNeedsAction(entry, actor)
            : shipmentGroup(entry, statusLabel(entry)) === filter),
      )
      .filter((entry) => {
        const item = catalogueItem(catalogue, entry.batchId);
        return (
          !query ||
          [
            item?.name,
            item?.batchReference,
            entry.itemName,
            entry.senderName,
            entry.recipientName,
            entry.vehicle,
            locationName(entry.fromLocation),
            locationName(entry.toLocation),
            entry.shipmentId,
          ]
            .filter(Boolean)
            .some((value) => String(value).toLocaleLowerCase().includes(query))
        );
      })
      .sort((left, right) => compareShipments(left, right, sort, catalogue));
  }, [catalogue, filter, locationName, search, shipments, sort, statusLabel, actor]);
  const pagination = usePagination(visible.map((entry) => entry.shipmentId));
  const page = visible.slice(pagination.start, pagination.end);

  if (!shipments.length)
    return (
      <EmptyState
        icon={<Package size={38} />}
        title="No shipments yet"
        sub="Confirmed shipments involving your company will appear here."
      />
    );

  return (
    <section className="shipment-list" aria-label="Shipment records">
      <StatusTabs
        label="Filter shipments by status"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'all', label: 'All', count: shipments.length },
          { value: 'attention', label: 'Needs action', count: counts.attention },
          { value: 'pickup', label: 'Waiting for pickup', count: counts.pickup },
          { value: 'transit', label: 'In transit', count: counts.transit },
          { value: 'receipt', label: 'Awaiting receipt', count: counts.receipt },
          { value: 'completed', label: 'Completed', count: counts.completed },
        ]}
      />

      <div className="shipment-filter-toolbar">
        <Input
          label="Search shipments"
          icon={<Search size={17} />}
          type="search"
          value={search}
          onChange={setSearch}
          placeholder="Item, company, location or shipment reference"
        />
        <SelectField
          label="Sort"
          value={sort}
          onChange={(value) => setSort(value as ShipmentSort)}
          options={[
            { value: 'newest', label: 'Newest dispatch' },
            { value: 'arrival', label: 'Expected arrival' },
            { value: 'item', label: 'Item name' },
          ]}
        />
      </div>
      <div className="flex justify-end">
        <Btn
          variant="ghost"
          disabled={!search && filter === 'all' && sort === 'newest'}
          onClick={() => {
            setSearch('');
            setFilter('all');
            setSort('newest');
          }}
        >
          Clear filters
        </Btn>
      </div>

      <div className="shipment-results-heading">
        <strong aria-live="polite">
          {visible.length} {visible.length === 1 ? 'shipment' : 'shipments'}
        </strong>
      </div>
      {!visible.length ? (
        <EmptyState
          icon={<Search size={36} />}
          title="No shipments match these filters"
          sub="Change the search or status filter to see other shipment records."
          action={
            <Btn
              onClick={() => {
                setSearch('');
                setFilter('all');
              }}
            >
              Clear filters
            </Btn>
          }
        />
      ) : (
        <>
          <div className="shipment-card-list">
            {page.map((entry) => {
              const item = catalogueItem(catalogue, entry.batchId);
              const state = statusLabel(entry);
              const group = shipmentGroup(entry, state);
              const sender = entry.senderName ?? 'Sending company';
              const recipient = entry.recipientName ?? 'Receiving company';
              const distributor = entry.distributorName ?? entry.delivery?.distributorName;
              const name = entry.itemName ?? item?.name ?? 'Registered shipment item';
              const open = () => onOpen(entry.shipmentId);
              return (
                <article
                  className={`shipment-card is-${group}`}
                  style={shipmentStatusAccent(state)}
                  key={entry.shipmentId}
                  onClick={openCardOnClick(open)}
                >
                  <div className="shipment-card__media">
                    <CatalogueImage
                      path={item?.imagePath}
                      category={item?.category ?? entry.kind}
                      alt={`${name} image`}
                    />
                  </div>
                  <div className="shipment-card__content">
                    <div className="shipment-card__heading">
                      <div>
                        <span>
                          {entry.kind === 'product' ? 'Product shipment' : 'Ingredient shipment'}
                        </span>
                        <h3>{name}</h3>
                        <p>{item?.batchReference ?? 'Batch reference unavailable'}</p>
                      </div>
                      <Badge label={state} variant={shipmentStatusVariant(state)} />
                    </div>

                    <div className="shipment-journey" aria-label="Shipment journey">
                      <JourneyStop
                        role="From"
                        company={sender}
                        logoPath={entry.senderLogoPath}
                        place={locationName(entry.fromLocation)}
                        timeLabel="Pickup"
                        time={entry.dispatchedAt ?? entry.pickupAt}
                      />
                      <div className="shipment-journey__leg" aria-hidden="true">
                        <span className="shipment-journey__line" />
                        <span className="shipment-journey__vehicle">
                          {group === 'completed' ? <CheckCircle2 size={16} /> : <Truck size={16} />}
                        </span>
                        {distributor && <small>via {distributor}</small>}
                      </div>
                      <JourneyStop
                        role="To"
                        company={recipient}
                        logoPath={entry.recipientLogoPath}
                        place={locationName(entry.toLocation)}
                        timeLabel={group === 'completed' ? 'Expected' : 'Arrives'}
                        time={entry.expectedAt}
                      />
                    </div>

                    <div className="shipment-card__next">
                      <dl className="shipment-card__chips">
                        <div>
                          <dt>Quantity</dt>
                          <dd>{formatOperationalQuantity(entry.quantity, entry.unit)}</dd>
                        </div>
                        <div>
                          <dt>Vehicle</dt>
                          <dd>{entry.vehicle || 'Not recorded'}</dd>
                        </div>
                      </dl>
                      <p>
                        <span>Next</span>
                        {actor
                          ? shipmentNextAction(entry, actor)
                          : nextShipmentAction(group, recipient, sender)}
                      </p>
                      <Btn variant="outline" onClick={open}>
                        View details
                      </Btn>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {visible.length > 10 && <PaginationBar pagination={pagination} label="Shipment pages" />}
        </>
      )}
    </section>
  );
}

/** One end of a shipment journey: company, place and time. */
export function JourneyStop({
  role,
  company,
  logoPath,
  place,
  timeLabel,
  time,
}: {
  role: string;
  company: string;
  logoPath?: string;
  place: string;
  timeLabel: string;
  time: unknown;
}) {
  return (
    <div className="shipment-journey__stop">
      <span className="shipment-journey__company">
        <CompanyAvatar name={company} logoPath={logoPath} size="sm" />
        <span>
          <small>{role}</small>
          <strong>{company}</strong>
        </span>
      </span>
      <span className="shipment-journey__place">{place}</span>
      <span className="shipment-journey__time">
        {timeLabel} {dateTime(time)}
      </span>
    </div>
  );
}

function catalogueItem(catalogue: OrderRecord[], batchId?: string) {
  return catalogue.find((entry) =>
    entry.batches?.some((batch: string) => batch.toLowerCase() === batchId?.toLowerCase()),
  );
}

function shipmentGroup(entry: OrderRecord, label: string): Exclude<ShipmentFilter, 'all'> {
  const value = label.toLocaleLowerCase();
  if (/waiting for pickup/.test(value)) return 'pickup';
  if (/received|completed|returned|cancelled/.test(value)) return 'completed';
  if (/rejected|discrepancy|review|action|awaiting.*accept|awaiting.*dispatch/.test(value))
    return 'attention';
  if (/awaiting.*receipt|arrived|partially/.test(value)) return 'receipt';
  if (Number(entry.status) === 1 || /transit|dispatched|sent/.test(value)) return 'transit';
  return 'attention';
}

function compareShipments(
  left: OrderRecord,
  right: OrderRecord,
  sort: ShipmentSort,
  catalogue: OrderRecord[],
) {
  if (sort === 'arrival') return Number(left.expectedAt ?? 0) - Number(right.expectedAt ?? 0);
  if (sort === 'item') {
    const leftName = left.itemName ?? catalogueItem(catalogue, left.batchId)?.name ?? '';
    const rightName = right.itemName ?? catalogueItem(catalogue, right.batchId)?.name ?? '';
    return String(leftName).localeCompare(String(rightName));
  }
  return (
    Number(right.dispatchedAt ?? right.createdAt ?? 0) -
    Number(left.dispatchedAt ?? left.createdAt ?? 0)
  );
}

export function dateTime(value: unknown) {
  return Number(value) ? new Date(Number(value) * 1_000).toLocaleString() : 'Not recorded';
}

function nextShipmentAction(
  group: Exclude<ShipmentFilter, 'all'>,
  recipient: string,
  sender: string,
) {
  if (group === 'completed') return 'No action required';
  if (group === 'pickup') return `${sender} prints the label and confirms the handoff at pickup`;
  if (group === 'receipt') return `${recipient} reviews and confirms physical receipt`;
  if (group === 'transit') return 'Track the physical shipment until arrival';
  return 'Open the shipment and review its current requirement';
}
