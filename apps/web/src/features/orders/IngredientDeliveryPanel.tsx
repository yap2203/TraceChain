import { reportError } from '../../components/ui/feedback';
import { useEffect, useRef, useState } from 'react';
import { PackageCheck, ScanQrCode, Truck } from 'lucide-react';
import { decodeIngredientDeliveryQr } from '@tracechain/shared';
import { ProductQrDisplay } from '../product-traceability/ProductQrDisplay';
import {
  ZxingTransferQrReader,
  cameraErrorMessage,
  qrImageErrorMessage,
  type TransferQrReader,
} from '../custody-transfers/qr-reader';
import { Alert, Btn, Input, SelectField, StatusTimeline } from '../workspaces/shared/ui';
import { prepareOrder, prepareLogistics, type OrdersState, type OrderRecord } from './orders.api';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import { workspacePath } from '../workspaces/workspace-paths';
import { PickupPlanPanel } from './PickupPlanPanel';
import { DeliveryIdentityPanel } from './DeliveryIdentityPanel';

const labels = [
  'Not scheduled',
  'Awaiting Distributor request',
  'Distributor requested',
  'Distributor accepted',
  'In transit to Manufacturer',
  'Received by Manufacturer',
  'Cancelled',
];
const date = (value: unknown) =>
  Number(value) ? new Date(Number(value) * 1000).toLocaleString() : 'Not recorded';
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function IngredientDeliveryPanel({
  data,
  order,
  item,
  onChanged,
  initialQr = '',
  reader,
}: {
  data: OrdersState;
  order: OrderRecord;
  item?: OrderRecord;
  onChanged: () => Promise<void>;
  initialQr?: string;
  reader?: TransferQrReader;
}) {
  const [clock, setClock] = useState(Date.now());
  const delivery = order.delivery;
  const stage =
    Number(delivery?.stage) === 1 && clock / 1000 >= Number(delivery.assignmentDeadline)
      ? 6
      : Number(delivery?.stage ?? 0);
  const supplier = same(data.actor, order.seller),
    distributor = same(data.actor, delivery?.distributor),
    manufacturer = same(data.actor, order.buyer);
  const [selected, setSelected] = useState(''),
    [scanned, setScanned] = useState('');
  const [custodyPosition, setCustodyPosition] = useState('');
  const [pickupReady, setPickupReady] = useState(false);
  const [requestEvidence, setRequestEvidence] = useState(false);
  const [location, setLocation] = useState(
    order.deliveryReceivingLocation ?? order.details?.receivingLocation ?? '',
  );
  const [quantity, setQuantity] = useState(''),
    [occurredAt, setOccurredAt] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const busyRef = useRef(false),
    video = useRef<HTMLVideoElement>(null),
    stop = useRef<() => void>(undefined),
    cameraAttempt = useRef(0);
  const qrReader = useRef(reader ?? new ZxingTransferQrReader());
  const printableLabel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (supplier && stage === 1 && order.deliveryQr) {
      printableLabel.current?.focus({ preventScroll: true });
      printableLabel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [supplier, stage, order.deliveryQr]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      cameraAttempt.current++;
      stop.current?.();
    };
  }, []);
  const validate = (value: string) => {
    try {
      decodeIngredientDeliveryQr(value, {
        orderId: order.orderId,
        chainId: data.chainId!,
        ordersAddress: data.ordersAddress!,
        publicAppUrl: import.meta.env.VITE_PUBLIC_APP_URL,
      });
      setScanned(value);
      setConfirmed(false);
      setError('');
      stop.current?.();
    } catch (cause) {
      setScanned('');
      setError(reportError(cause, 'Invalid delivery QR.'));
    }
  };
  useEffect(() => {
    if (initialQr) validate(initialQr);
  }, [initialQr, order.orderId, data.chainId, data.ordersAddress]);
  useEffect(() => {
    setConfirmed(false);
  }, [stage]);
  const run = async (input: Record<string, unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let submitted = false;
    try {
      const prepare = input.action === 'arrange-from-custody' ? prepareLogistics : prepareOrder;
      const prepared = await prepare({
        ...input,
        orderId: order.orderId,
        operationId: crypto.randomUUID(),
      });
      await submitProductionTransaction(prepared.transaction, data.actor);
      submitted = true;
      setConfirmed(false);
      setNotice('Delivery action confirmed on-chain.');
      await onChanged();
    } catch (cause) {
      setError(
        submitted
          ? 'Confirmed, but refresh failed. Refresh tracking; do not submit again.'
          : reportError(cause, 'Delivery action failed.'),
      );
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };
  if (!delivery || stage === 0) return null;
  const remaining = BigInt(order.requested) - BigInt(order.approvedReceivedQuantity ?? '0');
  const time = Math.floor(Date.parse(occurredAt) / 1000);
  const validTime =
    Number.isFinite(time) &&
    time <= clock / 1000 &&
    time >= Number(distributor ? delivery.acceptedAt : delivery.pickedUpAt);
  const canScan = (distributor && stage === 3) || (manufacturer && stage === 4);
  const proofBlocksPickup =
    distributor &&
    !!delivery.identityChallenge &&
    !/^0x0+$/.test(delivery.identityChallenge) &&
    (!delivery.identityCredentialHash ||
      /^0x0+$/.test(delivery.identityCredentialHash) ||
      Number(delivery.identityValidUntil) <= clock / 1000);
  const locations = data.locations.filter((entry) => same(entry.company, data.actor));
  const custodyOptions = (data.logistics?.positions ?? []).filter(
    (entry) =>
      same(entry.supplier, data.actor) &&
      same(entry.batchId, order.requestedBatch ?? item?.batches?.[0]) &&
      entry.orderable &&
      BigInt(entry.available) >= BigInt(order.requested),
  );
  const receivingLocation = order.deliveryReceivingLocation ?? order.details?.receivingLocation;
  return (
    <section
      aria-label="Ingredient delivery tracking"
      className="delivery-panel grid min-w-0 gap-[16px] rounded-xl border border-[var(--c-border)] p-[16px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-[12px]">
        <h3 className="m-0">Ingredient delivery</h3>
        <strong role="status">{labels[stage]}</strong>
      </div>
      <StatusTimeline
        label="Supplier to Distributor to Manufacturer"
        variant="arrival"
        steps={[
          [
            'Supplier',
            order.sellerName ?? 'Registered Supplier',
            stage > 0 && stage !== 6,
            stage < 4 ? 'Preparing ingredient label and delivery' : 'Handed to Distributor',
          ],
          [
            'Distributor',
            delivery.distributorName ?? (stage === 1 ? 'Not selected yet' : 'Assigned Distributor'),
            stage >= 3 && stage !== 6,
            stage === 2
              ? 'Reviewing delivery request'
              : stage >= 4
                ? 'Pickup recorded'
                : 'Awaiting pickup',
          ],
          [
            'Manufacturer',
            order.buyerName ?? 'Registered Manufacturer',
            stage === 5,
            stage === 5 ? 'Receipt confirmed' : 'Awaiting physical delivery',
          ],
        ].map(([roleName, name, done, detail], index) => ({
          label: String(roleName),
          actor: String(name),
          detail: String(detail),
          icon: index === 1 ? <Truck size={22} /> : <PackageCheck size={22} />,
          state: done
            ? ('complete' as const)
            : stage !== 6 && (stage === 1 ? index === 0 : stage <= 3 ? index === 1 : index === 2)
              ? ('current' as const)
              : ('pending' as const),
        }))}
      />
      <p className="m-0">
        {item?.name ?? 'Registered ingredient'} · {order.requested} {item?.unit} · Received:{' '}
        {order.approvedReceivedQuantity ?? '0'} {item?.unit}
      </p>
      {receivingLocation && (
        <p>
          Requested receiving location:{' '}
          {data.locations.find((entry) => same(entry.location, receivingLocation))?.label ??
            'Manufacturer receiving location'}
          .
        </p>
      )}
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {stage === 6 ? (
        <Alert
          type="warning"
          message="Delivery cancelled: no Distributor was requested before the deadline, the request expired before pickup, or the order was closed. No stock was credited."
        />
      ) : stage === 1 ? (
        <p className="m-0">
          Request a Distributor by <strong>{date(delivery.assignmentDeadline)}</strong> (48 hours
          after approval, capped by request expiry). A Distributor decline does not restart this
          deadline.
        </p>
      ) : stage === 2 ? (
        <p>Waiting for the assigned Distributor to accept or decline this delivery.</p>
      ) : stage === 3 ? (
        <p>
          Delivery accepted. The Distributor must collect the goods and scan the package label to
          record pickup.
        </p>
      ) : stage === 4 ? (
        <p>
          The Distributor has collected these goods. The Manufacturer scans the label when they
          physically arrive.
        </p>
      ) : (
        <p>Delivery completed. Confirmed stock is available to the Manufacturer for production.</p>
      )}
      {supplier && stage === 1 && (
        <section
          className="grid gap-[12px] rounded-lg border border-[var(--c-border)] p-[16px]"
          aria-label="Choose delivery mode"
        >
          <h4>Option 1 · Use warehouse stock</h4>
          <p>Deliver from a Distributor with enough received, unreserved stock.</p>
          <SelectField
            label="Custody stock for this order"
            value={custodyPosition}
            onChange={setCustodyPosition}
            options={[
              { value: '', label: 'Select sufficient received custody stock' },
              ...custodyOptions.map((entry) => ({
                value: entry.positionId,
                label: `${entry.warehouseName ?? entry.distributorName ?? 'Distributor warehouse'} · ${entry.available} ${entry.unit} available`,
              })),
            ]}
          />
          {!custodyOptions.length && (
            <p>
              No warehouse has enough unreserved stock for this exact batch. You can request direct
              delivery below.
            </p>
          )}
          {!receivingLocation && (
            <p>
              A receiving location is unavailable for this older request. Use the direct delivery
              flow.
            </p>
          )}
          {!data.fulfilmentSupported && (
            <p>Custody selection after approval requires the updated two-mode contract suite.</p>
          )}
          <div className="action-row">
            <Btn
              disabled={
                busy ||
                !data.fulfilmentSupported ||
                !receivingLocation ||
                !custodyOptions.some((entry) => entry.positionId === custodyPosition)
              }
              onClick={() =>
                void run({
                  action: 'arrange-from-custody',
                  positionId: custodyPosition,
                  receivingLocation,
                })
              }
            >
              Confirm delivery from custody
            </Btn>
          </div>
        </section>
      )}
      {supplier && stage === 1 && (
        <div className="delivery-action-section grid gap-[12px] sm:grid-cols-2">
          <h4 className="col-span-full">Option 2 · Arrange pickup from Supplier</h4>
          <SelectField
            label="Choose Distributor"
            value={selected}
            onChange={setSelected}
            options={[
              { value: '', label: 'Select an authorized delivery company' },
              ...(data.distributors ?? []).map((company) => ({
                value: company.wallet,
                label: company.companyName,
              })),
            ]}
          />
          <Btn
            disabled={busy || !selected}
            icon={<Truck size={16} />}
            onClick={() => void run({ action: 'delivery-assign', distributor: selected })}
          >
            Request Distributor
          </Btn>
          {!data.distributors?.length && (
            <p>No authorized Distributors are available. Register an active Distributor first.</p>
          )}
        </div>
      )}
      {supplier && stage !== 6 && order.deliveryQr && (
        <div ref={printableLabel} tabIndex={-1}>
          <Alert
            type="info"
            message="Print this label and attach it to the ingredient package. The Distributor and Manufacturer must scan the same label at handoff."
          />
          <ProductQrDisplay
            batchId={order.orderId}
            batchReference={item?.batchReference ?? 'Ingredient delivery'}
            productName={item?.name ?? 'Registered ingredient'}
            encodedPayload={order.deliveryQr}
            labelTitle="Ingredient Delivery QR"
            instruction="Attach to these ingredients. Distributor scans at pickup; Manufacturer scans before confirming receipt."
          />
        </div>
      )}
      {supplier && !order.deliveryQr && stage !== 6 && (
        <Alert
          type="warning"
          message="Set VITE_PUBLIC_APP_URL in the root environment and restart the API/web servers to print this delivery label."
        />
      )}
      {distributor && stage === 2 && (
        <div className="flex flex-wrap gap-[8px] action-row">
          <Btn
            variant="danger"
            disabled={busy}
            onClick={() => void run({ action: 'delivery-respond', accept: false })}
          >
            Decline delivery
          </Btn>
          <Btn
            disabled={busy}
            onClick={() => void run({ action: 'delivery-respond', accept: true })}
          >
            Accept delivery
          </Btn>
        </div>
      )}
      {distributor && stage === 3 && (
        <Btn
          variant="outline"
          disabled={busy}
          onClick={() => void run({ action: 'delivery-respond', accept: false })}
        >
          Withdraw before pickup
        </Btn>
      )}
      {(supplier || distributor) && [2, 3].includes(stage) && (
        distributor ? (
          <Btn variant="outline" onClick={() => setRequestEvidence(true)}>
            Request Supplier company evidence
          </Btn>
        ) : (
          <a
            href={
              workspacePath('supplier', 'requests') +
              '?context=delivery&referenceId=' +
              encodeURIComponent(order.orderId)
            }
          >
            Manage requested company evidence
          </a>
        )
      )}
      {requestEvidence && (
        <DeliveryIdentityPanel
          requestOnly
          requestContextLabel="ingredient delivery"
          data={data}
          order={order}
          onChanged={onChanged}
          requestedBy={delivery?.distributorName}
          onRequestClose={() => setRequestEvidence(false)}
        />
      )}
      {stage >= 3 && stage <= 4 && (
        <PickupPlanPanel
          referenceId={order.orderId}
          canArrange={distributor && stage === 3}
          expiresAt={Number(order.expiresAt)}
          onReady={setPickupReady}
        />
      )}
      {canScan && (!distributor || pickupReady) && (
        <section
          className="delivery-action-section grid gap-[12px]"
          aria-label="Scan delivery label"
        >
          {proofBlocksPickup && (
            <Alert
              type="warning"
              message="Supplier company evidence was requested. Receive and verify a current proof before confirming pickup. You may withdraw before pickup if the Supplier declines."
            />
          )}
          <h4>
            {distributor
              ? 'Scan and confirm ingredient pickup'
              : 'Scan and confirm ingredients received'}
          </h4>
          <video
            ref={video}
            muted
            playsInline
            className="max-h-[240px] w-full rounded-lg"
            aria-label="Delivery QR camera"
          />
          <div className="flex flex-wrap gap-[8px] action-row">
            <Btn
              variant="outline"
              onClick={() => {
                cameraAttempt.current++;
                stop.current?.();
              }}
            >
              Stop camera
            </Btn>
            <Btn
              icon={<ScanQrCode size={16} />}
              onClick={() => {
                stop.current?.();
                const attempt = ++cameraAttempt.current;
                void qrReader.current
                  .startCamera(video.current!, validate, (cause) =>
                    setError(cameraErrorMessage(cause)),
                  )
                  .then((cleanup) => {
                    if (attempt !== cameraAttempt.current) cleanup();
                    else stop.current = cleanup;
                  })
                  .catch((cause) => {
                    if (attempt === cameraAttempt.current) setError(cameraErrorMessage(cause));
                  });
              }}
            >
              Scan with camera
            </Btn>
          </div>
          <label>
            Upload a QR image
            <input
              aria-label="Upload delivery QR image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (
                  !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
                  file.size > 5 * 1024 * 1024
                ) {
                  setError('Choose a PNG, JPEG or WebP image up to 5 MB.');
                  return;
                }
                void qrReader.current
                  .decodeImage(file)
                  .then(validate)
                  .catch((cause) => setError(qrImageErrorMessage(cause)));
              }}
            />
          </label>
          {scanned && (
            <Alert
              type="success"
              message="Label matches this request, network and registry. Review the actual goods before confirming with MetaMask."
            />
          )}
          {manufacturer && (
            <>
              <SelectField
                label="Receiving / production location"
                value={location}
                onChange={setLocation}
                options={[
                  { value: '', label: 'Select your receiving location' },
                  ...locations.map((entry) => ({
                    value: entry.location,
                    label: entry.label ?? 'Registered location',
                  })),
                ]}
              />
              {!locations.length && (
                <a href={workspacePath('manufacturer', 'profile')}>
                  Add a receiving location in Profile
                </a>
              )}
              <Input
                label={`Quantity physically received (${item?.unit ?? 'registered unit'})`}
                value={quantity}
                onChange={setQuantity}
                type="number"
                min="1"
                max={remaining.toString()}
                step="1"
              />
            </>
          )}
          <Input
            label={distributor ? 'Actual pickup date and time' : 'Actual receipt date and time'}
            type="datetime-local"
            step="1"
            value={occurredAt}
            onChange={setOccurredAt}
          />
          <label className="flex items-start gap-[8px]">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {distributor
              ? 'I physically collected these ingredients from the Supplier.'
              : 'These ingredients physically arrived at my receiving location.'}
          </label>
          <div className="action-row">
            <Btn
              disabled={
                busy ||
                proofBlocksPickup ||
                (distributor && !pickupReady) ||
                !scanned ||
                !confirmed ||
                !validTime ||
                (manufacturer &&
                  (!location ||
                    !/^[1-9]\d*$/.test(quantity) ||
                    BigInt(quantity || '0') > remaining))
              }
              onClick={() =>
                void run(
                  distributor
                    ? { action: 'delivery-pickup', qrPayload: scanned, occurredAt: time }
                    : {
                        action: 'approved-receipt',
                        qrPayload: scanned,
                        location,
                        quantity,
                        occurredAt: time,
                      },
                )
              }
            >
              {distributor ? 'Confirm pickup with MetaMask' : 'Confirm receipt with MetaMask'}
            </Btn>
          </div>
        </section>
      )}
      {stage >= 4 && stage !== 6 && (
        <p>
          Pickup: {date(delivery.pickedUpAt)} · Manufacturer receipt: {date(delivery.deliveredAt)}.
          Only confirmed received quantities are usable for production.
        </p>
      )}
      <small>
        Tracking records signed company actions; the QR alone cannot establish the identity or
        condition of physical goods.
      </small>
    </section>
  );
}
