import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Package, Plus, RefreshCw, Truck, Upload } from 'lucide-react';
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
import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import {
  ZxingTransferQrReader,
  cameraErrorMessage,
  qrImageErrorMessage,
} from '../custody-transfers/qr-reader';
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
import { ShipmentWorkflowDetail } from './ShipmentWorkflowDetail';
import { DistributorIngredientDeliveries } from './DistributorIngredientDeliveries';
import { DistributorIngredientDeliveryReview } from './DistributorIngredientDeliveryReview';
import { DistributorIngredientDispatchForm } from './DistributorIngredientDispatchForm';
import { ShipmentList } from './ShipmentList';

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
    );
  const [selected, setSelected] = useState(initialShipmentId),
    [selectedDeliveryOrder, setSelectedDeliveryOrder] = useState(initialOrderId),
    [reviewDeliveryOrderId, setReviewDeliveryOrderId] = useState(''),
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
    [qrFileName, setQrFileName] = useState(''),
    [cameraActive, setCameraActive] = useState(false),
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
  const workflowDetail = view === 'shipments' && !!shipment;
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
  const shipmentItem = item(shipment?.batchId);
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
      setCameraActive(false);
      return true;
    } catch (cause) {
      setChecked('');
      setError(reportError(cause, 'Invalid shipment label.'));
      return false;
    }
  };
  useEffect(() => {
    setConfirmed(false);
    setChecked('');
    setQrFileName('');
    setCameraActive(false);
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
  const reviewDeliveryOrder = ready.find((entry) => same(entry.orderId, reviewDeliveryOrderId));
  const directIngredientDeliveries = (data?.orders ?? []).filter(
    (entry) =>
      !entry.custodyOrder &&
      entry.delivery &&
      same(entry.delivery.distributor, data?.actor) &&
      Number(entry.delivery.stage) >= 2 &&
      Number(entry.delivery.stage) <= 5,
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
        (Number(entry.leg) === 1 && same(entry.batchId, trackedOrder.custodyOrder.batchId))),
  );
  const productDeliveryRows = (data?.orders ?? []).filter(
    (entry) => entry.productDelivery && same(entry.productDelivery.distributor, data?.actor),
  );
  const distributorIngredientShipments = shipments.filter(
    (entry) =>
      entry.kind === 'ingredient' &&
      Number(entry.leg) !== 1 &&
      (!trackedOrder || same(entry.orderId, trackedOrder.orderId)),
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
  const recordDispatch = () =>
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
    });
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
  const shipmentOrder = data.orders.find((entry) => same(entry.orderId, shipment?.orderId));
  const distributorIngredientDelivery =
    role === 'distributor' &&
    section === 'deliveries' &&
    shipment?.kind === 'ingredient' &&
    Number(shipment.leg) !== 1;
  const distributorIngredientDispatch =
    view === 'transfer' && role === 'distributor' && kind === 'ingredient' && !!order;
  const deliverySupplierName =
    shipmentOrder?.sellerName ?? shipmentItem?.sellerName ?? 'Registered Supplier';
  const deliveryManufacturerName =
    shipmentOrder?.buyerName ?? shipment?.recipientName ?? short(shipment?.recipient);
  const deliveryTrackingContent = shipment ? (
    <Alert
      type={Number(shipment.status) >= 3 ? 'success' : 'info'}
      message={
        Number(shipment.status) >= 3
          ? `${deliveryManufacturerName} confirmed physical receipt of this ingredient delivery.`
          : Number(shipment.status) === 2 || Number(shipment.expectedAt) <= Date.now() / 1000
            ? `Awaiting physical receipt confirmation from ${deliveryManufacturerName}.`
            : `This delivery is in transit to ${deliveryManufacturerName}. The Manufacturer confirms receipt separately.`
      }
    />
  ) : null;
  const arrivalNeedsReview =
    !!shipment &&
    intake &&
    !linkedCustodyOffer &&
    same(shipment.recipient, data.actor) &&
    Number(shipment.status) === 1 &&
    Number(shipment.custodyDecision ?? 0) === 0;
  const arrivalCanReceive =
    !!shipment &&
    (returning ||
      (same(shipment.recipient, data.actor) &&
        ((shipment.kind === 'ingredient' &&
          [1, 2].includes(Number(shipment.status)) &&
          (!intake ||
            (data.shipmentReviewSupported &&
              (Number(shipment.custodyDecision) === 1 || !!linkedCustodyOffer)))) ||
          (shipment.kind === 'product' && Number(shipment.status) === 1))));
  const arrivalReceiptDisabled =
    !shipment ||
    busy ||
    !checked ||
    !confirmed ||
    (!returning && intake && proofPending) ||
    (returning && quantity !== String(shipment.quantity)) ||
    !/^[1-9]\d*$/.test(quantity) ||
    BigInt(quantity || '0') >
      BigInt(shipment?.quantity ?? '0') - BigInt(shipment?.received ?? '0') ||
    !Number.isFinite(at) ||
    at > Date.now() / 1000 ||
    at < Number(shipment?.dispatchedAt ?? 0);
  const arrivalReceiptContent = !shipment ? null : arrivalNeedsReview ? (
    <div className="workspace-arrival-receipt">
      <Alert
        type="info"
        message="Accept or reject this custody delivery first. Acceptance does not credit inventory; physical receipt still requires QR verification and a separate confirmation."
      />
      {proofPending && (
        <Alert
          type="warning"
          message="Verify the requested Supplier company proof before accepting custody."
        />
      )}
      <a
        className="workspace-custody-detail__evidence-link"
        href={
          workspacePath(role, 'sent-requests') +
          '?context=delivery&referenceId=' +
          encodeURIComponent(shipment.shipmentId)
        }
      >
        Manage Supplier credential request
      </a>
      <div className="workspace-location-actions">
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
    </div>
  ) : arrivalCanReceive ? (
    <div className="workspace-arrival-receipt">
      {linkedCustodyOffer && intake && Number(shipment.custodyDecision ?? 0) === 0 && (
        <Alert
          type="info"
          message="The custody offer was accepted before pickup. Receipt will first record that acceptance on-chain, then confirm the scanned physical receipt."
        />
      )}
      <div className="workspace-arrival-receipt__choices">
        <button
          type="button"
          aria-label="Scan package QR"
          className="workspace-arrival-receipt__choice"
          onClick={() => {
            setQrFileName('');
            stop.current?.();
            const attempt = ++cameraAttempt.current;
            setCameraActive(true);
            void scanner.current
              .startCamera(
                video.current!,
                (value) => {
                  setQrFileName('');
                  verifyLabel(value);
                },
                (cause) => {
                  setCameraActive(false);
                  setError(cameraErrorMessage(cause));
                },
              )
              .then((cleanup) => {
                if (attempt !== cameraAttempt.current) cleanup();
                else stop.current = cleanup;
              })
              .catch((cause) => {
                setCameraActive(false);
                setError(cameraErrorMessage(cause));
              });
          }}
        >
          <Camera size={34} aria-hidden="true" />
          <strong>Scan QR code</strong>
          <small>Use this device’s camera</small>
        </button>
        <label className="workspace-arrival-receipt__choice">
          <Upload size={36} aria-hidden="true" />
          <strong>Upload QR image</strong>
          <small>PNG, JPEG or WebP · up to 5 MB</small>
          <input
            aria-label="Upload QR image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setQrFileName('');
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
                .then((payload) => {
                  if (verifyLabel(payload)) setQrFileName(file.name);
                })
                .catch((cause) => {
                  setChecked('');
                  setError(qrImageErrorMessage(cause));
                });
            }}
          />
        </label>
      </div>
      <div className="workspace-arrival-camera" hidden={!cameraActive}>
        <video ref={video} playsInline muted />
        <Btn
          variant="outline"
          full
          onClick={() => {
            cameraAttempt.current++;
            stop.current?.();
            setCameraActive(false);
          }}
        >
          Stop camera
        </Btn>
      </div>
      {checked && (
        <div className="workspace-arrival-receipt__verified" role="status">
          <CheckCircle2 size={17} aria-hidden="true" />
          <span>
            {qrFileName
              ? `Shipment QR verified · ${qrFileName}`
              : 'Shipment QR verified successfully.'}
          </span>
        </div>
      )}
      {checked && (
        <div className="workspace-arrival-receipt__form">
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
              onChange={(value) => setReceiveVehicle(value.toUpperCase())}
              placeholder="e.g. VAB 1234"
              maxLength={32}
            />
          )}
          <label className="workspace-custody-detail__confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I physically received {returning ? 'the returned goods' : 'these goods'} at{' '}
            {label(returning ? shipment.fromLocation : shipment.toLocation)}.
          </label>
        </div>
      )}
      <Btn
        full
        aria-label={
          returning ? 'Confirm physical return with MetaMask' : 'Confirm receipt with MetaMask'
        }
        disabled={arrivalReceiptDisabled}
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
              ...(!returning && receiveVehicle.trim() ? { vehicle: receiveVehicle.trim() } : {}),
            });
            setReceiveVehicle('');
            setConfirmed(false);
            setQuantity('');
          })
        }
      >
        {returning ? 'Confirm Return' : 'Confirm Receipt'}
      </Btn>
      <p className="workspace-arrival-receipt__metamask-note">
        MetaMask confirmation is required. Receipt is submitted only after you approve the
        transaction.
      </p>
    </div>
  ) : Number(shipment.status) === 4 && intake ? (
    <Alert
      type="warning"
      message="Custody delivery rejected. No warehouse stock was credited. Supplier stock remains unavailable until physical return is confirmed."
    />
  ) : (
    <Alert
      type="info"
      message={
        Number(shipment.status) >= 3
          ? 'Warehouse receipt has already been recorded.'
          : 'Receipt confirmation is not currently available for this shipment.'
      }
    />
  );
  return (
    <div className="grid min-w-0 gap-[16px]">
      {!workflowDetail && !distributorIngredientDispatch && (
        <SectionTitle
          title={
            view === 'locations'
              ? 'Company profile & locations'
              : section === 'intake'
                ? 'Custody intake'
                : role === 'distributor' && section === 'deliveries' && kind === 'ingredient'
                  ? 'Ingredient deliveries'
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
              : role === 'distributor' && section === 'deliveries' && kind === 'ingredient'
                ? 'Manage ingredient shipments to Manufacturers.'
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
      )}
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
      {view === 'shipments' && !selected && !productDeliveryOrder && reviewDeliveryOrder && (
        <DistributorIngredientDeliveryReview
          data={data}
          order={reviewDeliveryOrder}
          item={item(reviewDeliveryOrder.custodyOrder.batchId)}
          warehouseName={
            reviewDeliveryOrder.custodyOrder.warehouseName ??
            label(reviewDeliveryOrder.custodyOrder.location)
          }
          destinationName={label(reviewDeliveryOrder.custodyOrder.receivingLocation)}
          busy={busy}
          evidenceHref={
            workspacePath(role, 'sent-requests') +
            '?context=delivery&referenceId=' +
            encodeURIComponent(reviewDeliveryOrder.orderId)
          }
          onBack={() => setReviewDeliveryOrderId('')}
          onRefresh={() => void run(load)}
          onRecordDispatch={() => {
            setReviewDeliveryOrderId('');
            compose('ingredient');
            setOrderId(reviewDeliveryOrder.orderId);
          }}
        />
      )}
      {view === 'shipments' && !selected && !productDeliveryOrder && !reviewDeliveryOrder && (
        <>
          {section !== 'intake' &&
            kind === 'product' &&
            productDeliveryRows.map((entry) => {
              const product = data.catalogue.find((item) => same(item.itemId, entry.itemId));
              const stage = Number(entry.productDelivery.stage);
              return (
                <article className="shipment-card" key={entry.orderId}>
                  <div className="shipment-card__media">
                    <CatalogueImage
                      path={product?.imagePath}
                      category={product?.category ?? 'Product'}
                      alt={`${product?.name ?? 'Product'} image`}
                    />
                  </div>
                  <div className="shipment-card__content">
                    <div className="workspace-record-heading">
                      <div className="workspace-record-heading__identity">
                        <span className="workspace-record-heading__eyebrow">Product shipment</span>
                        <h3>{product?.name ?? 'Registered product'}</h3>
                        <p>{product?.batchReference ?? short(entry.requestedBatch)}</p>
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
                          ][stage] ?? 'In progress'
                        }
                        variant={stage === 5 ? 'verified' : 'pending'}
                      />
                    </div>
                    <dl className="workspace-record-facts">
                      <div>
                        <dt>Quantity</dt>
                        <dd>
                          {entry.requested} {product?.unit ?? ''}
                        </dd>
                      </div>
                      <div>
                        <dt>Sender</dt>
                        <dd className="workspace-company-cell">
                          <CompanyAvatar
                            name={entry.sellerName ?? short(entry.seller)}
                            logoPath={entry.sellerLogoPath}
                            size="sm"
                          />
                          {entry.sellerName ?? short(entry.seller)}
                        </dd>
                      </div>
                      <div>
                        <dt>Recipient</dt>
                        <dd className="workspace-company-cell">
                          <CompanyAvatar
                            name={entry.buyerName ?? short(entry.buyer)}
                            logoPath={entry.buyerLogoPath}
                            size="sm"
                          />
                          {entry.buyerName ?? short(entry.buyer)}
                        </dd>
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
                    <div className="shipment-card__next">
                      <div>
                        <span>Next action</span>
                        <strong>
                          {stage >= 5
                            ? 'No action required'
                            : stage === 3
                              ? 'Review and record physical dispatch'
                              : 'Open the shipment to review its current requirement'}
                        </strong>
                      </div>
                      <Btn
                        variant="outline"
                        onClick={() => setSelectedDeliveryOrder(entry.orderId)}
                      >
                        View shipment
                      </Btn>
                    </div>
                  </div>
                </article>
              );
            })}
          {section !== 'intake' &&
            kind === 'ingredient' &&
            directIngredientDeliveries.map((entry) => (
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
          {role === 'distributor' && section === 'deliveries' && kind === 'ingredient' ? (
            <DistributorIngredientDeliveries
              data={data}
              readyOrders={ready}
              shipments={distributorIngredientShipments}
              hasDirectDeliveries={directIngredientDeliveries.length > 0}
              locationName={label}
              onReviewOrder={setReviewDeliveryOrderId}
              onRecordOrder={(deliveryOrderId) => {
                compose('ingredient');
                setOrderId(deliveryOrderId);
              }}
              onReviewShipment={(shipmentId) => {
                setSelected(shipmentId);
                setView('shipments');
              }}
            />
          ) : (
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
              {(visibleShipments.length > 0 || productDeliveryRows.length === 0) && (
                <ShipmentList
                  shipments={visibleShipments}
                  catalogue={data.catalogue}
                  locationName={label}
                  statusLabel={stateLabel}
                  onOpen={(shipmentId) => {
                    setSelected(shipmentId);
                    setView('shipments');
                  }}
                />
              )}
            </>
          )}
        </>
      )}
      {distributorIngredientDispatch && order && (
        <DistributorIngredientDispatchForm
          data={data}
          order={order}
          item={item(order.custodyOrder.batchId)}
          originName={label(source)}
          destinationName={label(destination)}
          available={available.toString()}
          unit={unit ?? 'registered unit'}
          quantity={quantity}
          onQuantityChange={setQuantity}
          vehicle={vehicle}
          onVehicleChange={setVehicle}
          actual={actual}
          onActualChange={setActual}
          expectedAt={eta}
          onExpectedAtChange={setEta}
          confirmed={confirmed}
          onConfirmedChange={setConfirmed}
          evidenceHref={
            workspacePath(role, 'sent-requests') +
            '?context=delivery&referenceId=' +
            encodeURIComponent(order.orderId)
          }
          busy={busy}
          valid={valid}
          onBack={() => {
            setView('shipments');
            setOrderId('');
          }}
          onRefresh={() => void run(load)}
          onManageLocations={() => setView('locations')}
          missingLocation={!source || !destination}
          onSubmit={recordDispatch}
        />
      )}
      {view === 'transfer' && !distributorIngredientDispatch && (
        <Card className="dispatch-workflow-form">
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
          {kind === 'product' && batchId && (
            <div className="dispatch-stock-summary">
              <CatalogueImage
                path={item(batchId)?.imagePath}
                category={item(batchId)?.category ?? 'Product'}
                alt={`${item(batchId)?.name ?? 'Selected product'} image`}
              />
              <div>
                <strong>{item(batchId)?.name ?? 'Selected product'}</strong>
                <span>{item(batchId)?.batchReference ?? short(batchId)}</span>
                <span>
                  Available allocation: {available.toString()} {unit ?? ''}
                </span>
              </div>
            </div>
          )}
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
          {(!source || !destination) && (
            <Btn variant="outline" onClick={() => setView('locations')}>
              Set up missing location
            </Btn>
          )}
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
          <h3>4. Review and submit</h3>
          <p className="workspace-list-guidance">
            Review the stock, route and dispatch details. Stock changes only after you approve the
            transaction in MetaMask.
          </p>
          <Btn icon={<Truck size={16} />} disabled={busy || !valid} onClick={recordDispatch}>
            Confirm dispatch with MetaMask
          </Btn>
        </Card>
      )}
      {shipment && view === 'shipments' && workflowDetail && (
        <ShipmentWorkflowDetail
          shipment={shipment}
          catalogueItem={shipmentItem}
          senderName={
            distributorIngredientDelivery
              ? deliverySupplierName
              : (shipment.senderName ?? short(shipment.sender))
          }
          recipientName={
            distributorIngredientDelivery
              ? deliveryManufacturerName
              : (shipment.recipientName ?? short(shipment.recipient))
          }
          sourceName={label(shipment.fromLocation)}
          destinationName={label(shipment.toLocation)}
          qrVerified={!!checked}
          busy={busy}
          title={
            distributorIngredientDelivery
              ? 'Ingredient Delivery'
              : section === 'intake'
                ? 'Custody Intake'
                : role === 'retailer'
                  ? 'Product Receipt'
                  : role === 'distributor'
                    ? 'Delivery Tracking'
                    : 'Shipment Tracking'
          }
          subtitle={
            distributorIngredientDelivery
              ? 'Track this warehouse-to-Manufacturer delivery and review the next required action.'
              : section === 'intake'
                ? 'Review shipment details and confirm warehouse receipt.'
                : same(shipment.recipient, data.actor)
                  ? 'Review shipment details and confirm the physical receipt.'
                  : 'Follow this shipment from dispatch to verified receipt.'
          }
          actionTitle={
            distributorIngredientDelivery
              ? 'Next Action'
              : same(shipment.recipient, data.actor) || returning
                ? 'Receipt Confirmation'
                : 'Next Action'
          }
          backLabel={distributorIngredientDelivery ? 'Ingredient deliveries' : 'Back to shipments'}
          onBack={() => {
            setSelected('');
            setChecked('');
          }}
          onRefresh={() => void run(load)}
          receiptContent={
            distributorIngredientDelivery ? deliveryTrackingContent : arrivalReceiptContent
          }
          workflowVariant={distributorIngredientDelivery ? 'ingredient-delivery' : 'shipment'}
          additionalContent={
            <div className="workspace-arrival-detail__extras">
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
                  className="workspace-custody-detail__evidence-link"
                  href={
                    workspacePath(role, 'sent-requests') +
                    (linkedCustodyOffer
                      ? '?context=custody&referenceId='
                      : '?context=delivery&referenceId=') +
                    encodeURIComponent(linkedCustodyOffer?.offerId ?? shipment.shipmentId)
                  }
                >
                  Manage Supplier credential request in Information requests
                </a>
              )}
              {role === 'distributor' &&
                shipment.kind === 'ingredient' &&
                Number(shipment.status) < 4 &&
                same(shipment.recipient, data.actor) &&
                Number(shipment.custodyDecision) === 1 && (
                  <section className="workspace-arrival-panel" aria-label="Vehicle record">
                    <h3>
                      <Truck size={20} aria-hidden="true" /> Vehicle record
                    </h3>
                    <p className="m-0 text-[12px] text-ws-text2">
                      Record or update the vehicle registration after accepting this shipment.
                    </p>
                    <div className="workspace-arrival-detail__vehicle-form">
                      <Input
                        label="Vehicle registration number"
                        value={recordVehicle}
                        onChange={(value) => setRecordVehicle(value.toUpperCase())}
                        placeholder={shipment.vehicle || 'e.g. VAB 1234'}
                        maxLength={32}
                      />
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
            </div>
          }
          technicalFields={[
            { label: 'Shipment ID', value: shipment.shipmentId },
            { label: 'Original batch ID', value: shipment.batchId },
            { label: 'Order ID', value: shipment.orderId ?? 'Not order-bound' },
            { label: 'Sender wallet', value: shipment.sender },
            { label: 'Recipient wallet', value: shipment.recipient },
            {
              label: 'Confirmed by wallet',
              value:
                shipment.confirmedBy && !/^0x0+$/.test(shipment.confirmedBy)
                  ? shipment.confirmedBy
                  : shipment.sender,
            },
            { label: 'Dispatch location ID', value: shipment.fromLocation },
            { label: 'Receiving location ID', value: shipment.toLocation },
            { label: 'Orders contract', value: data.ordersAddress ?? '' },
            {
              label: 'Transaction hash',
              value: String(shipment.transactionHash ?? shipment.txHash ?? ''),
            },
          ]}
        />
      )}
    </div>
  );
}
