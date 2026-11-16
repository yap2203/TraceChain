import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Package, Plus, RefreshCw, Search, Truck } from 'lucide-react';
import { decodeShipmentQr } from '@tracechain/shared';
import {
  getOrders,
  getCustodyOffers,
  type CustodyOffer,
  prepareLogistics,
  prepareOrder,
  type OrderRecord,
  type OrdersState,
} from './orders.api';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import { ProductQrDisplay } from '../product-traceability/ProductQrDisplay';
import { IngredientDeliveryPanel } from './IngredientDeliveryPanel';
import { ProductDeliveryPanel } from './ProductDeliveryPanel';
import { ZxingTransferQrReader, cameraErrorMessage } from '../custody-transfers/qr-reader';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  SelectField,
  StatusTimeline,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import { workspacePath } from '../workspaces/workspace-paths';

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const short = (value?: string) =>
  value ? `${value.slice(0, 10)}…${value.slice(-6)}` : 'Unavailable';
const when = (value: unknown) =>
  Number(value) ? new Date(Number(value) * 1000).toLocaleString() : 'Unavailable';
const localTime = (offset = 0) => {
  const value = new Date(Date.now() + offset);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 19);
};
const stateLabel = (shipment: OrderRecord) =>
  shipment.kind === 'ingredient'
    ? Number(shipment.leg) === 1
      ? ([
          'Unknown',
          Number(shipment.custodyDecision) === 1
            ? 'Accepted — awaiting scanned receipt'
            : 'Awaiting Distributor review',
          'Partially received',
          'At distributor warehouse',
          'Rejected — return pending',
          'Returned to Supplier',
        ][Number(shipment.status)] ?? 'Unknown')
      : (['Unknown', 'Sent to manufacturer', 'Partially received', 'Received by manufacturer'][
          Number(shipment.status)
        ] ?? 'Unknown')
    : (['Unknown', 'Dispatched', 'Received', 'Rejected', 'Cancelled', 'Discrepancy'][
        Number(shipment.status)
      ] ?? 'Unknown');
