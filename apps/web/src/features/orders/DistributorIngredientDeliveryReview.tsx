import { BackNavigation } from '../../components/ui/BackNavigation';
import {
  CalendarClock,
  ClipboardCheck,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Truck,
  Warehouse,
} from 'lucide-react';

import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord, OrdersState } from './orders.api';
import { Alert, Badge, Btn, Card, StatusTimeline, TechnicalDetails } from '../workspaces/shared/ui';

export function DistributorIngredientDeliveryReview({
  data,
  order,
  item,
  warehouseName,
  destinationName,
  busy,
  evidenceHref,
  onBack,
  onRefresh,
  onRecordDispatch,
}: {
  data: OrdersState;
  order: OrderRecord;
  item?: OrderRecord;
  warehouseName: string;
  destinationName: string;
  busy: boolean;
  evidenceHref: string;
  onBack: () => void;
  onRefresh: () => void;
  onRecordDispatch: () => void;
}) {
  const supplierName =
    order.sellerName ?? item?.sellerName ?? companyName(data, order.seller, 'Registered Supplier');
  const manufacturerName =
    order.buyerName ?? companyName(data, order.buyer, 'Registered Manufacturer');
  const remaining = (BigInt(order.requested) - BigInt(order.custodyOrder.dispatched)).toString();
  const evidenceCurrent =
    !!order.delivery?.identityCredentialHash &&
    !/^0x0+$/.test(order.delivery.identityCredentialHash) &&
    Number(order.delivery.identityValidUntil) > Date.now() / 1_000;
  const timeline = [
    {
      actor: supplierName,
      detail: `${remaining} ${order.custodyOrder.unit} reserved at ${warehouseName}`,
      icon: <ClipboardCheck size={24} />,
      label: 'Delivery arranged',
      state: 'complete' as const,
    },
    {
      actor:
        data.companies?.find((company) => same(company.wallet, data.actor))?.companyName ??
        'Your Distributor company',
      detail: 'Review the route before recording physical dispatch',
      icon: <PackageCheck size={24} />,
      label: 'Distributor dispatches',
      state: 'current' as const,
    },
    {
      actor: 'Road delivery',
      icon: <Truck size={24} />,
      label: 'In transit',
      state: 'pending' as const,
    },
    {
      actor: manufacturerName,
      icon: <Warehouse size={24} />,
      label: 'Manufacturer receives',
      state: 'pending' as const,
    },
  ];

  return (
    <section className="distributor-delivery-review" aria-label="Ingredient delivery review">
      <BackNavigation onClick={onBack}>Ingredient deliveries</BackNavigation>
      <header className="workspace-arrival-detail__header">
        <span className="workspace-arrival-detail__header-icon" aria-hidden="true">
          <Truck size={30} />
        </span>
        <div>
          <h2>Ingredient delivery review</h2>
          <p>Review the reserved stock, companies and route before recording dispatch.</p>
        </div>
        <Btn variant="outline" icon={<RefreshCw size={16} />} disabled={busy} onClick={onRefresh}>
          Refresh
        </Btn>
      </header>

      <StatusTimeline label="Ingredient delivery progress" steps={timeline} variant="arrival" />

      <Card>
        <div className="workspace-arrival-summary__heading">
          <h3>Delivery summary</h3>
          <Badge label="Awaiting dispatch" variant="pending" />
        </div>
        <div className="workspace-arrival-summary">
          <div className="workspace-arrival-summary__identity">
            <div className="workspace-arrival-summary__image">
              <CatalogueImage
                path={item?.imagePath}
                alt={item?.name ?? 'Registered ingredient'}
                category={item?.category ?? 'Ingredient'}
              />
            </div>
            <div>
              <strong>{item?.name ?? 'Registered ingredient'}</strong>
              <span>{item?.batchReference ?? 'Batch reference unavailable'}</span>
            </div>
          </div>
          <dl className="workspace-arrival-summary__facts distributor-delivery-review__facts">
            <div>
              <dt>
                <PackageCheck size={15} /> Quantity
              </dt>
              <dd>
                {remaining} {order.custodyOrder.unit}
              </dd>
            </div>
            <div>
              <dt>
                <Warehouse size={15} /> Origin warehouse
              </dt>
              <dd>{warehouseName}</dd>
            </div>
            <div>
              <dt>
                <Truck size={15} /> Destination
              </dt>
              <dd>{destinationName}</dd>
            </div>
            <div>
              <dt>
                <CalendarClock size={15} /> Expected arrival
              </dt>
              <dd>{formatTime(order.custodyOrder.expectedAt)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <div className="workspace-arrival-detail__columns">
        <section className="workspace-arrival-panel" aria-labelledby="delivery-parties-title">
          <h3 id="delivery-parties-title">
            <Truck size={20} aria-hidden="true" /> Delivery information
          </h3>
          <div className="distributor-delivery-review__companies">
            <CompanyRow
              label="Supplier"
              name={supplierName}
              logoPath={order.sellerLogoPath ?? item?.sellerLogoPath}
            />
            <CompanyRow
              label="Manufacturer"
              name={manufacturerName}
              logoPath={order.buyerLogoPath}
            />
          </div>
          <dl className="workspace-arrival-delivery-list">
            <div>
              <dt>Warehouse</dt>
              <dd>{warehouseName}</dd>
            </div>
            <div>
              <dt>Vehicle</dt>
              <dd>{order.custodyOrder.vehicle || 'Recorded during dispatch'}</dd>
            </div>
            <div>
              <dt>Scheduled pickup</dt>
              <dd>{formatTime(order.custodyOrder.pickupAt ?? order.custodyOrder.arrangedAt)}</dd>
            </div>
            <div>
              <dt>Expected arrival</dt>
              <dd>{formatTime(order.custodyOrder.expectedAt)}</dd>
            </div>
          </dl>
          <div className="distributor-delivery-review__route">
            <strong>Complete route</strong>
            <p>
              {supplierName} → {warehouseName} → {manufacturerName}
            </p>
            <small>Destination: {destinationName}</small>
          </div>
          <Alert
            type="info"
            message="Opening this review does not prepare or submit a blockchain transaction."
          />
        </section>

        <section className="workspace-arrival-panel" aria-labelledby="delivery-action-title">
          <h3 id="delivery-action-title">
            <PackageCheck size={20} aria-hidden="true" /> Next action
          </h3>
          <p className="distributor-delivery-review__next">
            Confirm the physical stock, route, vehicle and delivery times before recording dispatch.
          </p>
          <div className="distributor-delivery-review__evidence">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <span>Supplier company evidence</span>
              <strong>{evidenceCurrent ? 'Current' : 'Not currently verified'}</strong>
            </div>
          </div>
          <a className="workspace-custody-detail__evidence-link" href={evidenceHref}>
            Manage Supplier credential request
          </a>
          <Alert
            type="warning"
            message="The final dispatch action requires confirmation in MetaMask. TraceChain never signs on your behalf."
          />
          <Btn icon={<Truck size={16} />} disabled={busy} onClick={onRecordDispatch}>
            Record dispatch
          </Btn>
        </section>
      </div>

      <div className="workspace-arrival-detail__technical">
        <TechnicalDetails
          fields={[
            { label: 'Order ID', value: order.orderId },
            { label: 'Ingredient batch ID', value: order.custodyOrder.batchId },
            { label: 'Supplier wallet', value: order.seller },
            { label: 'Distributor wallet', value: order.custodyOrder.distributor },
            { label: 'Manufacturer wallet', value: order.buyer },
            { label: 'Warehouse location ID', value: order.custodyOrder.location },
            { label: 'Destination location ID', value: order.custodyOrder.receivingLocation },
          ]}
        />
      </div>
    </section>
  );
}

function CompanyRow({ label, name, logoPath }: { label: string; name: string; logoPath?: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        <CompanyAvatar name={name} logoPath={logoPath} size="md" />
        {name}
      </strong>
    </div>
  );
}

function companyName(data: OrdersState, wallet: string | undefined, fallback: string) {
  return data.companies?.find((company) => same(company.wallet, wallet))?.companyName ?? fallback;
}

function same(left?: string, right?: string) {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function formatTime(value: unknown) {
  if (!value) return 'Recorded during dispatch';
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Recorded during dispatch';
  }
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1_000).toLocaleString()
    : 'Recorded during dispatch';
}
