import { formatLocationLabel } from './location-format';
import { reportError } from '../../components/ui/feedback';
import { useEffect, useRef, useState } from 'react';
import { Camera, Factory, Store, Truck } from 'lucide-react';
import { decodeShipmentQr } from '@tracechain/shared';
import { shipmentAppOrigin } from './shipment-receipt-link';
import {
  Alert,
  Btn,
  Input,
  SelectField,
  StatusTimeline,
  WorkflowHelp,
} from '../workspaces/shared/ui';
import { ProductQrDisplay } from '../product-traceability/ProductQrDisplay';
import {
  ZxingTransferQrReader,
  cameraErrorMessage,
  qrImageErrorMessage,
} from '../custody-transfers/qr-reader';
import { prepareLogistics, type OrdersState, type OrderRecord } from './orders.api';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import { workspacePath } from '../workspaces/workspace-paths';
import { PickupPlanPanel } from './PickupPlanPanel';
import { DeliveryIdentityPanel } from './DeliveryIdentityPanel';
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const localTime = (offset = 0) => {
  const d = new Date(Date.now() + offset);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 19);
};
export function ProductDeliveryPanel({
  data,
  order,
  item,
  onChanged,
  initialQr = '',
}: {
  data: OrdersState;
  order: OrderRecord;
  item?: OrderRecord;
  onChanged: () => Promise<void>;
  initialQr?: string;
}) {
  const r = order.productDelivery;
  const manufacturer = same(order.seller, data.actor),
    retailer = same(order.buyer, data.actor),
    carrier = same(r?.distributor, data.actor);
  const approvalDeadline =
    Number(order.decision?.recordedAt) > 0
      ? Math.min(Number(order.expiresAt), Number(order.decision.recordedAt) + 48 * 3600)
      : Number(order.expiresAt);
  const stage = Number(
    (Number(r?.stage) > 0 ? r.stage : undefined) ??
      (Number(order.status) >= 3 || approvalDeadline <= Date.now() / 1000
        ? 6
        : Number(order.decision?.status) === 1
          ? 1
          : 0),
  );
  const [mode, setMode] = useState(order.details?.custodySource ? '2' : '1'),
    [distributor, setDistributor] = useState(order.details?.custodySource?.distributor ?? ''),
    [from, setFrom] = useState(order.details?.custodySource?.location ?? '');
  const [vehicle, setVehicle] = useState(''),
    [actual, setActual] = useState(localTime()),
    [eta, setEta] = useState(localTime(4 * 3600000));
  const [scanned, setScanned] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [pickupReady, setPickupReady] = useState(false);
  const [requestEvidence, setRequestEvidence] = useState(false);
  const uploadAttempt = useRef(0);
  const lock = useRef(false),
    video = useRef<HTMLVideoElement>(null),
    reader = useRef(new ZxingTransferQrReader()),
    stop = useRef<() => void>(undefined),
    attempt = useRef(0);
  useEffect(
    () => () => {
      attempt.current++;
      uploadAttempt.current++;
      stop.current?.();
    },
    [],
  );
  useEffect(() => {
    setScanned('');
    setConfirmed(false);
    setActual(localTime());
    setEta(localTime(4 * 3600000));
    attempt.current++;
    uploadAttempt.current++;
    stop.current?.();
  }, [order.orderId, stage, data.actor]);
  useEffect(() => {
    setSelectionConfirmed(false);
    setRefreshRequired(false);
  }, [order.orderId, data.actor]);
  const check = (value: string) => {
    try {
      decodeShipmentQr(value, {
        shipmentId: order.orderId,
        kind: 'product',
        chainId: data.chainId!,
        ordersAddress: data.ordersAddress!,
        publicAppUrl: shipmentAppOrigin(),
      });
      setScanned(value);
      setConfirmed(false);
      setError('');
      stop.current?.();
    } catch {
      setScanned('');
      setError('Scan the label for this product order and configured deployment.');
    }
  };
  useEffect(() => {
    if (initialQr && carrier && stage === 3) check(initialQr);
  }, [initialQr, carrier, stage]);
  const run = async (input: Record<string, unknown>) => {
    if (lock.current || refreshRequired) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let mined = false;
    try {
      const p = await prepareLogistics({
        ...input,
        orderId: order.orderId,
        operationId: crypto.randomUUID(),
      });
      await submitProductionTransaction(p.transaction, data.actor);
      mined = true;
      if (input.action === 'product-order-select') setSelectionConfirmed(true);
      setNotice('Product delivery action confirmed on-chain.');
      await onChanged();
    } catch (cause) {
      if (mined) setRefreshRequired(true);
      setError(
        mined
          ? 'Confirmed, but refresh failed. Refresh before submitting another action.'
          : reportError(cause, 'Product delivery failed.'),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const batchId = order.requestedBatch ?? item?.batches?.[0];
  const received: OrderRecord[] = (item?.storageLocations ?? []).filter(
    (p: OrderRecord) =>
      same(p.batchId, batchId) &&
      same(p.distributor, distributor) &&
      BigInt(p.available) >= BigInt(order.requested),
  );
  const locations: OrderRecord[] =
    mode === '1'
      ? data.locations.filter((p) => same(p.company, data.actor))
      : received.map((p: OrderRecord) => ({
          location: p.location,
          label: p.warehouseName ?? 'Distributor warehouse',
        }));
  const to = order.deliveryReceivingLocation ?? order.details?.receivingLocation;
  const role = manufacturer ? 'manufacturer' : retailer ? 'retailer' : 'distributor';
  const actualAt = Math.floor(Date.parse(actual) / 1000),
    expectedAt = Math.floor(Date.parse(eta) / 1000);
  const validTransport =
    /^(?=.*[A-Z0-9])[A-Z0-9 -]{2,32}$/.test(vehicle.trim().toUpperCase()) &&
    actualAt > 0 &&
    actualAt <= Date.now() / 1000 &&
    expectedAt > Date.now() / 1000;
  const proofBlocked =
    !!r?.identityChallenge &&
    !/^0x0+$/.test(r.identityChallenge) &&
    (!r.identityCredentialHash ||
      /^0x0+$/.test(r.identityCredentialHash) ||
      Number(r.identityValidUntil) <= Date.now() / 1000);
  if (stage === 0) return null;
  return (
    <section
      aria-label="Product delivery tracking"
      className="delivery-panel grid min-w-0 gap-[16px] rounded-xl border border-[var(--c-border)] p-[16px]"
    >
      <h3 className="m-0">Manufacturer → Distributor → Retailer</h3>
      <StatusTimeline
        label="Product delivery progress"
        variant="arrival"
        steps={[
          {
            label: 'Manufacturer approves',
            actor: order.sellerName ?? 'Manufacturer',
            icon: <Factory size={22} />,
            state: stage === 6 ? ('pending' as const) : ('complete' as const),
          },
          {
            label: 'Arrange delivery',
            actor: order.sellerName ?? 'Manufacturer',
            icon: <Truck size={22} />,
            state:
              stage === 1 && !selectionConfirmed
                ? ('current' as const)
                : (stage >= 2 && stage <= 5) || selectionConfirmed
                  ? ('complete' as const)
                  : ('pending' as const),
          },
          {
            label: 'Distributor delivers',
            actor: r?.distributorName ?? 'Delivery company',
            icon: <Truck size={22} />,
            state:
              stage >= 5
                ? ('complete' as const)
                : (stage >= 2 && stage <= 4) || selectionConfirmed
                  ? ('current' as const)
                  : ('pending' as const),
          },
          {
            label: 'Retailer receives',
            actor: order.buyerName ?? 'Retailer',
            icon: <Store size={22} />,
            state: stage === 5 ? ('complete' as const) : ('pending' as const),
          },
        ]}
      />
      <strong role="status">
        {selectionConfirmed && stage === 1
          ? 'Delivery arrangement confirmed'
          : [
              'Awaiting approval',
              'Choose delivery mode',
              'Distributor reviewing request',
              'Ready for physical dispatch',
              'In transit to Retailer',
              'Received by Retailer',
              'Cancelled / expired',
            ][stage]}
      </strong>
      <p>
        {item?.name ?? 'Registered product'} · {order.requested} {item?.unit} ·{' '}
        {r?.mode
          ? Number(r.mode) === 1
            ? 'Direct Distributor delivery'
            : 'From received Distributor custody'
          : 'Manufacturer selects fulfilment after approval'}
      </p>
      {error && <Alert type="error" announce={false} message={error} />}
      {refreshRequired && (
        <Btn
          variant="outline"
          onClick={() => {
            void onChanged()
              .then(() => setRefreshRequired(false))
              .catch(() =>
                setError(
                  'The transaction is confirmed. Retry refreshing records; do not resubmit.',
                ),
              );
          }}
        >
          Refresh records
        </Btn>
      )}
      {notice && <Alert type="success" message={notice} />}
      {!data.productDeliverySupported && (
        <Alert
          type="warning"
          message="Product order delivery needs the updated complete contract suite. Existing stock and records remain intact."
        />
      )}
      {manufacturer && stage === 1 && selectionConfirmed && (
        <div className="delivery-action-section">
          <h4>Delivery arrangement confirmed</h4>
          <p>
            Assigned carrier:{' '}
            {data.companies?.find((entry) => same(entry.wallet, distributor))?.companyName ??
              'Selected Distributor'}
            . Refresh the confirmed record to follow pickup and delivery.
          </p>
          <a
            href={
              workspacePath(role, 'product-shipments') +
              '?orderId=' +
              encodeURIComponent(order.orderId)
            }
          >
            Open delivery tracking
          </a>
        </div>
      )}
      {manufacturer && stage === 1 && !selectionConfirmed && (
        <div className="delivery-action-section grid gap-[12px] sm:grid-cols-2">
          <h4 className="col-span-full">Arrange delivery</h4>
          <SelectField
            label="Product delivery mode"
            disabled={!!order.details?.custodySource}
            value={mode}
            onChange={(v) => {
              setMode(v);
              setFrom('');
            }}
            options={[
              { value: '1', label: 'Request direct Distributor delivery' },
              { value: '2', label: 'Deliver from existing Distributor custody' },
            ]}
          />
          <SelectField
            label="Delivery Distributor"
            disabled={!!order.details?.custodySource}
            value={distributor}
            onChange={(v) => {
              setDistributor(v);
              setFrom('');
            }}
            options={[
              { value: '', label: 'Select an authorized Distributor' },
              ...(data.companies ?? [])
                .filter((p) => p.role === 'DISTRIBUTOR')
                .map((p) => ({ value: p.wallet, label: p.companyName })),
            ]}
          />
          <SelectField
            label={
              mode === '1' ? 'Manufacturer pickup location' : 'Received product custody location'
            }
            value={from}
            disabled={!!order.details?.custodySource}
            onChange={setFrom}
            options={[
              { value: '', label: 'Select dispatch location' },
              ...locations.map((p) => ({
                value: p.location,
                label: formatLocationLabel(p, p.location),
              })),
            ]}
          />
          <p>
            Retailer destination:{' '}
            {formatLocationLabel(
              data.locations.find((p) => same(p.location, to)),
              '',
            ) ||
              (to
                ? 'Registered Retailer location'
                : 'Unavailable — ask the Retailer to submit a request with its receiving location')}
            .
          </p>
          {mode === '2' && !received.length && (
            <p>
              No selected Distributor warehouse has enough received, unreserved stock for this
              product batch and full quantity.
            </p>
          )}
          <p>
            {mode === '1'
              ? 'The Distributor accepts, scans at pickup and delivers to the Retailer.'
              : 'Confirming this arrangement reserves the selected warehouse stock for this order.'}{' '}
            Arrange within 48 hours of approval and before request expiry.
          </p>
          <div className="action-row">
            <Btn
              disabled={
                busy ||
                refreshRequired ||
                !data.productDeliverySupported ||
                !from ||
                !to ||
                !distributor ||
                (mode === '2' && !received.some((p: OrderRecord) => same(p.location, from)))
              }
              onClick={() =>
                void run({
                  action: 'product-order-select',
                  mode: Number(mode),
                  distributor,
                  fromLocation: from,
                  toLocation: to,
                })
              }
            >
              Arrange delivery
            </Btn>
          </div>
        </div>
      )}
      {manufacturer && r?.mode === 1 && stage >= 2 && stage <= 3 && order.productDeliveryQr && (
        <ProductQrDisplay
          batchId={order.orderId}
          batchReference={item?.batchReference ?? 'Product order'}
          productName={item?.name ?? 'Product delivery'}
          encodedPayload={order.productDeliveryQr}
          labelTitle="Product Order Pickup QR"
          instruction="Attach to these products. Assigned Distributor scans before confirming pickup; Retailer scans the final shipment label on arrival."
        />
      )}
      {carrier && stage === 2 && (
        <div className="flex flex-wrap gap-[8px] action-row">
          <Btn
            variant="danger"
            disabled={busy || refreshRequired}
            onClick={() => void run({ action: 'product-order-respond', accept: false })}
          >
            Decline product delivery
          </Btn>
          <Btn
            disabled={busy || refreshRequired}
            onClick={() => void run({ action: 'product-order-respond', accept: true })}
          >
            Accept product delivery
          </Btn>
        </div>
      )}
      {r &&
        stage >= 2 &&
        stage <= 3 &&
        (carrier || manufacturer) &&
        (carrier ? (
          <Btn variant="outline" onClick={() => setRequestEvidence(true)}>
            Request Manufacturer company evidence
          </Btn>
        ) : (
          <a
            href={`/manufacturer/information-requests?context=delivery&referenceId=${encodeURIComponent(order.orderId)}`}
          >
            Manage requested company evidence
          </a>
        ))}
      {requestEvidence && (
        <DeliveryIdentityPanel
          requestOnly
          requestContextLabel="product delivery"
          data={data}
          order={{
            ...order,
            delivery: {
              ...r,
              batchId: order.requestedBatch,
              distributor: r?.distributor,
              identityChallenge: r?.identityChallenge ?? '',
            },
          }}
          onChanged={onChanged}
          requestedBy={r?.distributorName}
          onRequestClose={() => setRequestEvidence(false)}
        />
      )}
      {r && Number(r.mode) === 1 && stage >= 3 && stage <= 4 && (
        <PickupPlanPanel
          referenceId={order.orderId}
          canArrange={carrier && stage === 3}
          expiresAt={Number(order.expiresAt)}
          onReady={setPickupReady}
        />
      )}
      {carrier && stage === 3 && (Number(r.mode) !== 1 || pickupReady) && (
        <div className="delivery-action-section grid gap-[12px]">
          <h4>Record physical dispatch</h4>
          {proofBlocked && (
            <Alert
              type="warning"
              message="Verify the requested Manufacturer company proof before pickup or dispatch."
            />
          )}
          {Number(r.mode) === 1 && (
            <>
              <video ref={video} playsInline muted className="max-h-[220px] w-full" />
              <Btn
                icon={<Camera size={16} />}
                onClick={() => {
                  const current = ++attempt.current;
                  stop.current?.();
                  void reader.current
                    .startCamera(video.current!, check, (c) => setError(cameraErrorMessage(c)))
                    .then((cleanup) => {
                      if (current !== attempt.current) cleanup();
                      else stop.current = cleanup;
                    })
                    .catch((c) => setError(cameraErrorMessage(c)));
                }}
              >
                Scan product pickup QR
              </Btn>
              <label>
                Upload product pickup QR image
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    const upload = ++uploadAttempt.current;
                    setScanned('');
                    setError('');
                    setConfirmed(false);
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) {
                      setError('Select a supported image up to 5 MB.');
                      return;
                    }
                    try {
                      const payload = await reader.current.decodeImage(file);
                      if (upload === uploadAttempt.current) check(payload);
                    } catch (cause) {
                      if (upload === uploadAttempt.current) setError(qrImageErrorMessage(cause));
                    }
                  }}
                />
              </label>
              {scanned && <p role="status">Correct product-order label scanned.</p>}
            </>
          )}
          <Input
            label="Vehicle registration"
            value={vehicle}
            onChange={setVehicle}
            maxLength={32}
            required
          />
          <Input
            label="Actual product pickup / dispatch time"
            type="datetime-local"
            value={actual}
            onChange={setActual}
            required
          />
          <Input
            label="Expected product arrival"
            type="datetime-local"
            value={eta}
            onChange={setEta}
            required
          />
          <label className="flex items-start gap-[8px]">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirm the full requested quantity is physically collected or dispatched on this
            route.
          </label>
          <div className="action-row">
            <Btn
              icon={<Truck size={16} />}
              disabled={
                busy ||
                refreshRequired ||
                !confirmed ||
                !validTransport ||
                proofBlocked ||
                (Number(r.mode) === 1 && !pickupReady) ||
                (Number(r.mode) === 1 && !scanned)
              }
              onClick={() =>
                void run({
                  action: 'product-order-dispatch',
                  vehicle: vehicle.trim().toUpperCase(),
                  occurredAt: actualAt,
                  expectedAt,
                  ...(Number(r.mode) === 1 ? { qrPayload: scanned } : {}),
                })
              }
            >
              Confirm product pickup & dispatch
            </Btn>
          </div>
        </div>
      )}
      {stage >= 4 && stage <= 5 && (
        <a
          href={
            workspacePath(role, role === 'retailer' ? 'shipments' : 'product-shipments') +
            '?shipmentId=' +
            encodeURIComponent(r.transferId)
          }
        >
          Open product shipment & scanned Retailer receipt
        </a>
      )}
      {((manufacturer && stage >= 2 && stage < 4) || (stage === 6 && r?.reservationActive)) && (
        <Btn
          variant="outline"
          disabled={busy || refreshRequired}
          onClick={() => void run({ action: 'product-order-close' })}
        >
          {stage === 6
            ? 'Release expired product reservation'
            : 'Cancel product delivery arrangement'}
        </Btn>
      )}
      <WorkflowHelp title="When does stock become available?">
        Approval and evidence verification do not credit stock. Retailer usable stock changes only
        after the intended Retailer confirms physical receipt.
      </WorkflowHelp>
    </section>
  );
}