export function ShipmentsWorkspace({
  role,
  initialView = 'shipments',
  initialShipmentId = '',
  initialOrderId = '',
  initialBatchId = '',
  initialQr = '',
  initialKind,
  section,
}: {
  role: WorkspaceRole;
  initialView?: 'shipments' | 'transfer' | 'locations';
  initialKind?: 'ingredient' | 'product';
  section?: 'intake' | 'deliveries' | 'tracking' | 'profile';
  initialShipmentId?: string;
  initialOrderId?: string;
  initialBatchId?: string;
  initialQr?: string;
}) {
  const [data, setData] = useState<OrdersState>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [custodyOffers, setCustodyOffers] = useState<CustodyOffer[]>([]);
  useEffect(() => {
    if (section === 'intake' || section === 'tracking')
      void getCustodyOffers()
        .then((result) => setCustodyOffers(result.offers))
        .catch((cause) => setError(cause.message));
  }, [section, role]);
  const [view, setView] = useState<string>(initialView),
    [kind, setKind] = useState<'ingredient' | 'product'>(
      role === 'retailer'
        ? 'product'
        : role === 'supplier'
          ? 'ingredient'
          : (initialKind ??
            (role === 'manufacturer' || (role === 'distributor' && initialView === 'transfer')
              ? 'product'
              : 'ingredient')),
    ),
    [search, setSearch] = useState('');
  const [selected, setSelected] = useState(initialShipmentId),
    [selectedDeliveryOrder, setSelectedDeliveryOrder] = useState(initialOrderId),
    [orderId, setOrderId] = useState(initialOrderId),
    [batchId, setBatchId] = useState(initialBatchId);
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [recipient, setRecipient] = useState(''),
    [distributor, setDistributor] = useState(''),
    [quantity, setQuantity] = useState(''),
    [vehicle, setVehicle] = useState('');
  const [actual, setActual] = useState(localTime()),
    [eta, setEta] = useState(localTime(4 * 3600000)),
    [confirmed, setConfirmed] = useState(false);
  const [siteName, setSiteName] = useState(''),
    [existingSite, setExistingSite] = useState(''),
    [checked, setChecked] = useState(''),
    [receiveVehicle, setReceiveVehicle] = useState(''),
    [recordVehicle, setRecordVehicle] = useState('');
  const lock = useRef(false),
    video = useRef<HTMLVideoElement>(null),
    stop = useRef<() => void>(undefined),
    cameraAttempt = useRef(0),
    scanner = useRef(new ZxingTransferQrReader());
  const load = useCallback(async () => setData(await getOrders()), []);
  useEffect(() => {
    void load().catch((cause) => setError(cause.message));
    const timer = setInterval(() => {
      void load().catch((cause) => setError(cause.message));
    }, 15000);
    return () => {
      clearInterval(timer);
      cameraAttempt.current++;
      stop.current?.();
    };
  }, [load]);
  const warehouse = data?.logistics;
  useEffect(() => {
    if (data?.orders.some((entry) => same(entry.orderId, initialOrderId) && entry.productDelivery))
      setKind('product');
  }, [data?.actor, initialOrderId]);
  const shipments = warehouse?.shipments ?? [];
  const shipment = shipments.find((entry) => same(entry.shipmentId, selected));
  const productDeliveryOrder = data?.orders.find(
    (entry) => same(entry.orderId, selectedDeliveryOrder) && entry.productDelivery,
  );
  const linkedCustodyOffer = custodyOffers.find(
    (offer) =>
      same(offer.shipmentId, shipment?.shipmentId) &&
      ['DISPATCHED', 'RECEIVED'].includes(offer.status),
  );
  const returning =
    shipment?.kind === 'ingredient' &&
    Number(shipment.leg) === 1 &&
    Number(shipment.status) === 4 &&
    same(shipment.sender, data?.actor);
  const intake = shipment?.kind === 'ingredient' && Number(shipment.leg) === 1;
  const proofPending =
    !!shipment?.delivery?.identityChallenge &&
    !/^0x0+$/.test(shipment.delivery.identityChallenge) &&
    (!shipment.delivery.identityCredentialHash ||
      /^0x0+$/.test(shipment.delivery.identityCredentialHash) ||
      Number(shipment.delivery.identityValidUntil) <= Date.now() / 1000);
  const ownLocations = data?.locations.filter((entry) => same(entry.company, data.actor)) ?? [];
  const label = (id?: string) =>
    warehouse?.warehouses.find((entry) => same(entry.location, id))?.name ??
    data?.locations.find((entry) => same(entry.location, id))?.label ??
    short(id);
  const item = (id?: string) =>
    data?.catalogue.find((entry) => entry.batches?.some((batch: string) => same(batch, id)));
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(reportError(cause, 'Action failed.'));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const sign = async (prepared: Awaited<ReturnType<typeof prepareOrder>>) => {
    await submitProductionTransaction(prepared.transaction, data!.actor);
    setNotice('Transaction confirmed.');
    try {
      await load();
    } catch {
      throw new Error('Confirmed, but refresh failed. Refresh this page; do not submit again.');
    }
  };
  const submit = async (values: Record<string, unknown>) => {
    const prepared = await prepareLogistics({ operationId: crypto.randomUUID(), ...values });
    await sign(prepared);
    return prepared;
  };
  const verifyLabel = (value: string) => {
    try {
      const decoded = decodeShipmentQr(value, {
        shipmentId: shipment?.shipmentId,
        kind: shipment?.kind,
        chainId: data!.chainId!,
        ordersAddress: data!.ordersAddress!,
        publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL,
      });
      if (!shipments.some((entry) => same(entry.shipmentId, decoded.shipmentId)))
        throw new Error('This shipment is unavailable to your company.');
      setSelected(decoded.shipmentId);
      setChecked(value);
      setError('');
      stop.current?.();
    } catch (cause) {
      setChecked('');
      setError(reportError(cause, 'Invalid shipment label.'));
    }
  };
  useEffect(() => {
    setConfirmed(false);
    setChecked('');
    setActual(localTime());
    setQuantity('');
  }, [selected]);
  useEffect(() => {
    if (
      data &&
      initialQr &&
      !data.orders.some((entry) => same(entry.orderId, initialOrderId) && entry.productDelivery)
    )
      verifyLabel(initialQr);
  }, [data?.actor, initialQr, selected]);
  const ready = (data?.orders ?? []).filter(
    (entry) =>
      entry.custodyOrder &&
      entry.custodyOrder.arranged &&
      same(entry.custodyOrder.distributor, data?.actor) &&
      Number(entry.decision?.status) === 1 &&
      Number(entry.status) === 1 &&
      Number(entry.expiresAt) > Date.now() / 1000 &&
      BigInt(entry.requested) > BigInt(entry.custodyOrder.dispatched),
  );
  const order = ready.find((entry) => entry.orderId === orderId);
  const trackedOrder = data?.orders.find(
    (entry) => same(entry.orderId, initialOrderId) && entry.custodyOrder,
  );
  const visibleShipments = shipments.filter(
    (entry) =>
      (entry.kind === kind || section === 'intake') &&
      (section !== 'intake' ||
        (entry.kind === 'ingredient'
          ? Number(entry.leg) === 1
          : same(entry.recipient, data?.actor))) &&
      (section !== 'deliveries' ||
        role !== 'distributor' ||
        (entry.kind === 'ingredient'
          ? Number(entry.leg) !== 1
          : !same(entry.recipient, data?.actor))) &&
      (!trackedOrder ||
        same(entry.orderId, trackedOrder.orderId) ||
        (Number(entry.leg) === 1 && same(entry.batchId, trackedOrder.custodyOrder.batchId))) &&
      `${entry.itemName ?? ''} ${entry.shipmentId} ${entry.senderName ?? ''} ${entry.recipientName ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const stockItems = (data?.catalogue ?? [])
    .flatMap((entry) =>
      entry.batches.map((id: string) => ({
        ...entry,
        batchId: id,
        batch: entry.batchDetails?.find((row: OrderRecord) => same(row.batchId, id)),
      })),
    )
    .filter((entry) => Number(entry.kind) === 1 && same(entry.seller, data?.actor));
  const stock =
    kind === 'ingredient'
      ? stockItems.find((entry) => entry.batchId === batchId)
      : warehouse?.productStock.find((entry) => entry.batchId === batchId);
  const distributorWarehouse = (warehouse?.warehouses ?? []).find((entry) =>
    same(entry.distributor, distributor),
  );
  const source =
    role === 'distributor' && kind === 'ingredient' ? (order?.custodyOrder.location ?? '') : from;
  const destination =
    role === 'distributor' && kind === 'ingredient'
      ? (order?.custodyOrder.receivingLocation ?? '')
      : role === 'supplier' && kind === 'ingredient'
        ? (distributorWarehouse?.location ?? '')
        : to;
  const available =
    role === 'distributor' && kind === 'ingredient'
      ? BigInt(order?.requested ?? '0') - BigInt(order?.custodyOrder.dispatched ?? '0')
      : BigInt(
          kind === 'ingredient'
            ? (stock?.batch?.supplierAvailable ?? '0')
            : stock?.tracked
              ? (stock.locations?.find((entry: OrderRecord) => same(entry.location, from))
                  ?.available ?? '0')
              : (stock?.available ?? '0'),
        );
  const unit =
    kind === 'ingredient' && role === 'distributor' ? order?.custodyOrder.unit : stock?.unit;
  const at = Math.floor(Date.parse(actual) / 1000),
    expected = Math.floor(Date.parse(eta) / 1000);
  const vehicleValid =
    role === 'supplier' && kind === 'ingredient'
      ? !vehicle.trim() || (/^[A-Z0-9 -]{2,32}$/.test(vehicle.trim()) && /[A-Z0-9]/.test(vehicle))
      : /^[A-Z0-9 -]{2,32}$/.test(vehicle.trim()) && /[A-Z0-9]/.test(vehicle);
  const valid =
    !!source &&
    !!destination &&
    /^[1-9]\d{0,38}$/.test(quantity) &&
    BigInt(quantity || '0') <= available &&
    vehicleValid &&
    Number.isFinite(at) &&
    at <= Date.now() / 1000 &&
    Number.isFinite(expected) &&
    expected > at &&
    confirmed &&
    (kind === 'ingredient' || !!recipient);
  const compose = (type: 'ingredient' | 'product', record?: OrderRecord) => {
    setKind(type);
    setView('transfer');
    setSelected('');
    setBatchId(record?.batchId ?? '');
    setOrderId(record?.orderId && !/^0x0+$/.test(record.orderId) ? record.orderId : '');
    setFrom(record?.toLocation ?? '');
    setDistributor('');
    setRecipient('');
    setVehicle('');
    setQuantity('');
    setConfirmed(false);
    setActual(localTime());
    setEta(localTime(4 * 3600000));
    setReceiveVehicle('');
    setRecordVehicle('');
  };
  if (!data)
    return (
      <>
        {error ? (
          <Alert type="error" message={error} />
        ) : (
          <LoadingIndicator page label="Reading shipment and custody records…" />
        )}
      </>
    );
  if (!data.warehouseSupported && section !== 'profile')
    return (
      <Alert
        type="warning"
        message="Deploy the warehouse-first registry suite and update the configured addresses to use Shipments and Distributor custody ordering. Existing records are preserved."
      />
    );
  return (
    <div className="grid min-w-0 gap-[16px]">
      <SectionTitle
        title={
          view === 'locations'
            ? 'Company profile & locations'
            : section === 'intake'
              ? 'Custody intake'
              : view === 'transfer'
                ? 'Create road transfer'
                : role === 'supplier'
                  ? 'Stock sent & delivery tracking'
                  : role === 'distributor'
                    ? 'Custody intake & deliveries'
                    : 'My shipments'
        }
        sub={
          role === 'supplier'
            ? 'Track stock sent to custody and deliveries arranged from approved orders.'
            : role === 'distributor'
              ? 'Review custody offers, scan incoming stock and dispatch assigned deliveries.'
              : 'Track incoming goods. Scan the shipment QR when they arrive.'
        }
        action={
          <Btn
            variant="outline"
            icon={<RefreshCw size={16} />}
            disabled={busy}
            onClick={() => void run(load)}
          >
            Refresh
          </Btn>
        }
      />
      {!section && (
        <nav className="workspace-task-toolbar" aria-label="Shipment actions">
          <Btn
            variant={view === 'shipments' ? 'primary' : 'outline'}
            aria-pressed={view === 'shipments'}
            onClick={() => {
              setView('shipments');
              setSelected('');
            }}
          >
            Shipments
          </Btn>
          {(role === 'supplier' || role === 'manufacturer') && (
            <Btn
              icon={<Plus size={16} />}
              onClick={() => compose(role === 'supplier' ? 'ingredient' : 'product')}
            >
              {role === 'supplier' ? 'Send stock to custody' : 'Transfer products'}
            </Btn>
          )}
          <Btn
            variant="outline"
            onClick={() => {
              setView('locations');
              setSelected('');
            }}
          >
            Locations
          </Btn>
        </nav>
      )}
      {error && <Alert type="error" message={error} />}{' '}
      {notice && <Alert type="success" message={notice} />}
      {!data.shipmentReviewSupported && (
        <Alert
          type="warning"
          message="Custody accept/reject and Supplier-arranged delivery require the updated full contract suite. Existing records remain visible."
        />
      )}
      {trackedOrder && (
        <Card>
          <h3>Supplier → Distributor → Manufacturer</h3>
          <p>
            {trackedOrder.sellerName ?? short(trackedOrder.seller)} ·{' '}
            {trackedOrder.custodyOrder.warehouseName} ·{' '}
            {trackedOrder.buyerName ?? short(trackedOrder.buyer)}
          </p>
          <ol
            className="grid grid-cols-1 gap-[12px] pl-[20px] sm:grid-cols-2 lg:grid-cols-4"
            aria-label="Order delivery progress"
          >
            <li>
              Warehouse stock received
              <br />
              Reserved at placement: {trackedOrder.requested} {trackedOrder.custodyOrder.unit}
            </li>
            <li>
              Supplier decision
              <br />
              {Number(trackedOrder.decision?.status) === 1
                ? 'Approved'
                : Number(trackedOrder.decision?.status) === 2
                  ? 'Rejected; remaining reservation released'
                  : 'Awaiting approval'}
            </li>
            <li>
              Distributor dispatch
              <br />
              {trackedOrder.custodyOrder.dispatched} / {trackedOrder.requested}{' '}
              {trackedOrder.custodyOrder.unit}
            </li>
            <li>
              Manufacturer receipt
              <br />
              {trackedOrder.custodyOrder.received} / {trackedOrder.requested}{' '}
              {trackedOrder.custodyOrder.unit}
            </li>
          </ol>
        </Card>
      )}
      {view === 'locations' && (
        <Card>
          <h3>
            {role === 'distributor'
              ? 'Register a warehouse'
              : 'Register a dispatch / receiving location'}
          </h3>
          <Input
            label="Location name"
            value={siteName}
            onChange={setSiteName}
            required
            maxLength={160}
          />
          {role === 'distributor' && (
            <SelectField
              label="Use an existing registered location (optional)"
              value={existingSite}
              onChange={setExistingSite}
              options={[
                { value: '', label: 'Create a new location' },
                ...ownLocations
                  .filter(
                    (entry) => !warehouse?.warehouses.some((w) => same(w.location, entry.location)),
                  )
                  .map((entry) => ({
                    value: entry.location,
                    label: entry.label ?? short(entry.location),
                  })),
              ]}
            />
          )}
          <p>
            {role === 'distributor'
              ? 'A new warehouse uses two explicit MetaMask confirmations: register its location, then publish its warehouse name. If interrupted, select the existing location to finish.'
              : 'This location belongs to your connected company wallet.'}
          </p>
          <Btn
            disabled={busy || !siteName.trim()}
            onClick={() =>
              void run(async () => {
                let location = existingSite;
                if (!location) {
                  const prepared = await prepareOrder({
                    action: 'location',
                    operationId: crypto.randomUUID(),
                    label: siteName.trim(),
                  });
                  await sign(prepared);
                  location = prepared.resultId;
                  setExistingSite(location);
                }
                if (role === 'distributor')
                  await submit({ action: 'warehouse', location, name: siteName.trim() });
                setNotice('Location registered successfully.');
              })
            }
          >
            Register location
          </Btn>
          <ul>
            {ownLocations.map((entry) => (
              <li key={entry.location}>{entry.label ?? short(entry.location)}</li>
            ))}
          </ul>
        </Card>
      )}
      {view === 'shipments' && !selected && productDeliveryOrder && (
        <div className="grid min-w-0 gap-[12px]">
          <Btn variant="outline" onClick={() => setSelectedDeliveryOrder('')}>
            Back to shipments
          </Btn>
          <ProductDeliveryPanel
            data={data}
            order={productDeliveryOrder}
            item={data.catalogue.find((item) => same(item.itemId, productDeliveryOrder.itemId))}
            onChanged={load}
            initialQr={same(productDeliveryOrder.orderId, initialOrderId) ? initialQr : ''}
          />
        </div>
      )}
      {view === 'shipments' && !selected && !productDeliveryOrder && (
        <>
          {section !== 'intake' &&
            kind === 'product' &&
            (data.orders ?? [])
              .filter(
                (entry) =>
                  entry.productDelivery && same(entry.productDelivery.distributor, data.actor),
              )
              .map((entry) => (
                <Card key={entry.orderId}>
                  <div className="workspace-record-card">
                    <div className="workspace-record-heading">
                      <div className="workspace-record-heading__identity">
                        <span className="workspace-record-heading__eyebrow">Product shipment</span>
                        <h3>
                          {data.catalogue.find((item) => same(item.itemId, entry.itemId))?.name ??
                            'Registered product'}
                        </h3>
                        <p>
                          {data.catalogue.find((item) => same(item.itemId, entry.itemId))
                            ?.batchReference ?? short(entry.requestedBatch)}
                        </p>
                      </div>
                      <Badge
                        label={
                          [
                            'Awaiting approval',
                            'Delivery selection',
                            'Awaiting Distributor review',
                            'Ready for dispatch',
                            'In transit',
                            'Received',
                            'Closed',
                          ][Number(entry.productDelivery.stage)] ?? 'In progress'
                        }
                        variant={Number(entry.productDelivery.stage) === 5 ? 'verified' : 'pending'}
                      />
                    </div>
                    <dl className="workspace-record-facts">
                      <div>
                        <dt>Quantity</dt>
                        <dd>
                          {entry.requested}{' '}
                          {data.catalogue.find((item) => same(item.itemId, entry.itemId))?.unit ??
                            ''}
                        </dd>
                      </div>
                      <div>
                        <dt>Sender</dt>
                        <dd>{entry.sellerName ?? short(entry.seller)}</dd>
                      </div>
                      <div>
                        <dt>Recipient</dt>
                        <dd>{entry.buyerName ?? short(entry.buyer)}</dd>
                      </div>
                      <div>
                        <dt>Destination</dt>
                        <dd>
                          {label(
                            entry.deliveryReceivingLocation ?? entry.details?.receivingLocation,
                          )}
                        </dd>
                      </div>
                    </dl>
                    <Btn variant="outline" onClick={() => setSelectedDeliveryOrder(entry.orderId)}>
                      View shipment
                    </Btn>
                  </div>
                </Card>
              ))}
          {section !== 'intake' &&
            kind === 'ingredient' &&
            (data.orders ?? [])
              .filter(
                (entry) =>
                  !entry.custodyOrder &&
                  entry.delivery &&
                  same(entry.delivery.distributor, data.actor) &&
                  Number(entry.delivery.stage) >= 2 &&
                  Number(entry.delivery.stage) <= 5,
              )
              .map((entry) => (
                <Card key={entry.orderId}>
                  <h3>Direct delivery — collect from Supplier</h3>
                  <IngredientDeliveryPanel
                    data={data}
                    order={entry}
                    item={data.catalogue.find((item) => same(item.itemId, entry.itemId))}
                    onChanged={load}
                  />
                </Card>
              ))}
          {!section && (
            <div className="flex flex-wrap gap-[8px]" role="tablist" aria-label="Shipment type">
              {role !== 'retailer' && (
                <>
                  <Btn
                    onClick={() => setKind('ingredient')}
                    variant={kind === 'ingredient' ? 'primary' : 'outline'}
                  >
                    Ingredients
                  </Btn>
                </>
              )}
              {role !== 'supplier' && (
                <Btn
                  onClick={() => setKind('product')}
                  variant={kind === 'product' ? 'primary' : 'outline'}
                >
                  Products
                </Btn>
              )}
            </div>
          )}
          <Input
            label="Search shipments or stock"
            icon={<Search size={16} />}
            type="search"
            value={search}
            onChange={setSearch}
            placeholder="Search ingredient/product name, company or shipment reference"
          />
          <>
            {section !== 'intake' &&
              role === 'distributor' &&
              kind === 'ingredient' &&
              ready.length > 0 && (
                <Card>
                  <h3>Supplier-arranged ingredient deliveries</h3>
                  <p>
                    These quantities are already reserved in your warehouse. Open an order to
                    arrange its road shipment.
                  </p>
                  {ready.map((entry) => (
                    <div
                      key={entry.orderId}
                      className="flex flex-wrap items-center justify-between gap-[8px] border-b border-[var(--c-border)] py-[12px]"
                    >
                      <span>
                        {item(entry.custodyOrder.batchId)?.name ?? 'Ingredient'} →{' '}
                        {entry.buyerName ?? short(entry.buyer)} ·{' '}
                        {BigInt(entry.requested) - BigInt(entry.custodyOrder.dispatched)}{' '}
                        {entry.custodyOrder.unit}
                      </span>
                      <Btn
                        onClick={() => {
                          compose('ingredient');
                          setOrderId(entry.orderId);
                        }}
                      >
                        Record physical dispatch
                      </Btn>
                    </div>
                  ))}
                </Card>
              )}
            {visibleShipments.length > 0 && (
              <div
                className="workspace-table-scroll"
                role="region"
                aria-label="Shipment records"
                tabIndex={0}
              >
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      {[
                        'Shipment / item',
                        'Batch',
                        'Sender',
                        'Destination',
                        'Expected / received',
                        'ETA / status',
                        '',
                      ].map((header) => (
                        <th key={header} className="p-[12px]">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleShipments.map((entry) => (
                      <tr key={entry.shipmentId} className="border-b border-[var(--c-border)]">
                        <td className="p-[12px]">
                          SHP-{entry.shipmentId.slice(2, 10).toUpperCase()}
                          <br />
                          <strong>
                            {entry.itemName ?? item(entry.batchId)?.name ?? 'Registered batch'}
                          </strong>
                        </td>
                        <td className="p-[12px]">
                          {item(entry.batchId)?.batchReference ?? short(entry.batchId)}
                        </td>
                        <td className="p-[12px]">{entry.senderName ?? short(entry.sender)}</td>
                        <td className="p-[12px]">
                          {label(entry.toLocation)}
                          <br />
                          <small>{entry.recipientName ?? short(entry.recipient)}</small>
                        </td>
                        <td className="p-[12px]">
                          {entry.quantity} {entry.unit}
                          <br />
                          <small>
                            Received {entry.received ?? '0'} {entry.unit}
                          </small>
                        </td>
                        <td className="p-[12px]">
                          {when(entry.expectedAt)}
                          <br />
                          <Badge
                            label={stateLabel(entry)}
                            variant={Number(entry.status) >= 3 ? 'verified' : 'pending'}
                          />
                        </td>
                        <td className="p-[12px]">
                          <Btn
                            variant="outline"
                            onClick={() => {
                              setSelected(entry.shipmentId);
                              setView('shipments');
                            }}
                          >
                            View shipment
                          </Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!visibleShipments.length && (
              <EmptyState
                icon={<Package size={36} />}
                title={
                  shipments.some((entry) => entry.kind === kind)
                    ? 'No matching shipments'
                    : 'No shipments yet'
                }
                sub={
                  shipments.some((entry) => entry.kind === kind)
                    ? 'Change the search to see other shipments.'
                    : 'Confirmed transfers for your company will appear here.'
                }
              />
            )}
          </>
        </>
      )}
      {view === 'transfer' && (
        <Card>
          <h3>1. Select stock or an approved order</h3>
          {role === 'distributor' && kind === 'product' && (
            <SelectField
              label="Transfer type"
              value={kind}
              onChange={(value) => {
                setKind(value as 'ingredient' | 'product');
                setBatchId('');
              }}
              options={[{ value: 'product', label: 'Finished products → Retailer' }]}
            />
          )}
          {role === 'distributor' && kind === 'ingredient' ? (
            <p>
              {order
                ? `Supplier-arranged order ${short(order.orderId)} for ${order.buyerName ?? short(order.buyer)}`
                : 'Open a Supplier-arranged delivery from your Shipments queue. You cannot create an ingredient delivery independently.'}
            </p>
          ) : (
            <SelectField
              label={kind === 'ingredient' ? 'Ingredient batch' : 'Product batch'}
              value={batchId}
              onChange={setBatchId}
              required
              options={[
                { value: '', label: 'Select available stock' },
                ...(kind === 'ingredient' ? stockItems : (warehouse?.productStock ?? [])).map(
                  (entry) => ({
                    value: entry.batchId,
                    label:
                      (entry.name ?? item(entry.batchId)?.name ?? short(entry.batchId)) +
                      ' · ' +
                      (kind === 'ingredient' ? entry.batch?.supplierAvailable : entry.available) +
                      ' ' +
                      entry.unit,
                  }),
                ),
              ]}
            />
          )}
          <p>
            Available allocation: {available.toString()} {unit ?? ''}
          </p>
          <h3>2. Confirm the route</h3>
          {role === 'distributor' && kind === 'ingredient' ? (
            <p>
              {label(source)} → {label(destination)} · Recipient:{' '}
              {order?.buyerName ?? 'Select an order'}
            </p>
          ) : (
            <>
              <SelectField
                label="Dispatch location"
                value={from}
                onChange={setFrom}
                options={[
                  { value: '', label: 'Select your registered dispatch location' },
                  ...ownLocations
                    .filter(
                      (entry) =>
                        kind === 'ingredient' ||
                        (!stock?.tracked && same(entry.location, stock?.productionLocation)) ||
                        stock?.locations?.some(
                          (location: OrderRecord) =>
                            same(location.location, entry.location) &&
                            BigInt(location.available) > 0n,
                        ),
                    )
                    .map((entry) => ({
                      value: entry.location,
                      label: entry.label ?? short(entry.location),
                    })),
                ]}
              />
              {role === 'supplier' && kind === 'ingredient' && (
                <SelectField
                  label="On-chain Distributor"
                  value={distributor}
                  onChange={(value) => {
                    setDistributor(value);
                  }}
                  required
                  options={[
                    { value: '', label: 'Select an authorized Distributor' },
                    ...(data.distributors ?? []).map((company) => ({
                      value: company.wallet,
                      label: company.companyName,
                    })),
                  ]}
                />
              )}
              {kind === 'product' && (
                <SelectField
                  label="Receiving company"
                  value={recipient}
                  onChange={(value) => {
                    setRecipient(value);
                    setTo('');
                  }}
                  options={[
                    { value: '', label: 'Select an authorized company' },
                    ...(data.companies ?? [])
                      .filter(
                        (company) =>
                          company.role === (role === 'manufacturer' ? 'DISTRIBUTOR' : 'RETAILER'),
                      )
                      .map((company) => ({ value: company.wallet, label: company.companyName })),
                  ]}
                />
              )}
              {!(role === 'supplier' && kind === 'ingredient') && (
                <SelectField
                  label="Receiving location"
                  value={to}
                  onChange={setTo}
                  options={[
                    { value: '', label: 'Select the registered receiving location' },
                    ...(kind === 'ingredient'
                      ? (warehouse?.warehouses ?? [])
                      : data.locations.filter((entry) => same(entry.company, recipient))
                    ).map((entry) => ({
                      value: entry.location,
                      label: entry.name ?? entry.label ?? label(entry.location),
                    })),
                  ]}
                />
              )}
              <p>
                {label(source)} →{' '}
                {role === 'supplier' && kind === 'ingredient'
                  ? distributorWarehouse
                    ? `${data.companies?.find((c) => same(c.wallet, distributor))?.companyName ?? short(distributor)} (${distributorWarehouse.name})`
                    : distributor
                      ? 'No registered warehouse found for this Distributor'
                      : 'Select an authorized Distributor'
                  : label(destination)}
              </p>
              {role === 'supplier' && kind === 'ingredient' && !distributor && (
                <Alert
                  type="info"
                  message="Select the authorized Distributor who will receive custody of this ingredient at their warehouse."
                />
              )}
              {role === 'supplier' &&
                kind === 'ingredient' &&
                distributor &&
                !distributorWarehouse && (
                  <Alert
                    type="error"
                    message="The selected Distributor has not registered a warehouse yet. Please choose a Distributor with a registered warehouse."
                  />
                )}
            </>
          )}
          <Btn variant="ghost" onClick={() => setView('locations')}>
            Set up a missing location
          </Btn>
          <h3>3. Record actual road dispatch</h3>
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <Input
              label={`Actual quantity dispatched (${unit ?? 'registered unit'})`}
              type="number"
              min="1"
              max={available.toString()}
              step="1"
              value={quantity}
              onChange={setQuantity}
              required
            />
            {!(role === 'supplier' && kind === 'ingredient') && (
              <Input
                label="Vehicle registration number"
                value={vehicle}
                onChange={(value) => setVehicle(value.toUpperCase())}
                required
                maxLength={32}
                placeholder="e.g. VAB 1234"
              />
            )}
            <Input
              label="Actual dispatch date and time"
              type="datetime-local"
              step="1"
              value={actual}
              onChange={setActual}
              required
            />
            <Input
              label="Expected arrival"
              type="datetime-local"
              step="1"
              value={eta}
              onChange={setEta}
              required
            />
          </div>
          <p>
            Confirmed by: {data.actor}. Blockchain recording time is stored separately from your
            actual dispatch time.
          </p>
          <label className="my-[12px] flex items-start gap-[8px]">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {role === 'supplier' && kind === 'ingredient'
              ? 'I confirm these goods are physically leaving the selected location for Distributor custody.'
              : 'I confirm these goods are physically leaving the selected location in the recorded vehicle.'}
          </label>
          {order && (
            <a
              href={
                workspacePath(role, role === 'distributor' ? 'sent-requests' : 'requests') +
                '?context=delivery&referenceId=' +
                encodeURIComponent(order.orderId)
              }
            >
              Manage Supplier credential request in Information requests
            </a>
          )}
          <Btn
            icon={<Truck size={16} />}
            disabled={busy || !valid}
            onClick={() =>
              void run(async () => {
                const result = await submit({
                  action:
                    kind === 'product'
                      ? 'product-dispatch'
                      : role === 'supplier'
                        ? 'stock-dispatch'
                        : 'order-dispatch',
                  ...(kind === 'product'
                    ? { batchId, recipient }
                    : role === 'supplier'
                      ? { batchId }
                      : { orderId }),
                  quantity,
                  fromLocation: source,
                  toLocation: destination,
                  vehicle: vehicle.trim(),
                  occurredAt: at,
                  expectedAt: expected,
                });
                setView('shipments');
                setSelected(result.resultId);
              })
            }
          >
            Confirm dispatch with MetaMask
          </Btn>
        </Card>
      )}
      {shipment && view === 'shipments' && (
        <Card>
          <Btn
            variant="ghost"
            onClick={() => {
              setSelected('');
              setChecked('');
            }}
          >
            Back to shipments
          </Btn>
          <h3>
            {shipment.itemName ?? item(shipment.batchId)?.name ?? 'Registered batch'} · SHP-
            {shipment.shipmentId.slice(2, 10).toUpperCase()}
          </h3>
          <p>
            {shipment.kind === 'ingredient' && Number(shipment.leg) === 1
              ? 'Supplier → Distributor warehouse'
              : shipment.kind === 'ingredient'
                ? 'Distributor warehouse → Manufacturer'
                : 'Finished-product custody transfer'}
          </p>
          <StatusTimeline
            label="Shipment status"
            steps={[
              {
                actor: shipment.senderName ?? short(shipment.sender),
                detail: when(shipment.dispatchedAt),
                label: 'Dispatched',
                state: 'complete',
              },
              {
                actor: shipment.recipientName ?? short(shipment.recipient),
                detail: `Received ${shipment.received ?? '0'} / ${shipment.quantity} ${shipment.unit}`,
                label: stateLabel(shipment),
                state: Number(shipment.status) >= 2 ? 'complete' : 'current',
              },
            ]}
          />
          <dl className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            {[
              [
                'Order',
                shipment.orderId && !/^0x0+$/.test(shipment.orderId)
                  ? 'ORD-' + shipment.orderId.slice(2, 10).toUpperCase()
                  : 'Warehouse stock placement',
              ],
              [
                'Ingredient / product batch',
                item(shipment.batchId)?.batchReference ?? short(shipment.batchId),
              ],
              ['From', label(shipment.fromLocation)],
              ['To', label(shipment.toLocation)],
              ['Vehicle', shipment.vehicle || 'Pending carrier / distributor record'],
              ['Actual dispatch', when(shipment.dispatchedAt)],
              ['Expected arrival', when(shipment.expectedAt)],
              ['Blockchain recording time', when(shipment.recordedAt)],
              [
                'Confirmed by',
                shipment.confirmedBy && !/^0x0+$/.test(shipment.confirmedBy)
                  ? shipment.confirmedBy
                  : shipment.sender,
              ],
            ].map(([name, value]) => (
              <div key={String(name)}>
                <dt>{name}</dt>
                <dd className="m-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {shipment.qrPayload && same(shipment.sender, data.actor) && (
            <ProductQrDisplay
              batchId={shipment.shipmentId}
              batchReference={'SHP-' + shipment.shipmentId.slice(2, 10).toUpperCase()}
              productName={shipment.itemName ?? 'Registered shipment'}
              encodedPayload={shipment.qrPayload}
              labelTitle="Shipment receipt QR"
              instruction="Attach to this shipment. The intended recipient scans this label before confirming physical receipt."
            />
          )}
          {intake && data.shipmentReviewSupported && Number(shipment.status) < 3 && (
            <a
              href={
                workspacePath(role, role === 'distributor' ? 'sent-requests' : 'requests') +
                (linkedCustodyOffer
                  ? '?context=custody&referenceId='
                  : '?context=delivery&referenceId=') +
                encodeURIComponent(linkedCustodyOffer?.offerId ?? shipment.shipmentId)
              }
            >
              Manage Supplier credential request in Information requests
            </a>
          )}
          {intake &&
            !linkedCustodyOffer &&
            same(shipment.recipient, data.actor) &&
            Number(shipment.status) === 1 &&
            Number(shipment.custodyDecision ?? 0) === 0 && (
              <section className="grid gap-[12px] rounded-lg border border-[var(--c-border)] p-[16px]">
                <h4>Review Supplier custody delivery</h4>
                <p>
                  Accept or reject this custody offer. Acceptance does not credit inventory: scan
                  the package QR and confirm physical receipt separately. You may request Supplier
                  company evidence in Information requests.
                </p>
                {proofPending && (
                  <Alert
                    type="info"
                    message="Verify the requested Supplier company proof before accepting custody."
                  />
                )}
                <div className="flex flex-wrap gap-[8px]">
                  <Btn
                    disabled={busy || !data.shipmentReviewSupported || proofPending}
                    onClick={() =>
                      void run(async () => {
                        await submit({
                          action: 'warehouse-decision',
                          shipmentId: shipment.shipmentId,
                          decision: 1,
                        });
                      })
                    }
                  >
                    Accept custody delivery
                  </Btn>
                  <Btn
                    variant="outline"
                    disabled={busy || !data.shipmentReviewSupported}
                    onClick={() =>
                      void run(async () => {
                        await submit({
                          action: 'warehouse-decision',
                          shipmentId: shipment.shipmentId,
                          decision: 2,
                        });
                      })
                    }
                  >
                    Reject custody delivery
                  </Btn>
                </div>
              </section>
            )}
          {Number(shipment.status) === 4 && intake && (
            <Alert
              type="warning"
              message="Custody delivery rejected. No warehouse stock was credited. Supplier stock remains unavailable until the Supplier scans and confirms physical return."
            />
          )}
          {(returning ||
            (same(shipment.recipient, data.actor) &&
              ((shipment.kind === 'ingredient' &&
                [1, 2].includes(Number(shipment.status)) &&
                (!intake ||
                  (data.shipmentReviewSupported &&
                    (Number(shipment.custodyDecision) === 1 || !!linkedCustodyOffer)))) ||
                (shipment.kind === 'product' && Number(shipment.status) === 1)))) && (
            <section className="grid gap-[12px]">
              {linkedCustodyOffer && intake && Number(shipment.custodyDecision ?? 0) === 0 && (
                <Alert
                  type="info"
                  message="The custody offer was accepted before pickup. Receipt requires two MetaMask confirmations: record that acceptance on-chain, then confirm the scanned physical receipt."
                />
              )}
              <h4>
                {returning
                  ? 'Scan and confirm returned goods'
                  : 'Scan and confirm physical receipt'}
              </h4>
              <video ref={video} playsInline muted className="max-h-[220px] w-full" />
              <Btn
                icon={<Camera size={16} />}
                onClick={() => {
                  stop.current?.();
                  const attempt = ++cameraAttempt.current;
                  void scanner.current
                    .startCamera(video.current!, verifyLabel, (cause) =>
                      setError(cameraErrorMessage(cause)),
                    )
                    .then((cleanup) => {
                      if (attempt !== cameraAttempt.current) cleanup();
                      else stop.current = cleanup;
                    })
                    .catch((cause) => setError(cameraErrorMessage(cause)));
                }}
              >
                Scan package QR
              </Btn>
              <Btn
                variant="outline"
                onClick={() => {
                  cameraAttempt.current++;
                  stop.current?.();
                }}
              >
                Stop camera
              </Btn>
              <label>
                Upload QR image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (
                      file.size > 5 * 1024 * 1024 ||
                      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
                    ) {
                      setError('Select a supported image up to 5 MB.');
                      return;
                    }
                    void scanner.current
                      .decodeImage(file)
                      .then(verifyLabel)
                      .catch(() => setError('No readable shipment QR found.'));
                  }}
                />
              </label>
              {checked && (
                <>
                  {checked && (
                    <Alert
                      type="success"
                      message="The label matches this shipment and deployment. Review the physical goods before confirming."
                    />
                  )}
                  <Input
                    label={`Quantity physically received (${shipment.unit})`}
                    value={quantity}
                    onChange={setQuantity}
                    type="number"
                    min="1"
                    max={(BigInt(shipment.quantity) - BigInt(shipment.received ?? '0')).toString()}
                  />
                  <Input
                    label="Actual receipt date and time"
                    type="datetime-local"
                    step="1"
                    value={actual}
                    onChange={setActual}
                  />
                  {shipment.kind === 'ingredient' && !returning && (
                    <Input
                      label="Vehicle registration number (optional)"
                      value={receiveVehicle}
                      onChange={(val) => setReceiveVehicle(val.toUpperCase())}
                      placeholder="e.g. VAB 1234"
                      maxLength={32}
                    />
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />{' '}
                    I physically received {returning ? 'the returned goods' : 'these goods'} at{' '}
                    {label(returning ? shipment.fromLocation : shipment.toLocation)}.
                  </label>
                  <Btn
                    disabled={
                      busy ||
                      !checked ||
                      !confirmed ||
                      (!returning && intake && proofPending) ||
                      (returning && quantity !== String(shipment.quantity)) ||
                      !/^[1-9]\d*$/.test(quantity) ||
                      BigInt(quantity || '0') >
                        BigInt(shipment.quantity) - BigInt(shipment.received ?? '0') ||
                      !Number.isFinite(at) ||
                      at > Date.now() / 1000 ||
                      at < Number(shipment.dispatchedAt)
                    }
                    onClick={() =>
                      void run(async () => {
                        if (
                          !returning &&
                          intake &&
                          linkedCustodyOffer &&
                          Number(shipment.custodyDecision ?? 0) === 0
                        )
                          await submit({
                            action: 'warehouse-decision',
                            shipmentId: shipment.shipmentId,
                            decision: 1,
                          });
                        await submit({
                          action: returning ? 'shipment-return' : 'shipment-receive',
                          shipmentId: shipment.shipmentId,
                          ...(!returning ? { kind: shipment.kind, quantity } : {}),
                          occurredAt: at,
                          qrPayload: checked,
                          ...(!returning && receiveVehicle.trim()
                            ? { vehicle: receiveVehicle.trim() }
                            : {}),
                        });
                        setReceiveVehicle('');
                        setConfirmed(false);
                        setQuantity('');
                      })
                    }
                  >
                    {returning
                      ? 'Confirm physical return with MetaMask'
                      : 'Confirm receipt with MetaMask'}
                  </Btn>
                </>
              )}
            </section>
          )}
          {role === 'distributor' &&
            same(shipment.recipient, data.actor) &&
            shipment.kind === 'product' &&
            Number(shipment.status) === 2 && (
              <Btn icon={<Truck size={16} />} onClick={() => compose(shipment.kind, shipment)}>
                Arrange onward transfer
              </Btn>
            )}
          {role === 'distributor' &&
            shipment.kind === 'ingredient' &&
            Number(shipment.status) < 4 &&
            same(shipment.recipient, data.actor) &&
            Number(shipment.custodyDecision) === 1 && (
              <div className="mt-[16px] rounded-lg border border-[var(--c-border)] p-[16px]">
                <h4>Record vehicle registration</h4>
                <p className="text-sm text-[var(--c-muted)]">
                  The Distributor can record or update the vehicle registration for this shipment
                  after accepting it.
                </p>
                <div className="mt-[8px] flex flex-wrap items-end gap-[8px]">
                  <div className="flex-1 min-w-[200px]">
                    <Input
                      label="Vehicle registration number"
                      value={recordVehicle}
                      onChange={(val) => setRecordVehicle(val.toUpperCase())}
                      placeholder={shipment.vehicle || 'e.g. VAB 1234'}
                      maxLength={32}
                    />
                  </div>
                  <Btn
                    disabled={busy || !/^[A-Z0-9 -]{2,32}$/.test(recordVehicle.trim())}
                    onClick={() =>
                      void run(async () => {
                        await submit({
                          action: 'shipment-vehicle',
                          shipmentId: shipment.shipmentId,
                          vehicle: recordVehicle.trim(),
                        });
                        setRecordVehicle('');
                        setNotice('Vehicle registration updated successfully.');
                      })
                    }
                  >
                    Save vehicle
                  </Btn>
                </div>
              </div>
            )}
          <TechnicalDetails
            fields={[
              { label: 'Shipment ID', value: shipment.shipmentId },
              { label: 'Original batch ID', value: shipment.batchId },
              { label: 'Order ID', value: shipment.orderId ?? 'Not order-bound' },
              { label: 'Dispatch location ID', value: shipment.fromLocation },
              { label: 'Receiving location ID', value: shipment.toLocation },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
