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
  TechnicalDetails,
} from '../workspaces/shared/ui';
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const short = (value?: string) =>
  value ? `${value.slice(0, 10)}…${value.slice(-6)}` : 'Unavailable';
export function CustodyInventoryPage({ role }: { role: 'supplier' | 'distributor' }) {
  const [data, setData] = useState<OrdersState>(),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState('ingredient');
  const [params, setParams] = useSearchParams();
  const load = useCallback(async () => {
    setError('');
    try {
      setData(await getOrders());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Custody inventory unavailable.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data)
    return error ? (
      <Alert type="error" message={error} />
    ) : (
      <p role="status">Reading your authorized custody inventory…</p>
    );
  const ingredientRows = (data.logistics?.positions ?? [])
    .filter((entry) =>
      role === 'distributor'
        ? same(entry.distributor, data.actor)
        : same(entry.supplier, data.actor),
    )
    .map((entry) => ({ ...entry, kind: 'ingredient', id: entry.positionId }));
  const productRows =
    role === 'distributor'
      ? (data.logistics?.productStock ?? []).map((entry) => ({
          ...entry,
          kind: 'product',
          id: entry.batchId,
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
  return (
    <div className="grid min-w-0 gap-[16px]">
      <SectionTitle
        title="Custody inventory"
        sub={
          role === 'distributor'
            ? 'Only inventory held by your authenticated Distributor company is shown.'
            : 'Track your own ingredient batches held in Distributor custody. Other Suppliers’ stock is private.'
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
              ['Physical stock', `${selected.quantity} ${selected.unit}`],
              [
                selected.kind === 'product'
                  ? 'Reserved / in transit (outside available stock)'
                  : 'Reserved',
                selected.reserved === undefined
                  ? 'Unavailable'
                  : `${selected.reserved} ${selected.unit}`,
              ],
              ['Available', `${selected.available} ${selected.unit}`],
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
              : {location.available} {selected.unit}
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
          <div className="flex flex-wrap gap-[8px]">
            <Btn
              variant={kind === 'ingredient' ? 'primary' : 'outline'}
              onClick={() => setKind('ingredient')}
            >
              Ingredients
            </Btn>
            {role === 'distributor' && (
              <Btn
                variant={kind === 'product' ? 'primary' : 'outline'}
                onClick={() => setKind('product')}
              >
                Products
              </Btn>
            )}
          </div>
          <Input
            label="Search custody inventory"
            type="search"
            icon={<Search size={16} />}
            placeholder="Search ingredient, product, company or warehouse"
            value={search}
            onChange={setSearch}
          />
          <div className="grid grid-cols-1 gap-[16px] md:grid-cols-2 xl:grid-cols-3">
            {rows
              .filter(
                (entry) =>
                  entry.kind === kind &&
                  [
                    title(entry),
                    entry.supplierName,
                    entry.distributorName,
                    entry.warehouseName,
                    entry.batchId,
                  ]
                    .join(' ')
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((entry) => (
                <Card key={entry.id}>
                  <Warehouse size={20} />
                  <h3>{title(entry)}</h3>
                  <p>{entry.warehouseName ?? 'Product location ledger'}</p>
                  <p>
                    {entry.distributorName ?? 'Your company'} ·{' '}
                    {entry.supplierName ?? item(entry)?.sellerName ?? 'Company unavailable'}
                  </p>
                  <p>
                    Physical: {entry.quantity} {entry.unit} · Available: {entry.available}{' '}
                    {entry.unit}
                  </p>
                  {entry.reserved !== undefined && (
                    <p>
                      Reserved: {entry.reserved} {entry.unit}
                    </p>
                  )}
                  <Btn variant="outline" onClick={() => setParams({ id: entry.id })}>
                    View custody details
                  </Btn>
                </Card>
              ))}
          </div>
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
