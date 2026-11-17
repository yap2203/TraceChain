import { BackNavigation } from '../../components/ui/BackNavigation';
import { formatLocationLabel } from './location-format';
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
import { workspacePath } from '../workspaces/workspace-paths';
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
  RECEIVED: 'Received into custody',
  EXPIRED: 'Expired',
};

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
}) {
  const currentStage: Partial<Record<CustodyOffer['status'], number>> = {
    REQUESTED: 1,
    ACCEPTED: 2,
    SCHEDULED: 3,
    DISPATCHED: 4,
    RECEIVED: 5,
  };
  const activeStage = currentStage[offer.status];
  const terminal = offer.status === 'REJECTED' || offer.status === 'EXPIRED';
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
      offer.status === 'RECEIVED' || (!terminal && activeStage !== undefined && index < activeStage)
        ? ('complete' as const)
        : !terminal && index === activeStage
          ? ('current' as const)
          : ('pending' as const),
  }));
  const nextAction =
    offer.status === 'REQUESTED'
      ? `${offer.distributorName} is reviewing the custody offer.`
      : offer.status === 'ACCEPTED'
        ? `${offer.distributorName} accepted the offer and must arrange pickup.`
        : offer.status === 'SCHEDULED'
          ? `${offer.senderName} must confirm the physical handoff at pickup.`
          : offer.status === 'DISPATCHED'
            ? `${offer.distributorName} must scan the shipment and confirm warehouse receipt.`
            : offer.status === 'RECEIVED'
              ? 'Warehouse receipt is complete.'
              : offer.status === 'REJECTED'
                ? 'This custody offer was rejected.'
                : 'This custody offer expired.';
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
          <Badge
            label={statusLabel[offer.status]}
            variant={
              offer.status === 'RECEIVED'
                ? 'verified'
                : offer.status === 'REJECTED'
                  ? 'rejected'
                  : offer.status === 'EXPIRED'
                    ? 'expired'
                    : 'pending'
            }
          />
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
            {['REQUESTED', 'ACCEPTED', 'SCHEDULED'].includes(offer.status) && (
              <Link
                className="workspace-custody-detail__evidence-link"
                to={
                  workspacePath(role, receiver ? 'sent-requests' : 'requests') +
                  '?' +
                  new URLSearchParams({ context: 'custody', referenceId: offer.offerId })
                }
              >
                {receiver
                  ? 'Request or verify sender company evidence'
                  : 'Manage requested company evidence'}
              </Link>
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
            {!receiver && offer.status === 'SCHEDULED' && (
              <section
                className="workspace-custody-detail__handoff workspace-flow-page"
                aria-label="Physical handoff confirmation"
              >
                <h4>Confirm physical handoff at pickup</h4>
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
                        setNotice(
                          'Physical handoff recorded. The Distributor scans receipt at its warehouse.',
                        );
                      })
                    }
                  >
                    Confirm handoff with MetaMask
                  </Btn>
                </div>
              </section>
            )}
            {offer.shipmentId && ['DISPATCHED', 'RECEIVED'].includes(offer.status) && (
              <Link
                className="workspace-custody-detail__evidence-link"
                to={
                  workspacePath(role, receiver ? 'arrivals' : 'shipments') +
                  '?shipmentId=' +
                  encodeURIComponent(offer.shipmentId)
                }
              >
                {receiver ? 'Open warehouse arrival & scan receipt' : 'Track this shipment'}
              </Link>
            )}
          </section>
        </div>
        {!receiver && qr && (
          <ProductQrDisplay
            batchId={offer.batchId}
            batchReference={offer.itemName}
            productName={offer.itemName}
            labelTitle="Custody Shipment QR"
            encodedPayload={qr}
            instruction="Attach this label to the goods. The Distributor scans it at warehouse receipt."
          />
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
              { label: 'Custody request', value: offer.offerId },
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
      setError(reportError(cause, 'The custody request could not be updated.'));
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
  const visible = offers.filter(
    (offer) => data && same(receiver ? offer.distributor : offer.sender, data.actor),
  );
  const label = (location: string) =>
    formatLocationLabel(
      data?.locations.find((site) => same(site.location, location)),
      warehouses.find((site) => same(site.location, location))?.name ??
        'Registered company location',
    );
  let qr: string | undefined;
  if (
    selected?.shipmentId &&
    ['DISPATCHED', 'RECEIVED'].includes(selected.status) &&
    data?.chainId &&
    data.ordersAddress &&
    import.meta.env.VITE_PUBLIC_APP_URL
  ) {
    try {
      qr = encodeShipmentQr({
        shipmentId: selected.shipmentId as `0x${string}`,
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
      aria-label={receiver ? 'Custody requests' : 'Send stock into custody'}
    >
      {params.get('offerId') ? (
        <header className="workspace-custody-detail-header">
          <BackNavigation to={workspacePath(role, receiver ? 'intake' : 'transfers')}>
            Custody requests
          </BackNavigation>
          <div className="workspace-custody-detail-header__title-row">
            <h2>Distributor custody request</h2>
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
          title={receiver ? 'Custody requests' : 'Send stock to Distributor custody'}
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
              ? 'Review the offer, then arrange pickup. Warehouse receipt is confirmed separately.'
              : 'Choose your stock and a Distributor warehouse. The Distributor accepts and schedules pickup first.'
          }
        />
      )}
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {loading ? (
        <LoadingIndicator page label="Loading custody requests…" />
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
        />
      ) : (
        <>
          {!receiver && data && (
            <Card>
              <SectionTitle title="New custody offer" />
              <div className="workspace-offer-form">
                <SelectField
                  label="Your stock"
                  value={batch}
                  onChange={setBatch}
                  options={[
                    { value: '', label: 'Select an owned batch' },
                    ...stock.map((item) => ({
                      value: item.batchId,
                      label: `${item.name} · ${item.unit}`,
                    })),
                  ]}
                />
                <div className="workspace-offer-field">
                  <SelectField
                    label="Pickup location"
                    value={from}
                    onChange={setFrom}
                    options={[
                      { value: '', label: 'Select your registered location' },
                      ...sites.map((site) => ({
                        value: site.location,
                        label: formatLocationLabel(site, 'Registered location'),
                      })),
                    ]}
                  />
                  {availableAtPickup !== undefined && selectedItem && (
                    <p role="status" className="workspace-offer-availability">
                      Available at this pickup location: <strong>{availableAtPickup}</strong>{' '}
                      {selectedItem.unit}
                    </p>
                  )}
                </div>
                <SelectField
                  label="Distributor warehouse"
                  value={warehouse}
                  onChange={setWarehouse}
                  options={[
                    { value: '', label: 'Select an authorized warehouse' },
                    ...warehouses.map((site) => ({ value: site.location, label: site.name })),
                  ]}
                />
                <Input
                  label={`Quantity (${selectedItem?.unit ?? 'batch unit'})`}
                  value={quantity}
                  onChange={setQuantity}
                  inputMode="numeric"
                  pattern="[1-9][0-9]*"
                  required
                />
                <Input
                  label="Offer expiry"
                  type="datetime-local"
                  value={deadline}
                  onChange={setDeadline}
                  required
                  min={local()}
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
                    !(Date.parse(deadline) > Date.now())
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
                title="No custody requests"
                sub={
                  receiver
                    ? 'Offers from Suppliers and Manufacturers will appear here.'
                    : 'Your custody offers and their pickup stages will appear here.'
                }
              />
            ) : (
              <Table headers={['Stock', 'Company', 'Quantity', 'Next stage', 'Action']}>
                {visible.map((offer) => (
                  <TR key={offer.offerId}>
                    <TD bold>{offer.itemName}</TD>
                    <TD>{receiver ? offer.senderName : offer.distributorName}</TD>
                    <TD>
                      {offer.quantity} {offer.unit}
                    </TD>
                    <TD>{statusLabel[offer.status]}</TD>
                    <TD>
                      <Btn
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setParams({ offerId: offer.offerId });
                          setPickup('');
                        }}
                      >
                        View request
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
