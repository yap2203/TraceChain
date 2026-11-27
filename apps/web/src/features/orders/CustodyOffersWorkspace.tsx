import { BackNavigation } from '../../components/ui/BackNavigation';
import { formatLocationLabel } from './location-format';
import { CatalogueImage } from './CatalogueMedia';
import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Handshake,
  Hourglass,
  Inbox,
  Package,
  RefreshCw,
  Send,
  Warehouse,
  XCircle,
} from 'lucide-react';
import {
  actCustodyOffer,
  createCustodyOffer,
  getCustodyOffers,
  getOrders,
  prepareCustodyOffer,
  type CustodyOffer,
  type OrderRecord,
  type OrdersState,
} from './orders.api';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import { ProductQrDisplay } from '../product-traceability/ProductQrDisplay';
import { encodeShipmentQr } from '@tracechain/shared';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  EntityPicker,
  type EntityOption,
  Input,
  SectionTitle,
  SelectField,
  StatusTimeline,
  Table,
  TD,
  TR,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import type { BadgeVariant } from '../workspaces/shared/ui/Badge';
import { workspacePath } from '../workspaces/workspace-paths';
import { DeliveryIdentityPanel } from './DeliveryIdentityPanel';
import { ShipmentsWorkspace } from './ShipmentsWorkspace';
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const local = (offset = 0) => {
  const date = new Date(Date.now() + offset);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const statusLabel: Record<CustodyOffer['status'], string> = {
  REQUESTED: 'Awaiting acceptance',
  ACCEPTED: 'Pickup time needed',
  SCHEDULED: 'Pickup arranged',
  REJECTED: 'Rejected',
  DISPATCHED: 'Handoff recorded',
  RECEIVED: 'Received',
  EXPIRED: 'Expired',
};
const statusVariant: Record<CustodyOffer['status'], BadgeVariant> = {
  REQUESTED: 'pending',
  ACCEPTED: 'pending',
  SCHEDULED: 'shared',
  DISPATCHED: 'shared',
  RECEIVED: 'verified',
  REJECTED: 'rejected',
  EXPIRED: 'rejected',
};
// Whose move it is: the Distributor acts on REQUESTED, ACCEPTED and DISPATCHED; the sender on SCHEDULED.
const isMyTurn = (offer: CustodyOffer, receiver: boolean) =>
  receiver
    ? ['REQUESTED', 'ACCEPTED', 'DISPATCHED'].includes(offer.status)
    : offer.status === 'SCHEDULED';

function CustodyRequestDetail({
  offer,
  role,
  receiver,
  actor,
  busy,
  pickup,
  setPickup,
  vehicle,
  setVehicle,
  actual,
  setActual,
  eta,
  setEta,
  confirmed,
  setConfirmed,
  qr,
  run,
  setNotice,
  locationLabel,
  data,
  onChanged,
}: {
  offer: CustodyOffer;
  role: WorkspaceRole;
  receiver: boolean;
  actor: string;
  busy: boolean;
  pickup: string;
  setPickup: (value: string) => void;
  vehicle: string;
  setVehicle: (value: string) => void;
  actual: string;
  setActual: (value: string) => void;
  eta: string;
  setEta: (value: string) => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  qr?: string;
  run: (action: () => Promise<void>) => Promise<void>;
  setNotice: (value: string) => void;
  locationLabel: (location: string) => string;
  data: OrdersState;
  onChanged: () => Promise<void>;
}) {
  const [requestEvidence, setRequestEvidence] = useState(false);
  const currentStage: Partial<Record<CustodyOffer['status'], number>> = {
    REQUESTED: 1,
    ACCEPTED: 2,
    SCHEDULED: 3,
    DISPATCHED: 4,
    RECEIVED: 5,
  };
  const activeStage = currentStage[offer.status];
  const terminal = offer.status === 'REJECTED' || offer.status === 'EXPIRED';
  // A closed offer keeps the steps it reached: sent always, accept + pickup when a pickup was set.
  const reachedBeforeClose = offer.pickupAt ? 3 : 1;
  const steps = [
    { actor: offer.senderName, icon: <Send size={30} />, label: 'Offer sent' },
    {
      actor: offer.distributorName,
      icon: <ClipboardCheck size={30} />,
      label: 'Distributor accepts',
    },
    {
      actor: offer.distributorName,
      icon: <CalendarClock size={30} />,
      label: 'Pickup arranged',
    },
    { actor: offer.senderName, icon: <Handshake size={30} />, label: 'Physical handoff' },
    {
      actor: offer.distributorName,
      icon: <Warehouse size={30} />,
      label: 'Warehouse received',
    },
  ].map((step, index) => ({
    ...step,
    state:
      offer.status === 'RECEIVED' ||
      (terminal ? index < reachedBeforeClose : activeStage !== undefined && index < activeStage)
        ? ('complete' as const)
        : !terminal && index === activeStage
          ? ('current' as const)
          : ('pending' as const),
  }));
  // Speak to the viewer: an instruction on their turn, a waiting message otherwise.
  const nextAction =
    offer.status === 'REQUESTED'
      ? receiver
        ? 'Review this offer, then accept or reject it.'
        : `Waiting for ${offer.distributorName} to accept or reject the offer.`
      : offer.status === 'ACCEPTED'
        ? receiver
          ? 'Choose the pickup time for this stock.'
          : `Waiting for ${offer.distributorName} to arrange the pickup time.`
        : offer.status === 'SCHEDULED'
          ? receiver
            ? `At pickup, check the TraceChain label on the goods. ${offer.senderName} then confirms the handoff.`
            : 'Print the label and attach it to the stock. At pickup, hand the goods over and confirm the handoff below.'
          : offer.status === 'DISPATCHED'
            ? receiver
              ? 'When the goods arrive, scan the label on them to confirm warehouse receipt.'
              : `In transit. ${offer.distributorName} scans the label at its warehouse to confirm receipt.`
            : offer.status === 'RECEIVED'
              ? 'Warehouse receipt is complete.'
              : offer.status === 'REJECTED'
                ? 'This custody offer was rejected.'
                : 'This custody offer expired before the handoff.';
  const NextIcon =
    offer.status === 'REQUESTED'
      ? Hourglass
      : offer.status === 'ACCEPTED'
        ? CalendarClock
        : offer.status === 'SCHEDULED'
          ? Handshake
          : offer.status === 'DISPATCHED'
            ? Warehouse
            : offer.status === 'RECEIVED'
              ? CheckCircle2
              : offer.status === 'REJECTED'
                ? XCircle
                : Clock3;
  const stockNotice =
    offer.status === 'REJECTED' || offer.status === 'EXPIRED'
      ? 'No stock moved for this custody offer.'
      : offer.status === 'DISPATCHED' || offer.status === 'RECEIVED'
        ? 'Stock moved when the physical handoff was confirmed.'
        : 'Stock moves only after physical handoff is confirmed.';

  return (
    <div className="workspace-custody-detail">
      <Alert type="info" message={stockNotice} />
      <Card>
        <div className="workspace-custody-detail__item">
          <Package size={30} aria-hidden="true" />
          <h3>{offer.itemName}</h3>
          <Badge label={statusLabel[offer.status]} variant={statusVariant[offer.status]} />
        </div>
        <StatusTimeline label="Custody request progress" steps={steps} variant="custody" />
        <div className="workspace-custody-detail__panels">
          <section
            className="workspace-custody-detail__panel workspace-custody-detail__panel--transfer"
            aria-labelledby="custody-transfer-details-title"
          >
            <h3 id="custody-transfer-details-title">Transfer details</h3>
            <dl className="workspace-custody-detail__facts">
              <div>
                <dt>Quantity</dt>
                <dd>
                  {offer.quantity} {offer.unit}
                </dd>
              </div>
              <div>
                <dt>Request expiry</dt>
                <dd>{new Date(offer.expiresAt * 1000).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Sender</dt>
                <dd>{offer.senderName}</dd>
              </div>
              <div>
                <dt>Distributor</dt>
                <dd>{offer.distributorName}</dd>
              </div>
              {offer.pickupAt && (
                <div>
                  <dt>Planned pickup</dt>
                  <dd>{new Date(offer.pickupAt * 1000).toLocaleString()}</dd>
                </div>
              )}
            </dl>
            <div className="workspace-custody-detail__route" aria-label="Custody route">
              <span>
                {offer.fromLocationName ?? locationLabel(offer.fromLocation)}
                {offer.fromLocationAddress && (
                  <small style={{ display: 'block', whiteSpace: 'pre-line' }}>
                    {offer.fromLocationAddress}
                  </small>
                )}
              </span>
              <span aria-hidden="true">→</span>
              <span>
                {offer.toLocationName ?? locationLabel(offer.toLocation)}
                {offer.toLocationAddress && (
                  <small style={{ display: 'block', whiteSpace: 'pre-line' }}>
                    {offer.toLocationAddress}
                  </small>
                )}
              </span>
            </div>
          </section>
          <section
            className="workspace-custody-detail__panel workspace-custody-detail__panel--action"
            aria-labelledby="custody-next-action-title"
          >
            <h3 id="custody-next-action-title">Next action</h3>
            <div className="workspace-custody-detail__next-copy">
              <span aria-hidden="true">
                <NextIcon size={22} />
              </span>
              <p>{nextAction}</p>
            </div>
            {receiver && ['REQUESTED', 'ACCEPTED', 'SCHEDULED'].includes(offer.status) && (
              <Btn variant="outline" onClick={() => setRequestEvidence(true)}>
                Request sender company evidence
              </Btn>
            )}
            {requestEvidence && (
              <DeliveryIdentityPanel
                requestOnly
                data={data}
                order={{
                  orderId: offer.offerId,
                  seller: offer.sender,
                  buyer: offer.distributor,
                  expiresAt: offer.expiresAt,
                  proposedBatch: offer.batchId,
                  delivery: {
                    distributor: offer.distributor,
                    batchId: offer.batchId,
                    identityChallenge: '',
                  },
                }}
                requestedBy={offer.distributorName}
                onChanged={onChanged}
                onRequestClose={() => setRequestEvidence(false)}
              />
            )}
            {receiver && offer.status === 'REQUESTED' && (
              <div className="workspace-location-actions action-row">
                <Btn
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await actCustodyOffer(offer.offerId, { action: 'reject' });
                      setNotice('Custody offer rejected. No stock moved.');
                    })
                  }
                >
                  Reject offer
                </Btn>
                <Btn
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await actCustodyOffer(offer.offerId, { action: 'accept' });
                      setNotice('Offer accepted. Arrange the pickup time next.');
                    })
                  }
                >
                  Accept custody offer
                </Btn>
              </div>
            )}
            {receiver && ['ACCEPTED', 'SCHEDULED'].includes(offer.status) && !offer.shipmentId && (
              <section className="workspace-pickup-plan" aria-label="Pickup arrangement">
                <h4>
                  <CalendarClock size={18} />
                  Arrange pickup
                </h4>
                <Input
                  label="Planned custody pickup"
                  type="datetime-local"
                  value={pickup}
                  onChange={setPickup}
                  required
                  min={local()}
                  max={local(offer.expiresAt * 1000 - Date.now())}
                />
                <div className="action-row">
                  <Btn
                    disabled={
                      busy ||
                      !(
                        Date.parse(pickup) > Date.now() &&
                        Date.parse(pickup) < offer.expiresAt * 1000
                      )
                    }
                    onClick={() =>
                      void run(async () => {
                        await actCustodyOffer(offer.offerId, {
                          action: 'schedule',
                          pickupAt: Math.floor(Date.parse(pickup) / 1000),
                        });
                        setNotice('Pickup time shared with the sender.');
                      })
                    }
                  >
                    {offer.pickupAt ? 'Update pickup time' : 'Confirm pickup time'}
                  </Btn>
                </div>
              </section>
            )}
            {!receiver && qr && offer.status === 'SCHEDULED' && (
              <section className="workspace-custody-detail__label" aria-label="Shipment label">
                <h4>Step 1 · Print and attach the label</h4>
                <ProductQrDisplay
                  batchId={offer.batchId}
                  batchReference={offer.itemName}
                  productName={offer.itemName}
                  labelTitle="Custody shipment label"
                  encodedPayload={qr}
                  instruction="Print this label and attach it to the stock before pickup. The Distributor scans it at its warehouse to confirm receipt."
                />
              </section>
            )}
            {!receiver && offer.status === 'SCHEDULED' && (
              <section
                className="workspace-custody-detail__handoff workspace-flow-page"
                aria-label="Physical handoff confirmation"
              >
                <h4>Step 2 · Confirm the handoff at pickup</h4>
                <Input
                  label="Pickup vehicle registration"
                  value={vehicle}
                  onChange={(value) => setVehicle(value.toUpperCase())}
                  maxLength={32}
                  required
                />
                <Input
                  label="Actual handoff time"
                  type="datetime-local"
                  value={actual}
                  onChange={setActual}
                  required
                />
                <Input
                  label="Expected warehouse arrival"
                  type="datetime-local"
                  value={eta}
                  onChange={setEta}
                  required
                />
                <label className="workspace-custody-detail__confirmation">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  The goods were physically handed to this Distributor.
                </label>
                <div className="action-row">
                  <Btn
                    icon={<Send size={16} />}
                    disabled={
                      busy ||
                      !confirmed ||
                      !/^(?=.*[A-Z0-9])[A-Z0-9 -]{2,32}$/.test(vehicle) ||
                      !(Date.parse(actual) <= Date.now() && Date.parse(eta) > Date.now())
                    }
                    onClick={() =>
                      void run(async () => {
                        const prepared = await prepareCustodyOffer(offer.offerId, {
                          vehicle,
                          occurredAt: Math.floor(Date.parse(actual) / 1000),
                          expectedAt: Math.floor(Date.parse(eta) / 1000),
                        });
                        await submitProductionTransaction(prepared.transaction, actor);
                        setConfirmed(false);
                        // Chain events count after the confirmation window; refresh once it passes.
                        setTimeout(() => void onChanged().catch(() => undefined), 30_000);
                        setNotice(
                          'Handoff recorded. The Distributor scans the label at its warehouse to confirm receipt.',
                        );
                      })
                    }
                  >
                    Confirm handoff with MetaMask
                  </Btn>
                </div>
              </section>
            )}
            {!receiver && offer.shipmentId && ['DISPATCHED', 'RECEIVED'].includes(offer.status) && (
              <Link
                className="workspace-custody-detail__evidence-link"
                to={
                  workspacePath(role, 'shipments') +
                  '?shipmentId=' +
                  encodeURIComponent(offer.shipmentId)
                }
              >
                Track this shipment
              </Link>
            )}
          </section>
        </div>
        {!receiver && qr && offer.status !== 'SCHEDULED' && (
          <section className="workspace-custody-detail__label" aria-label="Shipment label">
            <ProductQrDisplay
              batchId={offer.batchId}
              batchReference={offer.itemName}
              productName={offer.itemName}
              labelTitle="Custody shipment label"
              encodedPayload={qr}
              instruction="The Distributor scans this label at its warehouse to confirm receipt. Reprint it if the label is damaged."
            />
          </section>
        )}
        {!receiver &&
          !qr &&
          offer.shipmentId &&
          ['DISPATCHED', 'RECEIVED'].includes(offer.status) && (
            <Alert
              type="info"
              message="The shipment is recorded, but its QR label is unavailable. Open shipment tracking to check the configured QR URL before warehouse receipt."
            />
          )}
        <div className="workspace-custody-detail__technical">
          <TechnicalDetails
            fields={[
              { label: 'Custody offer', value: offer.offerId },
              { label: 'Batch', value: offer.batchId },
              { label: 'Source location', value: offer.fromLocation },
              { label: 'Warehouse location', value: offer.toLocation },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}

export function CustodyOffersWorkspace({
  role,
  receiver = false,
}: {
  role: WorkspaceRole;
  receiver?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<OrdersState>(),
    [offers, setOffers] = useState<CustodyOffer[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [batch, setBatch] = useState(''),
    [from, setFrom] = useState(''),
    [warehouse, setWarehouse] = useState(''),
    [quantity, setQuantity] = useState(''),
    [deadline, setDeadline] = useState(''),
    [pickup, setPickup] = useState('');
  const [vehicle, setVehicle] = useState(''),
    [actual, setActual] = useState(local()),
    [eta, setEta] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    const [result, state] = await Promise.all([getCustodyOffers(), getOrders()]);
    setOffers(result.offers);
    setData(state);
  }, []);
  useEffect(() => {
    let active = true;
    void load()
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
    } catch (cause) {
      setError(reportError(cause, 'The custody offer could not be updated.'));
    } finally {
      setBusy(false);
    }
  };
  const selected = offers.find((offer) => same(offer.offerId, params.get('offerId') ?? ''));
  const kind = role === 'supplier' ? 1 : 2;
  const stock: OrderRecord[] = (data?.catalogue ?? [])
    .filter(
      (item) =>
        Number(item.kind) === kind &&
        item.active &&
        !item.archived &&
        same(item.seller, data?.actor),
    )
    .flatMap((item) => item.batches.map((batchId: string) => ({ ...item, batchId })));
  const sites = (data?.locations ?? []).filter((site) => same(site.company, data?.actor));
  const warehouses = data?.logistics?.warehouses ?? [];
  const chosenWarehouse = warehouses.find((site) => same(site.location, warehouse));
  const selectedItem = stock.find((item) => same(item.batchId, batch));
  const batchExpiresAt = Number(
    selectedItem?.batchDetails?.find((entry: { batchId?: string }) => same(entry.batchId, batch))
      ?.expiresAt ?? 0,
  );
  const selectedProductStock =
    kind === 2
      ? data?.logistics?.productStock?.find((item) => same(item.batchId, batch))
      : undefined;
  const availableAtPickup =
    selectedProductStock && from
      ? selectedProductStock.tracked
        ? ((selectedProductStock.locations ?? []).find((item: OrderRecord) =>
            same(item.location, from),
          )?.available ?? '0')
        : same(selectedProductStock.productionLocation, from)
          ? selectedProductStock.available
          : '0'
      : undefined;
  const visible = offers
    .filter((offer) => data && same(receiver ? offer.distributor : offer.sender, data.actor))
    // Newest first; offers without a creation time fall back to their expiry.
    .sort(
      (a, b) =>
        (Date.parse(b.createdAt ?? '') || b.expiresAt * 1000) -
        (Date.parse(a.createdAt ?? '') || a.expiresAt * 1000),
    );
  const stockOptions: EntityOption[] = stock.map((item) => {
    const detail = item.batchDetails?.find((entry: { batchId?: string }) =>
      same(entry.batchId, item.batchId),
    );
    const summary = item.batchSummaries?.[item.batchId];
    const available =
      kind === 2
        ? data?.logistics?.productStock?.find((entry) => same(entry.batchId, item.batchId))
            ?.available
        : (detail?.supplierAvailable ?? summary?.supplierAvailable);
    const expiresAt = Number(detail?.expiresAt ?? 0);
    return {
      id: item.batchId,
      title: item.name,
      media: (
        <CatalogueImage
          path={item.imagePath}
          category={item.category}
          alt={`Supplier-provided image of ${item.name}`}
        />
      ),
      subtitle: `Batch ${summary?.batchReference ?? item.batchReference ?? shortId(item.batchId)}`,
      group: item.category,
      keywords: `${item.batchId} ${item.category ?? ''}`,
      facts: [
        ...(available !== undefined
          ? [{ label: 'Available', value: amount(available, item.unit) }]
          : []),
        ...(expiresAt
          ? [{ label: 'Expires', value: new Date(expiresAt * 1000).toLocaleDateString() }]
          : []),
      ],
      disabledReason:
        expiresAt && expiresAt * 1000 <= Date.now()
          ? 'This batch has expired.'
          : available !== undefined && String(available) === '0'
            ? 'No stock available to send.'
            : undefined,
    };
  });
  const siteAvailable = (location: string) =>
    selectedProductStock
      ? selectedProductStock.tracked
        ? ((selectedProductStock.locations ?? []).find((item: OrderRecord) =>
            same(item.location, location),
          )?.available ?? '0')
        : same(selectedProductStock.productionLocation, location)
          ? selectedProductStock.available
          : '0'
      : undefined;
  const siteOptions: EntityOption[] = sites.map((site) => {
    const available = siteAvailable(site.location);
    return {
      id: site.location,
      title: site.label ?? site.name ?? 'Registered location',
      subtitle: site.address,
      keywords: site.location,
      facts:
        available !== undefined && selectedItem
          ? [{ label: 'Available here', value: amount(available, selectedItem.unit) }]
          : [],
    };
  });
  const warehouseOptions: EntityOption[] = warehouses.map((site) => {
    const address = data?.locations.find((entry) => same(entry.location, site.location))?.address;
    return {
      id: site.location,
      title: site.name,
      subtitle: site.distributorName ?? 'Authorized Distributor',
      group: site.distributorName,
      keywords: `${site.distributor} ${address ?? ''}`,
      facts: address ? [{ label: 'Address', value: address }] : [],
    };
  });
  const label = (location: string) =>
    formatLocationLabel(
      data?.locations.find((site) => same(site.location, location)),
      warehouses.find((site) => same(site.location, location))?.name ??
        'Registered company location',
    );
  let qr: string | undefined;
  // The label exists from "pickup arranged", using the planned ID until the handoff records it.
  const labelShipmentId = selected?.shipmentId ?? selected?.plannedShipmentId;
  if (
    selected &&
    labelShipmentId &&
    ['SCHEDULED', 'DISPATCHED', 'RECEIVED'].includes(selected.status) &&
    data?.chainId &&
    data.ordersAddress &&
    import.meta.env.VITE_PUBLIC_APP_URL
  ) {
    try {
      qr = encodeShipmentQr({
        shipmentId: labelShipmentId as `0x${string}`,
        kind: selected.kind === 1 ? 'ingredient' : 'product',
        chainId: data.chainId,
        ordersAddress: data.ordersAddress as `0x${string}`,
        publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL,
      });
    } catch {
      /* The configured shipment screen displays locator errors. */
    }
  }
  return (
    <section
      className="workspace-flow-page"
      aria-label={receiver ? 'Custody offers' : 'Send stock into custody'}
    >
      {params.get('offerId') ? (
        <header className="workspace-custody-detail-header">
          <BackNavigation to={workspacePath(role, receiver ? 'intake' : 'transfers')}>
            {receiver ? 'Custody offers' : 'Send to custody'}
          </BackNavigation>
          <div className="workspace-custody-detail-header__title-row">
            <h2>Custody offer</h2>
            <Btn
              variant="outline"
              icon={<RefreshCw size={16} />}
              disabled={loading || busy}
              onClick={() => void run(async () => {})}
            >
              Refresh
            </Btn>
          </div>
        </header>
      ) : (
        <SectionTitle
          title={receiver ? 'Custody offers' : 'Send stock to Distributor custody'}
          action={
            <Btn
              variant="outline"
              icon={<RefreshCw size={16} />}
              disabled={loading || busy}
              onClick={() => void run(async () => {})}
            >
              Refresh
            </Btn>
          }
          sub={
            receiver
              ? 'Review offers from Suppliers and Manufacturers, arrange pickup, then confirm warehouse receipt.'
              : 'Choose your stock and a Distributor warehouse. The Distributor accepts and schedules pickup first.'
          }
        />
      )}
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {loading ? (
        <LoadingIndicator page label="Loading custody offers…" />
      ) : selected &&
        data &&
        receiver &&
        selected.status === 'DISPATCHED' &&
        selected.shipmentId ? (
        // Goods on the way: this offer page becomes the receipt (scan the label, confirm receipt).
        <ShipmentsWorkspace
          key={selected.shipmentId}
          role={role}
          section="intake"
          initialKind={selected.kind === 1 ? 'ingredient' : 'product'}
          initialShipmentId={selected.shipmentId}
          embedded
        />
      ) : selected && data ? (
        <CustodyRequestDetail
          offer={selected}
          role={role}
          receiver={receiver}
          actor={data.actor}
          busy={busy}
          pickup={pickup}
          setPickup={setPickup}
          vehicle={vehicle}
          setVehicle={setVehicle}
          actual={actual}
          setActual={setActual}
          eta={eta}
          setEta={setEta}
          confirmed={confirmed}
          setConfirmed={setConfirmed}
          qr={qr}
          run={run}
          setNotice={setNotice}
          locationLabel={label}
          data={data}
          onChanged={load}
        />
      ) : (
        <>
          {!receiver && data && (
            <Card>
              <SectionTitle title="New custody offer" />
              <div className="workspace-offer-form">
                <EntityPicker
                  label="Your stock"
                  required
                  value={batch}
                  onChange={(id) => {
                    setBatch(id);
                    // The quantity belongs to the previous batch's unit and availability.
                    setQuantity('');
                  }}
                  options={stockOptions}
                  dialogTitle="Choose stock to send"
                  chooseLabel="Choose stock"
                  confirmLabel="Use this stock"
                  searchPlaceholder="Search name, batch reference or ID"
                  filterLabel="Categories"
                  sorts={[
                    {
                      value: 'name',
                      label: 'Name A–Z',
                      compare: (a, b) => a.title.localeCompare(b.title),
                    },
                    {
                      value: 'available',
                      label: 'Most available',
                      compare: (a, b) => factNumber(b, 'Available') - factNumber(a, 'Available'),
                    },
                    {
                      value: 'expiry',
                      label: 'Expiring soonest',
                      compare: (a, b) => factDate(a, 'Expires') - factDate(b, 'Expires'),
                    },
                  ]}
                  emptyText="You have no active stock to send. Register a batch first."
                />
                <div className="workspace-offer-field">
                  <EntityPicker
                    label="Pickup location"
                    required
                    value={from}
                    onChange={setFrom}
                    options={siteOptions}
                    dialogTitle="Choose a pickup location"
                    chooseLabel="Choose pickup location"
                    confirmLabel="Use this location"
                    searchPlaceholder="Search location or address"
                    sorts={[
                      {
                        value: 'name',
                        label: 'Name A–Z',
                        compare: (x, y) => x.title.localeCompare(y.title),
                      },
                    ]}
                    emptyText="Register a pickup location in Profile first."
                  />
                  {availableAtPickup !== undefined && selectedItem && (
                    <p role="status" className="workspace-offer-availability">
                      Available at this pickup location: <strong>{availableAtPickup}</strong>{' '}
                      {selectedItem.unit}
                    </p>
                  )}
                </div>
                <EntityPicker
                  label="Distributor warehouse"
                  required
                  value={warehouse}
                  onChange={setWarehouse}
                  options={warehouseOptions}
                  dialogTitle="Choose a Distributor warehouse"
                  chooseLabel="Choose warehouse"
                  confirmLabel="Use this warehouse"
                  searchPlaceholder="Search warehouse, Distributor or address"
                  filterLabel="Distributors"
                  sorts={[
                    {
                      value: 'name',
                      label: 'Name A–Z',
                      compare: (a, b) => a.title.localeCompare(b.title),
                    },
                    {
                      value: 'company',
                      label: 'Distributor A–Z',
                      compare: (a, b) => (a.subtitle ?? '').localeCompare(b.subtitle ?? ''),
                    },
                  ]}
                  emptyText="No authorized Distributor warehouses are registered yet."
                />
                <Input
                  label={`Quantity (${selectedItem?.unit ?? 'batch unit'})`}
                  value={quantity}
                  onChange={setQuantity}
                  inputMode="numeric"
                  pattern="[1-9][0-9]*"
                  required
                  disabled={!batch}
                  hint={
                    batch
                      ? stockOptions.find((option) => option.id === batch)?.facts?.[0]?.label ===
                        'Available'
                        ? `Available: ${stockOptions.find((option) => option.id === batch)!.facts![0]!.value}`
                        : undefined
                      : 'Choose stock first.'
                  }
                />
                <Input
                  label="Offer expiry"
                  type="datetime-local"
                  value={deadline}
                  onChange={setDeadline}
                  required
                  min={local()}
                  max={batchExpiresAt ? local(batchExpiresAt * 1000 - Date.now()) : undefined}
                  // Our reason replaces the browser's bare "must be … or earlier" message.
                  error={
                    !deadline
                      ? undefined
                      : !(Date.parse(deadline) > Date.now())
                        ? 'Choose a time in the future.'
                        : batchExpiresAt && Date.parse(deadline) >= batchExpiresAt * 1000
                          ? `The offer must end before this batch expires on ${new Date(batchExpiresAt * 1000).toLocaleString()}. Choose an earlier date.`
                          : undefined
                  }
                  hint={
                    batchExpiresAt
                      ? 'Must be before the batch expires on ' +
                        new Date(batchExpiresAt * 1000).toLocaleString() +
                        '.'
                      : undefined
                  }
                />
              </div>
              <div className="action-row">
                <Btn
                  icon={<Send size={16} />}
                  disabled={
                    busy ||
                    !batch ||
                    !from ||
                    !chosenWarehouse ||
                    !/^[1-9]\d*$/.test(quantity) ||
                    !(Date.parse(deadline) > Date.now()) ||
                    (!!batchExpiresAt && Date.parse(deadline) >= batchExpiresAt * 1000)
                  }
                  onClick={() =>
                    void run(async () => {
                      const result = await createCustodyOffer({
                        operationId: crypto.randomUUID(),
                        kind,
                        batchId: batch,
                        quantity,
                        fromLocation: from,
                        toLocation: warehouse,
                        distributor: chosenWarehouse!.distributor,
                        expiresAt: Math.floor(Date.parse(deadline) / 1000),
                      });
                      setParams({ offerId: result.offer.offerId });
                      setNotice('Offer sent. No stock moves until physical handoff is confirmed.');
                    })
                  }
                >
                  Send custody offer
                </Btn>
              </div>
              {!sites.length && (
                <Link to={workspacePath(role, 'profile')}>
                  Register a pickup location in Profile
                </Link>
              )}
            </Card>
          )}
          <Card padding="0">
            {!visible.length ? (
              <EmptyState
                icon={receiver ? <Inbox size={38} /> : <Package size={38} />}
                title="No custody offers"
                sub={
                  receiver
                    ? 'Offers from Suppliers and Manufacturers will appear here.'
                    : 'Your custody offers and their pickup stages will appear here.'
                }
              />
            ) : (
              <Table headers={['Stock', 'Company', 'Quantity', 'Stage', '']}>
                {visible.map((offer) => (
                  <TR
                    key={offer.offerId}
                    onClick={() => {
                      setParams({ offerId: offer.offerId });
                      setPickup('');
                    }}
                  >
                    <TD bold>{offer.itemName}</TD>
                    <TD>{receiver ? offer.senderName : offer.distributorName}</TD>
                    <TD>
                      {offer.quantity} {offer.unit}
                    </TD>
                    <TD>
                      <Badge
                        label={statusLabel[offer.status]}
                        variant={statusVariant[offer.status]}
                      />
                    </TD>
                    <TD>
                      <Btn
                        variant={isMyTurn(offer, receiver) ? 'primary' : 'outline'}
                        size="sm"
                        onClick={(event) => {
                          event?.stopPropagation();
                          setParams({ offerId: offer.offerId });
                          setPickup('');
                        }}
                      >
                        {isMyTurn(offer, receiver) ? 'Take action' : 'View offer'}
                      </Btn>
                    </TD>
                  </TR>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </section>
  );
}

function amount(value: string | number, unit: string) {
  try {
    return `${BigInt(value).toLocaleString()} ${unit}`;
  } catch {
    return `${value} ${unit}`;
  }
}
const shortId = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const factNumber = (option: EntityOption, label: string) =>
  Number(option.facts?.find((fact) => fact.label === label)?.value.replace(/[^\d.]/g, '') ?? 0);
const factDate = (option: EntityOption, label: string) =>
  Date.parse(option.facts?.find((fact) => fact.label === label)?.value ?? '') || Infinity;
