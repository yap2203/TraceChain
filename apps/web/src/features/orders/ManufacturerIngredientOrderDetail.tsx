import {
  Building2,
  CalendarClock,
  ClipboardCheck,
  Factory,
  MapPin,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Send,
  ShieldCheck,
  Truck,
  Warehouse,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord, OrdersState } from './orders.api';
import { nextAction as orderNextAction, requestStatus } from './RequestsOverview';
import { Alert, Badge, Btn, Card, StatusTimeline, TechnicalDetails } from '../workspaces/shared/ui';

export function ManufacturerIngredientOrderDetail({
  data,
  order,
  item,
  shipment,
  busy,
  onBack,
  onRefresh,
  onOpenShipment,
  onRespondEvidence,
}: {
  data: OrdersState;
  order: OrderRecord;
  item?: OrderRecord;
  shipment?: OrderRecord;
  busy: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onOpenShipment: () => void;
  onRespondEvidence: () => void;
}) {
  const batchId =
    order.requestedBatch ?? order.custodyOrder?.batchId ?? item?.batches?.[0] ?? order.batchId;
  const batch = item?.batchDetails?.find((entry: OrderRecord) => same(entry.batchId, batchId));
  const supplierName = order.sellerName ?? companyName(data, order.seller, 'Registered Supplier');
  const manufacturerName =
    order.buyerName ?? companyName(data, order.buyer, 'Your Manufacturer company');
  const distributorWallet = order.custodyOrder?.distributor ?? order.delivery?.distributor;
  const distributorName =
    order.custodyOrder?.distributorName ??
    order.delivery?.distributorName ??
    companyName(data, distributorWallet, 'Assigned Distributor');
  const supplierLogoPath = order.sellerLogoPath ?? item?.sellerLogoPath;
  const distributorLogoPath = companyLogo(data, distributorWallet);
  const manufacturerLogoPath = order.buyerLogoPath ?? companyLogo(data, order.buyer);
  const originLocation =
    order.custodyOrder?.warehouseName ??
    locationName(
      data,
      order.custodyOrder?.location ?? shipment?.fromLocation,
      'Distributor warehouse',
    );
  const receivingLocation = locationName(
    data,
    order.custodyOrder?.receivingLocation ??
      order.deliveryReceivingLocation ??
      shipment?.toLocation,
    'Manufacturer receiving location',
  );
  const unit = item?.unit ?? order.custodyOrder?.unit ?? shipment?.unit ?? 'units';
  const requested = quantity(order.requested) ?? 0n;
  const approved = Number(order.decision?.status) === 1 ? requested : undefined;
  const dispatched = quantity(order.custodyOrder?.dispatched ?? shipment?.quantity);
  const received = quantity(
    order.custodyOrder?.received ?? order.approvedReceivedQuantity ?? shipment?.received,
  );
  const remaining = received !== undefined ? maxZero(requested - received) : undefined;
  const decision = Number(order.decision?.status ?? 0);
  const receivedComplete =
    requested > 0n &&
    ((received ?? 0n) >= requested ||
      Number(order.delivery?.stage) === 5 ||
      Number(shipment?.status) >= 3);
  const closed =
    !receivedComplete &&
    (decision === 2 || Number(order.status) === 3 || Number(order.delivery?.stage) === 6);
  const expired = !receivedComplete && !closed && Number(order.expiresAt) <= Date.now() / 1_000;
  const currentStep = receivedComplete ? 3 : decision === 1 ? 2 : 1;
  const status = requestStatus(order);
  const stage = currentStageLabel({ closed, expired, receivedComplete, currentStep });
  const evidence = evidenceState(order);
  const next = order.custodyOrder
    ? manufacturerNextAction({
        closed,
        decision,
        distributorName,
        expired,
        receivedComplete,
        shipment,
        supplierName,
      })
    : orderNextAction(order, data.actor);
  const fulfilment = order.custodyOrder
    ? 'Distributor custody stock'
    : order.delivery
      ? 'Direct Distributor delivery'
      : 'Awaiting fulfilment selection';
  const expectedAt = shipment?.expectedAt ?? order.custodyOrder?.expectedAt;

  const orderProgress = [
    {
      actor: manufacturerName,
      detail: dateTime(order.createdAt ?? order.requestedAt),
      icon: <Send size={22} />,
      label: 'Requested',
    },
    {
      actor: supplierName,
      detail:
        decision === 1
          ? timeOrLabel(order.decision?.recordedAt, 'Approved')
          : decision === 2
            ? timeOrLabel(order.decision?.recordedAt, 'Rejected')
            : 'Awaiting review',
      icon: <ClipboardCheck size={22} />,
      label: 'Supplier review',
    },
    {
      actor: distributorName,
      detail: shipment?.dispatchedAt
        ? dateTime(shipment.dispatchedAt)
        : decision === 1
          ? 'Awaiting dispatch'
          : 'Not started',
      icon: <Truck size={22} />,
      label: 'Delivery',
    },
    {
      actor: manufacturerName,
      detail: receivedComplete
        ? timeOrLabel(shipment?.receivedAt ?? shipment?.receiptOccurredAt, 'Receipt confirmed')
        : 'Awaiting receipt',
      icon: <Warehouse size={22} />,
      label: 'Received',
    },
  ].map((entry, index) => ({
    ...entry,
    state: receivedComplete
      ? ('complete' as const)
      : index < currentStep
        ? ('complete' as const)
        : index === currentStep && !closed && !expired
          ? ('current' as const)
          : ('pending' as const),
  }));

  const companyRoute = [
    {
      actor: <CompanyRouteActor name={supplierName} logoPath={supplierLogoPath} />,
      detail: 'Ingredient Supplier',
      icon: <Building2 size={18} />,
      label: 'Supplier',
      state: 'complete' as const,
    },
    {
      actor: <CompanyRouteActor name={distributorName} logoPath={distributorLogoPath} />,
      detail: originLocation,
      icon: <Warehouse size={18} />,
      label: 'Distributor warehouse',
      state: receivedComplete ? ('complete' as const) : ('current' as const),
    },
    {
      actor: <CompanyRouteActor name={manufacturerName} logoPath={manufacturerLogoPath} />,
      detail: receivingLocation,
      icon: <Factory size={18} />,
      label: 'Manufacturer',
      state: receivedComplete ? ('complete' as const) : ('pending' as const),
    },
  ];

  return (
    <section className="manufacturer-order-detail" aria-label="Ingredient order detail">
      <button type="button" className="workspace-process-back" onClick={onBack}>
        ← Ingredient orders
      </button>

      <header className="manufacturer-order-detail__header">
        <div className="manufacturer-order-detail__title">
          <span className="workspace-arrival-detail__header-icon" aria-hidden="true">
            <PackageCheck size={29} />
          </span>
          <div>
            <div className="manufacturer-order-detail__title-line">
              <h2>{item?.name ?? 'Requested ingredient'}</h2>
              <Badge label={status.label} variant={status.variant} />
            </div>
            <p>Order and delivery details</p>
          </div>
        </div>
        <Btn variant="outline" icon={<RefreshCw size={16} />} disabled={busy} onClick={onRefresh}>
          Refresh
        </Btn>
      </header>

      <StatusTimeline label="Order progress" steps={orderProgress} variant="arrival" />

      <section className="manufacturer-order-next" aria-labelledby="manufacturer-next-action">
        <div>
          <Badge label={stage} variant={receivedComplete ? 'verified' : status.variant} />
          <div>
            <h3 id="manufacturer-next-action">Next action</h3>
            <p>{next}</p>
          </div>
        </div>
        {shipment && !closed && (
          <Btn icon={<ScanLine size={17} />} onClick={onOpenShipment}>
            Open shipment &amp; scan receipt
          </Btn>
        )}
      </section>

      <Card>
        <div className="manufacturer-order-summary">
          <section className="manufacturer-order-summary__identity" aria-label="Ingredient">
            <div className="manufacturer-order-summary__image">
              <CatalogueImage
                path={item?.imagePath}
                alt={`${item?.name ?? 'Ingredient'} catalogue image`}
                category={item?.category}
              />
            </div>
            <div>
              <Badge label={batchStatus(batch)} variant={batchVariant(batch)} />
              <strong className="manufacturer-order-summary__name">
                {item?.name ?? 'Requested ingredient'}
              </strong>
              <p>
                {item?.batchReference ?? batch?.batchReference ?? 'Batch reference unavailable'}
              </p>
              <div className="manufacturer-order-company">
                <CompanyAvatar name={supplierName} logoPath={supplierLogoPath} size="md" />
                <span>
                  <small>Supplier</small>
                  <strong>{supplierName}</strong>
                </span>
              </div>
            </div>
          </section>

          <SummaryGroup title="Order quantities">
            <SummaryFact label="Requested" value={`${requested} ${unit}`} />
            <SummaryFact
              label="Approved"
              value={approved === undefined ? 'Awaiting approval' : `${approved} ${unit}`}
            />
            <SummaryFact
              label="Received"
              value={received ? `${received} ${unit}` : 'Awaiting receipt'}
            />
            <SummaryFact label="Unit" value={unit} />
            <SummaryFact
              label="Requested on"
              value={dateTime(order.createdAt ?? order.requestedAt)}
            />
            <SummaryFact label="Response deadline" value={dateTime(order.expiresAt)} />
          </SummaryGroup>

          <SummaryGroup title="Fulfilment">
            <SummaryFact label="Method" value={fulfilment} />
            <SummaryFact label="Distributor" value={distributorName} />
            <SummaryFact label="Origin warehouse" value={originLocation} />
            <SummaryFact label="Receiving location" value={receivingLocation} />
            {expectedAt && <SummaryFact label="Expected arrival" value={dateTime(expectedAt)} />}
          </SummaryGroup>
        </div>
        {order.details?.note && (
          <div className="manufacturer-order-summary__note">
            <strong>Request note</strong>
            <span>{order.details.note}</span>
          </div>
        )}
        {order.decision?.reason && (
          <div className="manufacturer-order-summary__note">
            <strong>Supplier decision</strong>
            <span>{order.decision.reason}</span>
          </div>
        )}
      </Card>

      <section className="manufacturer-order-route" aria-labelledby="manufacturer-route-title">
        <h3 id="manufacturer-route-title">
          <MapPin size={19} aria-hidden="true" /> Delivery route
        </h3>
        <StatusTimeline
          label="Supplier to Manufacturer delivery route"
          steps={companyRoute}
          variant="route"
        />
      </section>

      <div className="manufacturer-order-detail__columns">
        <section className="workspace-arrival-panel" aria-labelledby="quantity-status-title">
          <h3 id="quantity-status-title">
            <PackageCheck size={20} aria-hidden="true" /> Quantity status
          </h3>
          <dl className="manufacturer-order-quantity">
            <SummaryFact label="Requested" value={`${requested} ${unit}`} />
            <SummaryFact
              label="Reserved"
              value={approved === undefined ? 'Not reserved' : `${approved} ${unit}`}
            />
            <SummaryFact
              label="Dispatched"
              value={dispatched ? `${dispatched} ${unit}` : 'Not dispatched'}
            />
            <SummaryFact
              label="Received"
              value={received ? `${received} ${unit}` : 'Awaiting receipt'}
            />
            {remaining !== undefined &&
              remaining > 0n &&
              received !== undefined &&
              received > 0n && <SummaryFact label="Remaining" value={`${remaining} ${unit}`} />}
          </dl>

          <div className="manufacturer-order-evidence">
            <div>
              <ShieldCheck size={19} aria-hidden="true" />
              <span>
                <small>Company evidence</small>
                <strong>{evidence.label}</strong>
              </span>
            </div>
            {evidence.actionAvailable && (
              <Btn variant="outline" onClick={onRespondEvidence}>
                Respond to evidence request
              </Btn>
            )}
          </div>
        </section>

        <section className="workspace-arrival-panel" aria-labelledby="shipment-receipt-title">
          <h3 id="shipment-receipt-title">
            <Truck size={20} aria-hidden="true" /> Shipment &amp; receipt
          </h3>
          {shipment ? (
            <>
              <dl className="workspace-arrival-delivery-list">
                <SummaryFact
                  label="Shipment reference"
                  value={shipmentReference(shipment.shipmentId)}
                />
                <SummaryFact label="Distributor" value={distributorName} />
                <SummaryFact label="Vehicle" value={shipment.vehicle || 'Not recorded'} />
                <SummaryFact
                  label="Actual dispatch"
                  value={dateTime(shipment.dispatchedAt ?? shipment.occurredAt)}
                />
                <SummaryFact label="Expected arrival" value={dateTime(shipment.expectedAt)} />
                <SummaryFact
                  label="Receipt state"
                  value={receiptState(shipment, receivedComplete)}
                />
              </dl>
              <Alert
                type="info"
                message={
                  receivedComplete
                    ? 'Physical receipt has been recorded.'
                    : 'Open the shipment when the goods arrive, verify its QR and confirm receipt separately.'
                }
              />
            </>
          ) : (
            <Alert
              type="info"
              message={
                decision === 1
                  ? 'Waiting for the Distributor to dispatch the reserved stock.'
                  : 'Shipment details will appear after approval and delivery arrangement.'
              }
            />
          )}
        </section>
      </div>

      {order.custodyOrder && (
        <Alert
          type="info"
          message="Warehouse stock is reserved for this order. Only confirmed Manufacturer receipt credits production stock."
        />
      )}

      <div className="workspace-arrival-detail__technical">
        <TechnicalDetails
          fields={[
            { label: 'Order ID', value: order.orderId },
            { label: 'Ingredient batch ID', value: batchId },
            { label: 'Shipment ID', value: shipment?.shipmentId },
            { label: 'Supplier wallet', value: order.seller },
            { label: 'Distributor wallet', value: distributorWallet },
            { label: 'Manufacturer wallet', value: order.buyer },
            {
              label: 'Origin location ID',
              value: order.custodyOrder?.location ?? shipment?.fromLocation,
            },
            {
              label: 'Receiving location ID',
              value:
                order.custodyOrder?.receivingLocation ??
                order.deliveryReceivingLocation ??
                shipment?.toLocation,
            },
            { label: 'Orders contract', value: data.ordersAddress },
            {
              label: 'Transaction hash',
              value: shipment?.transactionHash ?? order.transactionHash ?? order.txHash,
            },
            { label: 'Metadata hash', value: order.detailsHash ?? order.metadataHash },
          ]}
        />
      </div>
    </section>
  );
}

function SummaryGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="manufacturer-order-summary__group">
      <h4>{title}</h4>
      <dl>{children}</dl>
    </section>
  );
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CompanyRouteActor({ name, logoPath }: { name: string; logoPath?: string }) {
  return (
    <span className="manufacturer-order-route__company">
      <CompanyAvatar name={name} logoPath={logoPath} size="sm" />
      <span>{name}</span>
    </span>
  );
}

function evidenceState(order: OrderRecord) {
  if (hasValue(order.identityCredentialHash))
    return Number(order.identityValidUntil) > Date.now() / 1_000
      ? { label: 'Verified', actionAvailable: false }
      : { label: 'Rejected or expired', actionAvailable: false };
  if (hasValue(order.identityChallenge))
    return { label: 'Awaiting presentation', actionAvailable: true };
  return { label: 'Not requested', actionAvailable: false };
}

function manufacturerNextAction({
  closed,
  decision,
  distributorName,
  expired,
  receivedComplete,
  shipment,
  supplierName,
}: {
  closed: boolean;
  decision: number;
  distributorName: string;
  expired: boolean;
  receivedComplete: boolean;
  shipment?: OrderRecord;
  supplierName: string;
}) {
  if (receivedComplete)
    return 'Receipt is confirmed. The ingredient stock is available for production.';
  if (closed)
    return 'This request is closed. Review the recorded decision and technical details below.';
  if (expired)
    return 'The response deadline has passed. No delivery action is currently available.';
  if (decision !== 1) return `${supplierName} is reviewing this quantity request.`;
  if (shipment)
    return 'The shipment is ready to review. Scan its QR when the goods physically arrive.';
  return `${distributorName} will dispatch the reserved warehouse stock.`;
}

