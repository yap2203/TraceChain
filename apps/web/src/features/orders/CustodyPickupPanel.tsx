import { useState } from 'react';
import { CalendarClock, Handshake, Send } from 'lucide-react';
import { encodeShipmentQr } from '@tracechain/shared';
import { reportError, notify } from '../../components/ui/feedback';
import { Alert, Badge, Btn, Card, TechnicalDetails } from '../workspaces/shared/ui';
import { ProductQrDisplay } from '../product-traceability/ProductQrDisplay';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import { prepareCustodyOffer, type CustodyOffer, type OrdersState } from './orders.api';

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Shipment label QR for an offer, from "pickup arranged" on (planned ID until the handoff records it). */
export function custodyShipmentQr(offer: CustodyOffer, data?: OrdersState) {
  const shipmentId = offer.shipmentId ?? offer.plannedShipmentId;
  if (
    !shipmentId ||
    !['SCHEDULED', 'DISPATCHED', 'RECEIVED'].includes(offer.status) ||
    !data?.chainId ||
    !data.ordersAddress ||
    !import.meta.env.VITE_PUBLIC_APP_URL
  )
    return undefined;
  try {
    return encodeShipmentQr({
      shipmentId: shipmentId as `0x${string}`,
      kind: offer.kind === 1 ? 'ingredient' : 'product',
      chainId: data.chainId,
      ordersAddress: data.ordersAddress as `0x${string}`,
      publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL,
    });
  } catch {
    return undefined; // The shipment screen reports locator errors.
  }
}

/**
 * The shipment stage of a custody offer whose pickup is arranged but not yet handed off:
 * the sender prints the label and confirms the handoff; the Distributor waits for pickup.
 */
export function CustodyPickupPanel({
  offer,
  data,
  onChanged,
}: {
  offer: CustodyOffer;
  data: OrdersState;
  onChanged: () => Promise<void>;
}) {
  const sender = same(offer.sender, data.actor);
  // The Distributor arranges vehicle and arrival with the pickup; the sender never enters them.
  const missingArrangement = !offer.vehicle || !offer.expectedAt;
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const qr = custodyShipmentQr(offer, data);
  // The server records the handoff at confirmation, so a passed arrival can no longer be used.
  const arrivalPassed = !!offer.expectedAt && offer.expectedAt <= Date.now() / 1000;
  const ready = confirmed && !missingArrangement && !arrivalPassed;
  const handoff = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const prepared = await prepareCustodyOffer(offer.offerId);
      await submitProductionTransaction(prepared.transaction, data.actor);
      setConfirmed(false);
      notify(
        'Handoff recorded. The Distributor scans the label at its warehouse to confirm receipt.',
        'success',
      );
      // Chain events count after the confirmation window; refresh once it passes.
      setTimeout(() => void onChanged().catch(() => undefined), 30_000);
      await onChanged();
    } catch (cause) {
      setError(reportError(cause, 'The handoff could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    // Same section spacing as the custody offer detail.
    <div className="workspace-custody-detail">
      <Card>
        <div className="workspace-custody-detail__item">
          <Handshake size={30} aria-hidden="true" />
          <h3>{offer.itemName}</h3>
          <Badge label="Waiting for pickup" variant="pending" />
        </div>
        <dl className="workspace-custody-detail__facts workspace-custody-detail__facts--wide">
          <div>
            <dt>Quantity</dt>
            <dd>
              {offer.quantity} {offer.unit}
            </dd>
          </div>
          <div>
            <dt>Planned pickup</dt>
            <dd>{offer.pickupAt ? new Date(offer.pickupAt * 1000).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt>Pickup vehicle</dt>
            <dd>{offer.vehicle ?? 'Not arranged yet'}</dd>
          </div>
          <div>
            <dt>Expected warehouse arrival</dt>
            <dd>
              {offer.expectedAt
                ? new Date(offer.expectedAt * 1000).toLocaleString()
                : 'Not arranged yet'}
            </dd>
          </div>
          <div>
            <dt>{sender ? 'Distributor' : 'Sender'}</dt>
            <dd>{sender ? offer.distributorName : offer.senderName}</dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>
              {offer.fromLocationName ?? 'Pickup location'} → {offer.toLocationName ?? 'Warehouse'}
            </dd>
          </div>
        </dl>
        {error && <Alert type="error" message={error} />}
        {offer.shipmentId ? (
          // Prepared and signed; the offer moves to the shipment once the chain confirms it.
          <Alert
            type="info"
            message="Handoff submitted. The shipment opens here once the chain confirms it. Do not submit the handoff again."
          />
        ) : !sender ? (
          <div className="workspace-custody-detail__next-copy">
            <span aria-hidden="true">
              <CalendarClock size={22} />
            </span>
            <p>
              At pickup, check the TraceChain label on the goods. {offer.senderName} then confirms
              the handoff, and this shipment opens for warehouse receipt.
            </p>
          </div>
        ) : (
          <>
            {qr && (
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
            <section
              className="workspace-custody-detail__handoff workspace-flow-page"
              aria-label="Physical handoff confirmation"
            >
              <h4>{qr ? 'Step 2 · ' : ''}Confirm the handoff at pickup</h4>
              {missingArrangement ? (
                <Alert
                  type="warning"
                  message={`${offer.distributorName} has not arranged the pickup vehicle and expected arrival yet. They add them with "Update pickup arrangement" on the custody offer.`}
                />
              ) : arrivalPassed ? (
                <Alert
                  type="warning"
                  message={`The planned warehouse arrival has passed. Ask ${offer.distributorName} to update the pickup arrangement before confirming the handoff.`}
                />
              ) : null}
              <p>The handoff time is recorded when you confirm.</p>
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
                  loading={busy}
                  disabled={!ready}
                  onClick={() => void handoff()}
                >
                  {busy ? 'Confirming…' : 'Confirm handoff with MetaMask'}
                </Btn>
              </div>
            </section>
          </>
        )}
        <TechnicalDetails
          fields={[
            { label: 'Custody offer', value: offer.offerId },
            { label: 'Batch', value: offer.batchId },
            ...(offer.plannedShipmentId
              ? [{ label: 'Planned shipment', value: offer.plannedShipmentId }]
              : []),
          ]}
        />
      </Card>
    </div>
  );
}
