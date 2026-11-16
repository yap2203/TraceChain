import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw, Search, Warehouse } from 'lucide-react';
import { getOrders, type OrdersState, type OrderRecord } from './orders.api';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  SelectField,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import { formatOperationalQuantity } from '../workspaces/shared/operational-format';
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const short = (value?: string) =>
  value ? `${value.slice(0, 10)}…${value.slice(-6)}` : 'Unavailable';
export function CustodyInventoryPage({
  role,
  initialKind,
}: {
  role: 'supplier' | 'distributor' | 'manufacturer';
  initialKind?: 'ingredient' | 'product';
}) {
  const [data, setData] = useState<OrdersState>(),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [locationFilter, setLocationFilter] = useState(''),
    [kind] = useState(
      role === 'manufacturer'
        ? 'product'
        : role === 'supplier'
          ? 'ingredient'
          : (initialKind ?? 'ingredient'),
    );
  const [params, setParams] = useSearchParams();
  const load = useCallback(async () => {
    setError('');
    try {
      setData(await getOrders());
    } catch (cause) {
      setError(reportError(cause, 'Custody inventory unavailable.'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data)
    return error ? (
      <Alert type="error" message={error} />
    ) : (
      <LoadingIndicator page label="Reading your authorized custody inventory…" />
    );
  const ingredientRows = (data.logistics?.positions ?? [])
    .filter((entry) =>
      role === 'distributor'
        ? same(entry.distributor, data.actor)
        : same(entry.supplier, data.actor),
    )
    .map((entry) => ({ ...entry, kind: 'ingredient', id: entry.positionId }));
  const productRows =
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
  const rows: OrderRecord[] = [...ingredientRows, ...productRows];
  const selected = rows.find((entry) => same(entry.id, params.get('id') ?? ''));
  const item = (entry: OrderRecord) =>
    data.catalogue.find((product) =>
      product.batches?.some((batch: string) => same(batch, entry.batchId)),
    );
  const title = (entry: OrderRecord) =>
    item(entry)?.name ??
    (entry.kind === 'ingredient' ? 'Registered ingredient' : 'Registered product');
  const openId = params.get('id');
  const locationName = (entry: OrderRecord) =>
    entry.warehouseName ??
    data.locations.find((location) => same(location.location, entry.location))?.label ??
    'Product location ledger';
  const matchingRows = rows.filter(
    (entry) =>
      entry.kind === kind &&
      (!locationFilter || same(entry.location, locationFilter)) &&
      [title(entry), entry.supplierName, entry.distributorName, locationName(entry), entry.batchId]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const locations = Array.from(
    new Map(
      rows
        .filter((entry) => entry.kind === kind && entry.location)
        .map((entry) => [entry.location, locationName(entry)]),
    ),
  );
  return (
    <div className="grid min-w-0 gap-[16px]">
      <SectionTitle
        title="Custody inventory"
        sub={
          role === 'distributor'
            ? 'Stock held at your company’s warehouses.'
            : role === 'manufacturer'
              ? 'Your finished products held at Distributor warehouses.'
              : 'Your ingredients held at Distributor warehouses.'
        }
        action={
          <Btn variant="outline" icon={<RefreshCw size={16} />} onClick={() => void load()}>
            Refresh inventory
          </Btn>
        }
      />
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
        <Card>
          <Btn variant="ghost" onClick={() => setParams({})}>
            Back to custody inventory
          </Btn>
          <h3>{title(selected)}</h3>
          <Badge
            label={selected.kind === 'ingredient' ? 'Ingredient custody' : 'Product custody'}
            variant="active"
          />
          <dl className="mt-[16px] grid grid-cols-1 gap-[16px] sm:grid-cols-2">
            {[
              [
                'Original company',
                selected.supplierName ?? item(selected)?.sellerName ?? 'Unavailable',
              ],
              [
                'Custodian',
                selected.distributorName ??
                  (role === 'distributor' ? 'Your Distributor company' : 'Unavailable'),
              ],
              ['Warehouse', selected.warehouseName ?? 'See location balances'],
              [
                'Received / physical quantity',
                formatOperationalQuantity(selected.quantity, selected.unit),
              ],
              [
                selected.kind === 'product'
                  ? 'Reserved / in transit (outside available stock)'
                  : 'Reserved',
                selected.reserved === undefined
                  ? 'Unavailable'
                  : formatOperationalQuantity(selected.reserved, selected.unit),
              ],
              ['Available', formatOperationalQuantity(selected.available, selected.unit)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="m-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {selected.locations?.map((location: OrderRecord) => (
            <p key={location.location}>
              {data.locations.find((entry) => same(entry.location, location.location))?.label ??
                short(location.location)}
              : {formatOperationalQuantity(location.available, selected.unit)}
            </p>
          ))}
          <h4>Related shipments</h4>
          {(data.logistics?.shipments ?? [])
            .filter(
              (entry) =>
                same(entry.batchId, selected.batchId) &&
                (selected.kind !== 'ingredient' || same(entry.positionId, selected.positionId)),
            )
            .map((entry) => (
              <p key={entry.shipmentId}>
                {entry.senderName ?? short(entry.sender)} →{' '}
                {entry.recipientName ?? short(entry.recipient)} · {entry.quantity} {entry.unit} ·
                Received {entry.received ?? '0'}
              </p>
            ))}
          <TechnicalDetails
            fields={[
              { label: 'Original batch ID', value: selected.batchId },
              {
                label: 'Custody position',
                value: selected.positionId ?? 'Product location ledger',
              },
              { label: 'Custodian wallet', value: selected.distributor ?? data.actor },
              {
                label: 'Warehouse location ID',
                value: selected.location ?? 'See location balances',
              },
            ]}
          />
        </Card>
      ) : (
        <>
          <div className="workspace-inventory-filters">
            <Input
              label="Search custody inventory"
              type="search"
              icon={<Search size={16} />}
              placeholder="Search batch, company or location"
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
          </div>
          <div className="workspace-inventory-grid">
            {matchingRows.map((entry) => (
              <Card key={entry.id}>
                <div className="workspace-inventory-card__heading">
                  <Warehouse size={20} aria-hidden="true" />
                  <div>
                    <h3>{title(entry)}</h3>
                    <p>{item(entry)?.batchReference ?? short(entry.batchId)}</p>
                  </div>
                  <Badge
                    label={item(entry)?.active === false ? 'Inactive' : 'Active'}
                    variant={item(entry)?.active === false ? 'pending' : 'active'}
                  />
                </div>
                <dl className="workspace-inventory-card__facts">
                  <div>
                    <dt>Location</dt>
                    <dd>{locationName(entry)}</dd>
                  </div>
                  <div>
                    <dt>Available</dt>
                    <dd>{formatOperationalQuantity(entry.available, entry.unit)}</dd>
                  </div>
                  <div>
                    <dt>Received / physical</dt>
                    <dd>{formatOperationalQuantity(entry.quantity, entry.unit)}</dd>
                  </div>
                  {entry.reserved !== undefined && (
                    <div>
                      <dt>Reserved</dt>
                      <dd>{formatOperationalQuantity(entry.reserved, entry.unit)}</dd>
                    </div>
                  )}
                </dl>
                <Btn variant="outline" onClick={() => setParams({ id: entry.id })}>
                  View details
                </Btn>
              </Card>
            ))}
          </div>
          {rows.some((entry) => entry.kind === kind) && !matchingRows.length && (
            <EmptyState
              icon={<Search size={32} />}
              title="No matching inventory"
              sub="Try another search or location filter."
            />
          )}
          {!rows.some((entry) => entry.kind === kind) && (
            <EmptyState
              icon={<Warehouse size={32} />}
              title="No custody inventory"
              sub="Only your authorized custody records appear here after physical receipt."
            />
          )}
        </>
      )}
    </div>
  );
}
