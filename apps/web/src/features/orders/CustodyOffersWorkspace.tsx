import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, Inbox, Package, RefreshCw, Send } from 'lucide-react';
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
  const stage = selected
    ? ['REQUESTED', 'ACCEPTED', 'SCHEDULED', 'DISPATCHED', 'RECEIVED'].indexOf(selected.status)
    : -1;
  const visible = offers.filter(
    (offer) => data && same(receiver ? offer.distributor : offer.sender, data.actor),
  );
  const label = (location: string) =>
    data?.locations.find((site) => same(site.location, location))?.label ??
    warehouses.find((site) => same(site.location, location))?.name ??
    'Registered company location';
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
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {loading ? (
        <LoadingIndicator page label="Loading custody requests…" />
      ) : selected && data ? (
        <>
          <Btn variant="outline" onClick={() => setParams({})}>
            Back to custody requests
          </Btn>
          <Card>
            <SectionTitle
              title={selected.itemName}
              action={
                <Badge
                  label={statusLabel[selected.status]}
                  variant={
                    selected.status === 'RECEIVED'
                      ? 'verified'
                      : selected.status === 'REJECTED'
                        ? 'rejected'
                        : 'pending'
                  }
                />
              }
            />
            <ol className="custody-offer-progress" aria-label="Custody request progress">
              {[
                'Offer sent',
                'Distributor accepts',
                'Pickup arranged',
                'Physical handoff',
                'Warehouse received',
              ].map((label, index) => (
                <li key={label} aria-current={stage === index ? 'step' : undefined}>
                  <span>{index + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            <dl className="workspace-offer-facts">
              <div>
                <dt>Quantity</dt>
                <dd>
                  {selected.quantity} {selected.unit}
                </dd>
              </div>
              <div>
                <dt>Sender</dt>
                <dd>{selected.senderName}</dd>
              </div>
              <div>
                <dt>Distributor</dt>
                <dd>{selected.distributorName}</dd>
              </div>
              <div>
                <dt>Route</dt>
                <dd>
                  {selected.fromLocationName ?? label(selected.fromLocation)} →{' '}
                  {selected.toLocationName ?? label(selected.toLocation)}
                </dd>
              </div>
              <div>
                <dt>Request expiry</dt>
                <dd>{new Date(selected.expiresAt * 1000).toLocaleString()}</dd>
              </div>
              {selected.pickupAt && (
                <div>
                  <dt>Planned pickup</dt>
                  <dd>{new Date(selected.pickupAt * 1000).toLocaleString()}</dd>
                </div>
              )}
            </dl>
            {['REQUESTED', 'ACCEPTED', 'SCHEDULED'].includes(selected.status) && (
              <Link
                to={
                  workspacePath(role, receiver ? 'sent-requests' : 'requests') +
                  '?' +
                  new URLSearchParams({ context: 'custody', referenceId: selected.offerId })
                }
              >
                {receiver
                  ? 'Request or verify sender company evidence'
                  : 'Manage requested company evidence'}
              </Link>
            )}
            {receiver && selected.status === 'REQUESTED' && (
              <div className="workspace-location-actions">
                <Btn
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await actCustodyOffer(selected.offerId, { action: 'accept' });
                      setNotice('Offer accepted. Arrange the pickup time next.');
                    })
                  }
                >
                  Accept custody offer
                </Btn>
                <Btn
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await actCustodyOffer(selected.offerId, { action: 'reject' });
                      setNotice('Custody offer rejected. No stock moved.');
                    })
                  }
                >
                  Reject offer
                </Btn>
              </div>
            )}
            {receiver &&
              ['ACCEPTED', 'SCHEDULED'].includes(selected.status) &&
              !selected.shipmentId && (
                <section className="workspace-pickup-plan">
                  <h4>
                    <CalendarClock size={18} />
                    Arrange pickup
                  </h4>
                  <div className="workspace-profile-form">
                    <Input
                      label="Planned custody pickup"
                      type="datetime-local"
                      value={pickup}
                      onChange={setPickup}
                      required
                      min={local()}
                      max={local(selected.expiresAt * 1000 - Date.now())}
                    />
                    <Btn
                      disabled={
                        busy ||
                        !(
                          Date.parse(pickup) > Date.now() &&
                          Date.parse(pickup) < selected.expiresAt * 1000
                        )
                      }
                      onClick={() =>
                        void run(async () => {
                          await actCustodyOffer(selected.offerId, {
                            action: 'schedule',
                            pickupAt: Math.floor(Date.parse(pickup) / 1000),
                          });
                          setNotice('Pickup time shared with the sender.');
                        })
                      }
                    >
                      {selected.pickupAt ? 'Update pickup time' : 'Confirm pickup time'}
                    </Btn>
                  </div>
                </section>
              )}
            {!receiver && ['REQUESTED', 'ACCEPTED'].includes(selected.status) && (
              <p className="workspace-list-guidance">
                {selected.status === 'REQUESTED'
                  ? 'Waiting for the Distributor’s decision.'
                  : 'The Distributor will arrange the pickup time next.'}
              </p>
            )}
            {!receiver && selected.status === 'SCHEDULED' && (
              <section className="delivery-action-section workspace-flow-page">
                <h3>Confirm physical handoff at pickup</h3>
                <Input
                  label="Pickup vehicle registration"
                  value={vehicle}
                  onChange={(value) => setVehicle(value.toUpperCase())}
                  maxLength={32}
                  required
                />
                <div className="workspace-profile-form">
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
                </div>
                <label className="flex items-start gap-[8px]">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  The goods were physically handed to this Distributor.
                </label>
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
                      const prepared = await prepareCustodyOffer(selected.offerId, {
                        vehicle,
                        occurredAt: Math.floor(Date.parse(actual) / 1000),
                        expectedAt: Math.floor(Date.parse(eta) / 1000),
                      });
                      await submitProductionTransaction(prepared.transaction, data.actor);
                      setConfirmed(false);
                      setNotice(
                        'Physical handoff recorded. The Distributor scans receipt at its warehouse.',
                      );
                    })
                  }
                >
                  Confirm handoff with MetaMask
                </Btn>
              </section>
            )}
            {selected.shipmentId && ['DISPATCHED', 'RECEIVED'].includes(selected.status) && (
              <Link
                to={
                  workspacePath(role, receiver ? 'arrivals' : 'shipments') +
                  '?shipmentId=' +
                  encodeURIComponent(selected.shipmentId)
                }
              >
                {receiver ? 'Open warehouse arrival & scan receipt' : 'Track this shipment'}
              </Link>
            )}
            {!receiver && qr && (
              <ProductQrDisplay
                batchId={selected.batchId}
                batchReference={selected.itemName}
                productName={selected.itemName}
                labelTitle="Custody Shipment QR"
                encodedPayload={qr}
                instruction="Attach this label to the goods. The Distributor scans it at warehouse receipt."
              />
            )}
            {!receiver &&
              !qr &&
              selected.shipmentId &&
              ['DISPATCHED', 'RECEIVED'].includes(selected.status) && (
                <Alert
                  type="info"
                  message="The shipment is recorded, but its QR label is unavailable. Open shipment tracking to check the configured QR URL before warehouse receipt."
                />
              )}
            <TechnicalDetails
              fields={[
                { label: 'Custody request', value: selected.offerId },
                { label: 'Batch', value: selected.batchId },
                { label: 'Source location', value: selected.fromLocation },
                { label: 'Warehouse location', value: selected.toLocation },
              ]}
            />
          </Card>
        </>
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
                <SelectField
                  label="Pickup location"
                  value={from}
                  onChange={setFrom}
                  options={[
                    { value: '', label: 'Select your registered location' },
                    ...sites.map((site) => ({
                      value: site.location,
                      label: site.label ?? 'Registered location',
                    })),
                  ]}
                />
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
