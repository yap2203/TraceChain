import { BackNavigation } from '../../components/ui/BackNavigation';
import { formatLocationLabel } from './location-format';
import { CatalogueImage } from './CatalogueMedia';
import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Hourglass,
  Inbox,
  Package,
  RefreshCw,
  Send,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import {
  actCustodyOffer,
  createCustodyOffer,
  deliveryIdentity,
  getCustodyOffers,
  getOrders,
  type CustodyOffer,
  type OrderRecord,
  type OrdersState,
} from './orders.api';
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
  StatusTimeline,
  Table,
  TD,
  TR,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';
import type { BadgeVariant } from '../workspaces/shared/ui/Badge';
import { workspacePath } from '../workspaces/workspace-paths';
import { proofStatusLabel, proofStatusVariant } from './DeliveryIdentityPanel';
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const local = (offset = 0) => {
  const date = new Date(Date.now() + offset);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
// The custody offer ends once pickup is arranged; handoff and receipt belong to the shipment.
const statusLabel: Record<CustodyOffer['status'], string> = {
  REQUESTED: 'Awaiting acceptance',
  ACCEPTED: 'Pickup time needed',
  SCHEDULED: 'Pickup arranged',
  REJECTED: 'Rejected',
  DISPATCHED: 'In shipment',
  RECEIVED: 'Received',
  EXPIRED: 'Expired',
};
const statusVariant: Record<CustodyOffer['status'], BadgeVariant> = {
  REQUESTED: 'pending',
  ACCEPTED: 'pending',
  SCHEDULED: 'verified',
  DISPATCHED: 'moving',
  RECEIVED: 'verified',
  REJECTED: 'rejected',
  EXPIRED: 'rejected',
};
const inShipment = (offer: CustodyOffer) =>
  ['SCHEDULED', 'DISPATCHED', 'RECEIVED'].includes(offer.status);
// Whose move it is on this page: only the Distributor, until pickup is arranged.
const isMyTurn = (offer: CustodyOffer, receiver: boolean) =>
  receiver && ['REQUESTED', 'ACCEPTED'].includes(offer.status);
/** Shipments page for an offer: by recorded shipment once handed off, else by offer. */
export const custodyShipmentPath = (role: WorkspaceRole, offer: CustodyOffer) =>
  // The Distributor receives custody stock under warehouse arrivals; senders track it under shipments.
  workspacePath(
    role,
    role === 'distributor' ? 'arrivals' : offer.kind === 2 ? 'product-shipments' : 'shipments',
  ) +
  (offer.shipmentId
    ? '?shipmentId=' + encodeURIComponent(offer.shipmentId)
    : '?offerId=' + encodeURIComponent(offer.offerId));
/** The custody offer's company evidence request in Evidence Exchange. */
const custodyEvidencePath = (role: WorkspaceRole, offerId: string, receiver: boolean) =>
  workspacePath(role, receiver ? 'sent-requests' : 'requests') +
  '?context=custody&referenceId=' +
  encodeURIComponent(offerId);

/**
 * Whether the Distributor may decide on an offer, given its company evidence request.
 * Pending evidence blocks both decisions; an expired, unverified request no longer blocks.
 */
export function custodyProofGate(status?: string, expiresAt = 0) {
  if (!status) return undefined;
  const verified = status === 'VERIFIED';
  const expired =
    !verified && (status === 'EXPIRED' || (expiresAt > 0 && expiresAt <= Date.now() / 1000));
  const open = status === 'NOT_REQUESTED' || verified || expired;
  return {
    status,
    expired,
    canAccept: open,
    // A declined or failed request can never verify, so rejecting stays possible.
    canReject: open || ['DECLINED', 'REJECTED'].includes(status),
  };
}

function CustodyRequestDetail({
  offer,
  role,
  receiver,
  busy,
  pickup,
  setPickup,
  run,
  setNotice,
  locationLabel,
}: {
  offer: CustodyOffer;
  role: WorkspaceRole;
  receiver: boolean;
  busy: string;
  pickup: string;
  setPickup: (value: string) => void;
  run: (key: string, action: () => Promise<void>) => Promise<void>;
  setNotice: (value: string) => void;
  locationLabel: (location: string) => string;
}) {
  const navigate = useNavigate();
  const [proof, setProof] = useState<{ status: string; expiresAt?: number }>(),
    [proofError, setProofError] = useState('');
  const loadProof = useCallback(async () => {
    setProofError('');
    try {
      setProof(await deliveryIdentity(offer.offerId, { action: 'status' }));
    } catch (cause) {
      if (/not found|not requested|request company identity first/i.test((cause as Error).message))
        setProof({ status: 'NOT_REQUESTED' });
      else setProofError(reportError(cause, 'Company evidence status is unavailable.'));
    }
  }, [offer.offerId]);
  useEffect(() => {
    void loadProof();
  }, [loadProof, offer.status]);
  const gate = custodyProofGate(proof?.status, Number(proof?.expiresAt ?? 0));
  const deciding = receiver && ['REQUESTED', 'ACCEPTED'].includes(offer.status);
  // Until the handoff, the Distributor can still change the arrangement (e.g. a late pickup).
  const rearranging = receiver && offer.status === 'SCHEDULED' && !offer.shipmentId;
  // Re-check time rules while the form is open, so a pickup time that passes shows its message.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!deciding && !rearranging) return;
    const timer = setInterval(() => setTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [deciding, rearranging]);
  const atLocal = (seconds?: number) => (seconds ? local(seconds * 1000 - Date.now()) : '');
  const [vehicle, setVehicle] = useState(offer.vehicle ?? ''),
    [eta, setEta] = useState(atLocal(offer.expectedAt));
  useEffect(() => {
    if (offer.pickupAt) setPickup(atLocal(offer.pickupAt));
  }, [offer.offerId, offer.pickupAt]);
  const terminal = offer.status === 'REJECTED' || offer.status === 'EXPIRED';
  const done = inShipment(offer);
  const steps = [
    { actor: offer.senderName, icon: <Send size={30} />, label: 'Offer sent' },
    {
      actor: offer.distributorName,
      icon: <ClipboardCheck size={30} />,
      label: 'Accepted · pickup arranged',
    },
  ].map((step, index) => ({
    ...step,
    state:
      index === 0 || done
        ? ('complete' as const)
        : !terminal
          ? ('current' as const)
          : ('pending' as const),
  }));
  // Same rules as the server; each is explained under the field instead of a silent grey button.
  const pickupError = !pickup
    ? undefined
    : !(Date.parse(pickup) > Date.now())
      ? 'This time has passed. Choose a pickup time in the future.'
      : Date.parse(pickup) >= offer.expiresAt * 1000
        ? `Choose a pickup before the offer expires on ${new Date(offer.expiresAt * 1000).toLocaleString()}.`
        : undefined;
  const pickupValid = !!pickup && !pickupError;
  const vehicleError =
    vehicle && !/^(?=.*[A-Z0-9])[A-Z0-9 -]{2,32}$/.test(vehicle)
      ? 'Use 2–32 letters, numbers, spaces or hyphens.'
      : undefined;
  const etaError =
    eta && pickup && !(Date.parse(eta) > Date.parse(pickup))
      ? 'Choose a time after the pickup.'
      : undefined;
  const arrangementValid = pickupValid && !!vehicle && !!eta && !vehicleError && !etaError;
  const evidenceHref = custodyEvidencePath(role, offer.offerId, receiver);
  const requested = !!gate && gate.status !== 'NOT_REQUESTED';
  // Speak to the viewer: an instruction on their turn, a waiting message otherwise.
  const nextAction = done
    ? `Custody offer complete. ${
        offer.status === 'SCHEDULED'
          ? receiver
            ? `Pickup and handoff continue in Shipments; ${offer.senderName} confirms the handoff.`
            : 'Print the label and confirm the handoff in Shipments.'
          : offer.status === 'DISPATCHED'
            ? receiver
              ? 'Confirm warehouse receipt in Shipments.'
              : `In transit. ${offer.distributorName} confirms receipt in Shipments.`
            : 'Warehouse receipt is recorded in Shipments.'
      }`
    : offer.status === 'REQUESTED'
      ? receiver
        ? !gate
          ? 'Checking company evidence…'
          : gate.canAccept
            ? 'Choose the pickup time, then accept, or reject the offer.'
            : gate.canReject
              ? 'The company evidence was declined or failed verification. You can reject this offer.'
              : 'Accept and reject become available after the requested company evidence is verified.'
        : `Waiting for ${offer.distributorName} to accept with a pickup time, or reject.`
      : offer.status === 'ACCEPTED'
        ? receiver
          ? 'Choose the pickup time for this stock.'
          : `Waiting for ${offer.distributorName} to arrange the pickup time.`
        : offer.status === 'REJECTED'
          ? 'This custody offer was rejected. No stock moved.'
          : 'This custody offer expired before pickup was arranged. No stock moved.';
  const NextIcon = done
    ? CheckCircle2
    : offer.status === 'REQUESTED'
      ? Hourglass
      : offer.status === 'ACCEPTED'
        ? CalendarClock
        : offer.status === 'REJECTED'
          ? XCircle
          : Clock3;

  return (
    <div className="workspace-custody-detail">
      <Alert
        type="info"
        message={
          terminal
            ? 'No stock moved for this custody offer.'
            : 'Stock moves only after the physical handoff is confirmed in Shipments.'
        }
      />
      <Card>
        <div className="workspace-custody-detail__item">
          <Package size={30} aria-hidden="true" />
          <h3>{offer.itemName}</h3>
          <Badge label={statusLabel[offer.status]} variant={statusVariant[offer.status]} />
        </div>
        <StatusTimeline label="Custody offer progress" steps={steps} variant="custody" />
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
              {offer.pickupAt && (
                <div>
                  <dt>Pickup vehicle</dt>
                  <dd>{offer.vehicle ?? 'Not arranged yet'}</dd>
                </div>
              )}
              {offer.pickupAt && (
                <div>
                  <dt>Expected warehouse arrival</dt>
                  <dd>
                    {offer.expectedAt
                      ? new Date(offer.expectedAt * 1000).toLocaleString()
                      : 'Not arranged yet'}
                  </dd>
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
            <section className="workspace-pickup-plan" aria-label="Company evidence">
              <h4>
                <ShieldCheck size={18} />
                Company evidence
                {gate && (
                  <Badge
                    label={gate.expired ? 'Expired' : proofStatusLabel(gate.status)}
                    variant={gate.expired ? 'rejected' : proofStatusVariant(gate.status)}
                  />
                )}
              </h4>
              {proofError ? (
                <Alert type="error" message={proofError} />
              ) : !gate ? (
                <LoadingIndicator size="small" label="Checking company evidence…" />
              ) : gate.expired ? (
                <Alert
                  type="warning"
                  message={
                    receiver
                      ? 'The company identity request has expired. Request it again, or accept or reject without it.'
                      : 'The company identity request has expired.'
                  }
                />
              ) : null}
              {gate && (requested || deciding) && (
                <Link className="workspace-custody-detail__evidence-link" to={evidenceHref}>
                  {!requested
                    ? 'Request sender company evidence'
                    : deciding && gate.expired
                      ? 'Request company evidence again'
                      : 'View in Evidence Exchange'}
                </Link>
              )}
            </section>
            {(deciding || rearranging) && (
              <section className="workspace-pickup-plan" aria-label="Pickup arrangement">
                <h4>
                  <CalendarClock size={18} />
                  {offer.status === 'REQUESTED'
                    ? 'Accept with pickup arrangement'
                    : offer.status === 'ACCEPTED'
                      ? 'Arrange pickup'
                      : 'Update pickup arrangement'}
                </h4>
                <Input
                  label="Planned custody pickup"
                  type="datetime-local"
                  value={pickup}
                  onChange={setPickup}
                  required
                  disabled={!gate?.canAccept}
                  min={local()}
                  max={local(offer.expiresAt * 1000 - Date.now())}
                  error={pickupError}
                />
                <Input
                  label="Pickup vehicle registration"
                  value={vehicle}
                  onChange={(value) => setVehicle(value.toUpperCase())}
                  maxLength={32}
                  required
                  disabled={!gate?.canAccept}
                  error={vehicleError}
                />
                <Input
                  label="Expected warehouse arrival"
                  type="datetime-local"
                  value={eta}
                  onChange={setEta}
                  required
                  disabled={!gate?.canAccept}
                  min={pickup || local()}
                  error={etaError}
                  hint="Shared with the sender. The handoff time is recorded when the sender confirms it."
                />
                <div className="workspace-decision-actions">
                  {offer.status === 'REQUESTED' && (
                    <Btn
                      variant="danger"
                      loading={busy === 'reject'}
                      disabled={!!busy || !gate?.canReject}
                      onClick={() =>
                        void run('reject', async () => {
                          await actCustodyOffer(offer.offerId, { action: 'reject' });
                          setNotice('Custody offer rejected. No stock moved.');
                        })
                      }
                    >
                      {busy === 'reject' ? 'Rejecting…' : 'Reject offer'}
                    </Btn>
                  )}
                  <Btn
                    loading={busy === 'accept'}
                    disabled={!!busy || !gate?.canAccept || !arrangementValid}
                    onClick={() =>
                      void run('accept', async () => {
                        await actCustodyOffer(offer.offerId, {
                          action: offer.status === 'REQUESTED' ? 'accept' : 'schedule',
                          pickupAt: Math.floor(Date.parse(pickup) / 1000),
                          vehicle: vehicle.trim(),
                          expectedAt: Math.floor(Date.parse(eta) / 1000),
                        });
                        setNotice(
                          rearranging
                            ? 'Pickup arrangement updated and shared with the sender.'
                            : 'Pickup arranged. The custody offer is complete; handoff and receipt continue in Shipments.',
                        );
                      })
                    }
                  >
                    {busy === 'accept'
                      ? 'Saving…'
                      : offer.status === 'REQUESTED'
                        ? 'Accept with pickup arrangement'
                        : offer.status === 'ACCEPTED'
                          ? 'Confirm pickup'
                          : 'Update pickup arrangement'}
                  </Btn>
                </div>
              </section>
            )}
            {done && (
              <div className="action-row">
                <Btn
                  icon={<Truck size={16} />}
                  onClick={() => navigate(custodyShipmentPath(role, offer))}
                >
                  Open shipment
                </Btn>
              </div>
            )}
          </section>
        </div>
        <div className="workspace-custody-detail__technical">
          <TechnicalDetails
            fields={[
              { label: 'Custody offer', value: offer.offerId },
              { label: 'Batch', value: offer.batchId },
              { label: 'Source location', value: offer.fromLocation },
              { label: 'Warehouse location', value: offer.toLocation },
              ...(offer.shipmentId ? [{ label: 'Shipment', value: offer.shipmentId }] : []),
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
  const navigate = useNavigate();
  const [data, setData] = useState<OrdersState>(),
    [offers, setOffers] = useState<CustodyOffer[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [batch, setBatch] = useState(''),
    [from, setFrom] = useState(''),
    [warehouse, setWarehouse] = useState(''),
    [quantity, setQuantity] = useState(''),
    [deadline, setDeadline] = useState(''),
    [pickup, setPickup] = useState('');
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
  // The key names the running action, so only its button shows the spinner.
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      await load();
    } catch (cause) {
      setError(reportError(cause, 'The custody offer could not be updated.'));
    } finally {
      setBusy('');
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
              loading={busy === 'refresh'}
              disabled={loading || !!busy}
              onClick={() => void run('refresh', async () => {})}
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
              loading={busy === 'refresh'}
              disabled={loading || !!busy}
              onClick={() => void run('refresh', async () => {})}
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
      ) : selected && data ? (
        <CustodyRequestDetail
          offer={selected}
          role={role}
          receiver={receiver}
          busy={busy}
          pickup={pickup}
          setPickup={setPickup}
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
                  loading={busy === 'create'}
                  disabled={
                    !!busy ||
                    !batch ||
                    !from ||
                    !chosenWarehouse ||
                    !/^[1-9]\d*$/.test(quantity) ||
                    !(Date.parse(deadline) > Date.now()) ||
                    (!!batchExpiresAt && Date.parse(deadline) >= batchExpiresAt * 1000)
                  }
                  onClick={() =>
                    void run('create', async () => {
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
                  {busy === 'create' ? 'Sending…' : 'Send custody offer'}
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
                          if (inShipment(offer)) navigate(custodyShipmentPath(role, offer));
                          else {
                            setParams({ offerId: offer.offerId });
                            setPickup('');
                          }
                        }}
                      >
                        {isMyTurn(offer, receiver)
                          ? 'Take action'
                          : inShipment(offer)
                            ? 'Open shipment'
                            : 'View offer'}
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
