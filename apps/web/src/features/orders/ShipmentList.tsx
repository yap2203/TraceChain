import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Filter,
  Package,
  Search,
  Truck,
} from 'lucide-react';

import {
  Badge,
  Btn,
  EmptyState,
  Input,
  InventorySummaryCard,
  SelectField,
  StatusTabs,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import { formatOperationalQuantity } from '../workspaces/shared/operational-format';
import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord } from './orders.api';

type ShipmentFilter = 'all' | 'attention' | 'transit' | 'receipt' | 'completed';
type ShipmentSort = 'newest' | 'arrival' | 'item';

export function ShipmentList({
  shipments,
  catalogue,
  locationName,
  statusLabel,
  onOpen,
}: {
  shipments: OrderRecord[];
  catalogue: OrderRecord[];
  locationName: (id?: string) => string;
  statusLabel: (shipment: OrderRecord) => string;
  onOpen: (shipmentId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ShipmentFilter>('all');
  const [sort, setSort] = useState<ShipmentSort>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const counts = useMemo(
    () => ({
      attention: shipments.filter(
        (entry) => shipmentGroup(entry, statusLabel(entry)) === 'attention',
      ).length,
      transit: shipments.filter((entry) => shipmentGroup(entry, statusLabel(entry)) === 'transit')
        .length,
      receipt: shipments.filter((entry) => shipmentGroup(entry, statusLabel(entry)) === 'receipt')
        .length,
      completed: shipments.filter(
        (entry) => shipmentGroup(entry, statusLabel(entry)) === 'completed',
      ).length,
    }),
    [shipments, statusLabel],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return shipments
      .filter((entry) => filter === 'all' || shipmentGroup(entry, statusLabel(entry)) === filter)
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
  }, [catalogue, filter, locationName, search, shipments, sort, statusLabel]);

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
      <div className="shipment-summary-grid" aria-label="Shipment status summary">
        <InventorySummaryCard
          label="Needs action"
          value={counts.attention}
          icon={<Package size={20} />}
          selected={filter === 'attention'}
          onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')}
        />
        <InventorySummaryCard
          label="In transit"
          value={counts.transit}
          icon={<Truck size={20} />}
          selected={filter === 'transit'}
          onClick={() => setFilter(filter === 'transit' ? 'all' : 'transit')}
        />
        <InventorySummaryCard
          label="Awaiting receipt"
          value={counts.receipt}
          icon={<CalendarClock size={20} />}
          selected={filter === 'receipt'}
          onClick={() => setFilter(filter === 'receipt' ? 'all' : 'receipt')}
        />
        <InventorySummaryCard
          label="Completed"
          value={counts.completed}
          icon={<CheckCircle2 size={20} />}
          selected={filter === 'completed'}
          onClick={() => setFilter(filter === 'completed' ? 'all' : 'completed')}
        />
      </div>

      <StatusTabs
        label="Filter shipments by status"
        value={filter}
        onChange={setFilter}
        tabs={[
          { value: 'all', label: 'All', count: shipments.length },
          { value: 'attention', label: 'Needs action', count: counts.attention },
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
        <Btn
          variant="outline"
          icon={<Filter size={16} />}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((value) => !value)}
        >
          Filters
        </Btn>
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
      {filtersOpen && (
        <div className="shipment-filter-panel">
          <SelectField
            label="Shipment status"
            value={filter}
            onChange={(value) => setFilter(value as ShipmentFilter)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'attention', label: 'Needs action' },
              { value: 'transit', label: 'In transit' },
              { value: 'receipt', label: 'Awaiting receipt' },
              { value: 'completed', label: 'Completed' },
            ]}
          />
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
      )}

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
        <div className="shipment-card-list">
          {visible.map((entry) => {
            const item = catalogueItem(catalogue, entry.batchId);
            const state = statusLabel(entry);
            const group = shipmentGroup(entry, state);
            const sender = entry.senderName ?? 'Sending company';
            const recipient = entry.recipientName ?? 'Receiving company';
            const distributor = entry.distributorName ?? entry.delivery?.distributorName;
            return (
              <article className="shipment-card" key={entry.shipmentId}>
                <div className="shipment-card__media">
                  <CatalogueImage
                    path={item?.imagePath}
                    category={item?.category ?? entry.kind}
                    alt={`${item?.name ?? entry.itemName ?? 'Shipment item'} image`}
                  />
                </div>
                <div className="shipment-card__content">
                  <div className="shipment-card__heading">
                    <div>
                      <span>
                        {entry.kind === 'product' ? 'Product shipment' : 'Ingredient shipment'}
                      </span>
                      <h3>{entry.itemName ?? item?.name ?? 'Registered shipment item'}</h3>
                      <p>{item?.batchReference ?? 'Batch reference unavailable'}</p>
                    </div>
                    <Badge
                      label={state}
                      variant={
                        group === 'completed'
                          ? 'verified'
                          : group === 'attention'
                            ? 'pending'
                            : 'transfer-pending'
                      }
                    />
                  </div>

                  <div className="shipment-card__route" aria-label="Shipment company route">
                    <CompanyStep role="Sender" name={sender} logoPath={entry.senderLogoPath} />
                    <ArrowRight
                      aria-hidden="true"
                      className="shipment-card__route-arrow"
                      size={18}
                    />
                    {distributor && (
                      <>
                        <CompanyStep
                          role="Distributor"
                          name={distributor}
                          logoPath={
                            entry.distributorLogoPath ?? entry.delivery?.distributorLogoPath
                          }
                        />
                        <ArrowRight
                          aria-hidden="true"
                          className="shipment-card__route-arrow"
                          size={18}
                        />
                      </>
                    )}
                    <CompanyStep
                      role="Recipient"
                      name={recipient}
                      logoPath={entry.recipientLogoPath}
                    />
                  </div>

                  <dl className="shipment-card__facts">
                    <div>
                      <dt>Quantity</dt>
                      <dd>{formatOperationalQuantity(entry.quantity, entry.unit)}</dd>
                    </div>
                    <div>
                      <dt>Pickup</dt>
                      <dd>{locationName(entry.fromLocation)}</dd>
                    </div>
                    <div>
                      <dt>Destination</dt>
                      <dd>{locationName(entry.toLocation)}</dd>
                    </div>
                    <div>
                      <dt>Vehicle</dt>
                      <dd>{entry.vehicle || 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt>Scheduled pickup</dt>
                      <dd>{dateTime(entry.dispatchedAt ?? entry.pickupAt)}</dd>
                    </div>
                    <div>
                      <dt>Expected arrival</dt>
                      <dd>{dateTime(entry.expectedAt)}</dd>
                    </div>
                  </dl>
                  <div className="shipment-card__next">
                    <div>
                      <span>Next action</span>
                      <strong>{nextShipmentAction(group, recipient)}</strong>
                    </div>
                    <Btn variant="outline" onClick={() => onOpen(entry.shipmentId)}>
                      Review shipment
                    </Btn>
                  </div>
                  <TechnicalDetails
                    fields={[
                      { label: 'Shipment ID', value: entry.shipmentId },
                      { label: 'Batch ID', value: entry.batchId },
                      { label: 'Sender wallet', value: entry.sender },
                      { label: 'Recipient wallet', value: entry.recipient },
                      { label: 'Raw unit', value: entry.unit },
                    ]}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CompanyStep({ role, name, logoPath }: { role: string; name: string; logoPath?: string }) {
  return (
    <span className="shipment-card__company">
      <CompanyAvatar name={name} logoPath={logoPath} size="sm" />
      <span>
        <small>{role}</small>
        <strong>{name}</strong>
      </span>
    </span>
  );
}

function catalogueItem(catalogue: OrderRecord[], batchId?: string) {
  return catalogue.find((entry) =>
    entry.batches?.some((batch: string) => batch.toLowerCase() === batchId?.toLowerCase()),
  );
}

function shipmentGroup(entry: OrderRecord, label: string): Exclude<ShipmentFilter, 'all'> {
  const value = label.toLocaleLowerCase();
  if (/received|completed|returned/.test(value)) return 'completed';
  if (/rejected|discrepancy|review|action/.test(value)) return 'attention';
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

function dateTime(value: unknown) {
  return Number(value) ? new Date(Number(value) * 1_000).toLocaleString() : 'Not recorded';
}

function nextShipmentAction(group: Exclude<ShipmentFilter, 'all'>, recipient: string) {
  if (group === 'completed') return 'No action required';
  if (group === 'receipt') return `${recipient} reviews and confirms physical receipt`;
  if (group === 'transit') return 'Track the physical shipment until arrival';
  return 'Open the shipment and review its current requirement';
}
