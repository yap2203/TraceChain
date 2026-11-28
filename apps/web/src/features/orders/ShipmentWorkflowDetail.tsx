import { BackNavigation } from '../../components/ui/BackNavigation';
import type { ReactNode } from 'react';
import {
  Box,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  PackageCheck,
  RefreshCw,
  Truck,
  Warehouse,
} from 'lucide-react';
import type { OrderRecord } from './orders.api';
import { CatalogueImage } from './CatalogueMedia';
import { Alert, Badge, Btn, Card, StatusTimeline, TechnicalDetails } from '../workspaces/shared/ui';
import { shipmentStatusVariant } from '../workspaces/shared/shipment-status';
import type { TechnicalField } from '../workspaces/shared/ui/TechnicalDetails';

const when = (value: unknown) =>
  Number(value) ? new Date(Number(value) * 1000).toLocaleString() : 'Unavailable';

export function ShipmentWorkflowDetail({
  shipment,
  catalogueItem,
  senderName,
  recipientName,
  sourceName,
  destinationName,
  qrVerified,
  busy,
  title = 'Custody Intake',
  subtitle = 'Review shipment details and confirm warehouse receipt.',
  actionTitle = 'Receipt Confirmation',
  backLabel,
  onBack,
  onRefresh,
  refreshStatus,
  receiptContent,
  additionalContent,
  technicalFields,
  workflowVariant = 'shipment',
  statusLabel,
}: {
  shipment: OrderRecord;
  catalogueItem?: OrderRecord;
  senderName: string;
  recipientName: string;
  sourceName: string;
  destinationName: string;
  qrVerified: boolean;
  busy: boolean;
  title?: string;
  subtitle?: string;
  actionTitle?: string;
  backLabel?: string;
  onBack?: () => void;
  onRefresh: () => void;
  refreshStatus?: ReactNode;
  receiptContent: ReactNode;
  additionalContent?: ReactNode;
  technicalFields: TechnicalField[];
  workflowVariant?: 'shipment' | 'ingredient-delivery';
  /** The status the shipment list shows, so list and detail always agree. */
  statusLabel?: string;
}) {
  const status = Number(shipment.status);
  const complete = shipment.kind === 'product' ? status === 2 : status === 3 || status === 5;
  const partiallyReceived = shipment.kind === 'ingredient' && status === 2;
  const expectedPassed = Number(shipment.expectedAt) <= Date.now() / 1000;
  const arrived = complete || partiallyReceived || qrVerified;
  const productName = shipment.itemName ?? catalogueItem?.name ?? 'Registered shipment item';
  const shipmentReference = `SHP-${shipment.shipmentId.slice(2, 10).toUpperCase()}`;
  const progress =
    workflowVariant === 'ingredient-delivery'
      ? [
          {
            actor: `${senderName} → ${sourceName}`,
            icon: <ClipboardCheck size={25} />,
            label: 'Delivery arranged',
            state: 'complete' as const,
          },
          {
            actor: when(shipment.dispatchedAt),
            icon: <PackageCheck size={25} />,
            label: 'Distributor dispatches',
            state: 'complete' as const,
          },
          {
            actor: complete || expectedPassed ? 'Transit completed' : 'Shipment is on the way',
            detail:
              !complete && !expectedPassed && shipment.expectedAt
                ? `Expected ${when(shipment.expectedAt)}`
                : undefined,
            icon: <Truck size={25} />,
            label: 'In transit',
            state:
              complete || expectedPassed || partiallyReceived
                ? ('complete' as const)
                : ('current' as const),
          },
          {
            actor: complete ? when(shipment.receivedAt) : recipientName,
            detail: complete ? 'Physical receipt confirmed' : 'Awaiting physical receipt',
            icon: <Warehouse size={25} />,
            label: 'Manufacturer receives',
            state: complete
              ? ('complete' as const)
              : expectedPassed || partiallyReceived
                ? ('current' as const)
                : ('pending' as const),
          },
        ]
      : [
          {
            actor: when(shipment.dispatchedAt),
            icon: <PackageCheck size={25} />,
            label: 'Dispatched',
            state: 'complete' as const,
          },
          {
            actor: arrived ? 'Transit completed' : 'Shipment is on the way',
            detail:
              !arrived && shipment.expectedAt ? `Expected ${when(shipment.expectedAt)}` : undefined,
            icon: <Truck size={25} />,
            label: 'In Transit',
            state: arrived
              ? ('complete' as const)
              : expectedPassed
                ? ('complete' as const)
                : ('current' as const),
          },
          {
            actor: arrived
              ? 'Shipment label verified'
              : expectedPassed
                ? 'Awaiting QR verification'
                : 'Not yet arrived',
            icon: <MapPin size={25} />,
            label: 'Arrived',
            state: arrived
              ? ('complete' as const)
              : expectedPassed
                ? ('current' as const)
                : ('pending' as const),
          },
          {
            actor: complete ? when(shipment.receivedAt) : 'Pending confirmation',
            icon: <Warehouse size={25} />,
            label: 'Received',
            state: complete
              ? ('complete' as const)
              : arrived || partiallyReceived
                ? ('current' as const)
                : ('pending' as const),
          },
        ];

  return (
    <section
      className="workspace-arrival-detail"
      aria-label={
        workflowVariant === 'ingredient-delivery'
          ? 'Ingredient delivery detail'
          : 'Custody intake shipment detail'
      }
    >
      {onBack && <BackNavigation onClick={onBack}>{backLabel ?? 'Shipments'}</BackNavigation>}
      <header className="workspace-arrival-detail__header">
        <span className="workspace-arrival-detail__header-icon" aria-hidden="true">
          <Box size={31} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {refreshStatus}
          <Btn variant="outline" icon={<RefreshCw size={16} />} disabled={busy} onClick={onRefresh}>
            Refresh
          </Btn>
        </div>
      </header>

      <StatusTimeline label="Shipment progress" steps={progress} variant="arrival" />

      <Card>
        <div className="workspace-arrival-summary__heading">
          <h3>Shipment Summary</h3>
          {statusLabel && !(qrVerified && !complete) ? (
            <Badge label={statusLabel} variant={shipmentStatusVariant(statusLabel)} />
          ) : (
            <Badge
              label={complete ? 'Received' : qrVerified ? 'Ready to confirm' : 'Awaiting receipt'}
              variant={complete ? 'verified' : qrVerified ? 'accepted' : 'shared'}
            />
          )}
        </div>
        <div className="workspace-arrival-summary">
          <div className="workspace-arrival-summary__identity">
            <div className="workspace-arrival-summary__image">
              <CatalogueImage
                path={catalogueItem?.imagePath}
                alt={productName}
                category={catalogueItem?.category ?? 'Ingredient'}
              />
            </div>
            <div>
              <strong>{productName}</strong>
              <span>{shipmentReference}</span>
            </div>
          </div>
          <dl className="workspace-arrival-summary__facts">
            <div>
              <dt>
                <Box size={15} /> Quantity
              </dt>
              <dd>
                {shipment.quantity} {shipment.unit}
              </dd>
            </div>
            <div>
              <dt>
                <MapPin size={15} /> Origin
              </dt>
              <dd>{sourceName}</dd>
            </div>
            <div>
              <dt>
                <Warehouse size={15} /> Destination
              </dt>
              <dd>{destinationName}</dd>
            </div>
            <div>
              <dt>
                <CalendarClock size={15} /> Expected arrival
              </dt>
              <dd>{when(shipment.expectedAt)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <div className="workspace-arrival-detail__columns">
        <section className="workspace-arrival-panel" aria-labelledby="arrival-delivery-title">
          <h3 id="arrival-delivery-title">
            <Truck size={20} aria-hidden="true" /> Delivery Information
          </h3>
          <dl className="workspace-arrival-delivery-list">
            <div>
              <dt>Vehicle</dt>
              <dd>{shipment.vehicle || 'Pending vehicle record'}</dd>
            </div>
            <div>
              <dt>
                {workflowVariant === 'ingredient-delivery'
                  ? 'Supplier'
                  : shipment.kind === 'product'
                    ? 'Sender'
                    : 'Sender'}
              </dt>
              <dd>{senderName}</dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>{recipientName}</dd>
            </div>
            <div>
              <dt>Actual dispatch</dt>
              <dd>{when(shipment.dispatchedAt)}</dd>
            </div>
            <div>
              <dt>Blockchain recording time</dt>
              <dd>{when(shipment.recordedAt)}</dd>
            </div>
            <div>
              <dt>Route</dt>
              <dd>
                {sourceName} → {destinationName}
              </dd>
            </div>
          </dl>
          <Alert
            type="info"
            message={
              workflowVariant === 'ingredient-delivery'
                ? 'The Manufacturer verifies the physical goods and confirms receipt separately. This view does not submit a transaction.'
                : 'Verify the shipment QR and physical goods before confirming receipt. The final confirmation is recorded on the blockchain.'
            }
          />
        </section>

        <section className="workspace-arrival-panel" aria-labelledby="arrival-receipt-title">
          <h3 id="arrival-receipt-title">
            <CheckCircle2 size={20} aria-hidden="true" /> {actionTitle}
          </h3>
          {receiptContent}
        </section>
      </div>

      {additionalContent}

      <div className="workspace-arrival-detail__technical">
        <TechnicalDetails fields={technicalFields} />
      </div>
    </section>
  );
}