function currentStageLabel({
  closed,
  expired,
  receivedComplete,
  currentStep,
}: {
  closed: boolean;
  expired: boolean;
  receivedComplete: boolean;
  currentStep: number;
}) {
  if (receivedComplete) return 'Received';
  if (closed) return 'Closed';
  if (expired) return 'Deadline passed';
  return currentStep === 2 ? 'Delivery' : 'Supplier review';
}

function receiptState(shipment: OrderRecord, receivedComplete: boolean) {
  if (receivedComplete || Number(shipment.status) >= 3) return 'Received';
  if (Number(shipment.status) === 2) return 'Partially received';
  return 'Awaiting receipt';
}

function batchStatus(batch?: OrderRecord) {
  return Number(batch?.status) === 2
    ? 'Suspended'
    : Number(batch?.status) === 3
      ? 'Recalled'
      : Number(batch?.status) === 1
        ? 'Active'
        : 'Status unavailable';
}

function batchVariant(batch?: OrderRecord) {
  return Number(batch?.status) === 1
    ? ('verified' as const)
    : Number(batch?.status) === 2 || Number(batch?.status) === 3
      ? ('rejected' as const)
      : ('default' as const);
}

function locationName(data: OrdersState, id: string | undefined, fallback: string) {
  if (!id) return fallback;
  return (
    data.logistics?.warehouses.find((entry) => same(entry.location, id))?.name ??
    data.locations.find((entry) => same(entry.location, id))?.label ??
    fallback
  );
}

function companyName(data: OrdersState, wallet: string | undefined, fallback: string) {
  return data.companies?.find((entry) => same(entry.wallet, wallet))?.companyName ?? fallback;
}

function companyLogo(data: OrdersState, wallet: string | undefined) {
  return data.companies?.find((entry) => same(entry.wallet, wallet))?.logoPath;
}

function quantity(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    return BigInt(String(value));
  } catch {
    return undefined;
  }
}

function maxZero(value: bigint | undefined) {
  return value === undefined || value < 0n ? 0n : value;
}

function dateTime(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1_000).toLocaleString()
    : 'Not recorded';
}

function timeOrLabel(value: unknown, fallback: string) {
  return Number(value) ? dateTime(value) : fallback;
}

function shipmentReference(value?: string) {
  return value ? `SHP-${value.replace(/^0x/, '').slice(0, 8).toUpperCase()}` : 'Not recorded';
}

function same(left?: string, right?: string) {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function hasValue(value: unknown) {
  return typeof value === 'string' && !!value && !/^0x0+$/.test(value);
}
