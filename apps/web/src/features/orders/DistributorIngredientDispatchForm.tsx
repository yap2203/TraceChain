import { BackNavigation } from '../../components/ui/BackNavigation';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Factory,
  MapPin,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Truck,
  Warehouse,
} from 'lucide-react';

import { CatalogueImage, CompanyAvatar } from './CatalogueMedia';
import type { OrderRecord, OrdersState } from './orders.api';
import {
  Alert,
  Badge,
  Btn,
  Card,
  Input,
  StatusTimeline,
  TechnicalDetails,
} from '../workspaces/shared/ui';

export function DistributorIngredientDispatchForm({
  data,
  order,
  item,
  originName,
  destinationName,
  available,
  unit,
  quantity,
  onQuantityChange,
  vehicle,
  onVehicleChange,
  actual,
  onActualChange,
  expectedAt,
  onExpectedAtChange,
  confirmed,
  onConfirmedChange,
  evidenceHref,
  busy,
  valid,
  onBack,
  onRefresh,
  refreshStatus,
  onManageLocations,
  missingLocation,
  onSubmit,
}: {
  data: OrdersState;
  order: OrderRecord;
  item?: OrderRecord;
  originName: string;
  destinationName: string;
  available: string;
  unit: string;
  quantity: string;
  onQuantityChange: (value: string) => void;
  vehicle: string;
  onVehicleChange: (value: string) => void;
  actual: string;
  onActualChange: (value: string) => void;
  expectedAt: string;
  onExpectedAtChange: (value: string) => void;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  evidenceHref: string;
  busy: boolean;
  valid: boolean;
  onBack: () => void;
  onRefresh: () => void;
  refreshStatus?: ReactNode;
  onManageLocations: () => void;
  missingLocation: boolean;
  onSubmit: () => void;
}) {
  const supplierName =
    order.sellerName ?? item?.sellerName ?? companyName(data, order.seller, 'Registered Supplier');
  const distributorName = companyName(data, data.actor, 'Your Distributor company');
  const manufacturerName =
    order.buyerName ?? companyName(data, order.buyer, 'Registered Manufacturer');
  const distributorLogoPath = data.companies?.find((company) =>
    same(company.wallet, data.actor),
  )?.logoPath;
  const timeline = [
    {
      actor: supplierName,
      detail: `${available} ${unit} reserved for delivery`,
      icon: <ClipboardCheck size={24} />,
      label: 'Delivery arranged',
      state: 'complete' as const,
    },
    {
      actor: distributorName,
      detail: `${originName} to ${destinationName}`,
      icon: <MapPin size={24} />,
      label: 'Route confirmed',
      state: 'complete' as const,
    },
    {
      actor: distributorName,
      detail: 'Record the physical road dispatch',
      icon: <Truck size={24} />,
      label: 'Record dispatch',
      state: 'current' as const,
    },
    {
      actor: manufacturerName,
      icon: <Warehouse size={24} />,
      label: 'Manufacturer receives',
      state: 'pending' as const,
    },
  ];
  const companyRoute = [
    {
      actor: (
        <span className="distributor-dispatch__company">
          <CompanyAvatar
            name={supplierName}
            logoPath={order.sellerLogoPath ?? item?.sellerLogoPath}
            size="sm"
          />
          <span>{supplierName}</span>
        </span>
      ),
      icon: <Building2 size={18} />,
      label: 'Supplier',
      state: 'complete' as const,
    },
    {
      actor: (
        <span className="distributor-dispatch__company">
          <CompanyAvatar name={distributorName} logoPath={distributorLogoPath} size="sm" />
          <span>{distributorName}</span>
        </span>
      ),
      icon: <Truck size={18} />,
      label: 'Distributor',
      state: 'current' as const,
    },
    {
      actor: (
        <span className="distributor-dispatch__company">
          <CompanyAvatar name={manufacturerName} logoPath={order.buyerLogoPath} size="sm" />
          <span>{manufacturerName}</span>
        </span>
      ),
      icon: <Factory size={18} />,
      label: 'Manufacturer',
      state: 'pending' as const,
    },
  ];

  return (
    <section className="distributor-dispatch" aria-label="Record ingredient dispatch">
      <BackNavigation onClick={onBack}>Ingredient deliveries</BackNavigation>

      <header className="workspace-arrival-detail__header">
        <span className="workspace-arrival-detail__header-icon" aria-hidden="true">
          <Truck size={30} />
        </span>
        <div>
          <h2>Record ingredient dispatch</h2>
          <p>Confirm the reserved stock, route and physical road-dispatch details.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {refreshStatus}
          <Btn variant="outline" icon={<RefreshCw size={16} />} disabled={busy} onClick={onRefresh}>
            Refresh
          </Btn>
        </div>
      </header>

      <StatusTimeline label="Ingredient dispatch progress" steps={timeline} variant="arrival" />

      <Card>
        <div className="workspace-arrival-summary__heading">
          <h3>Dispatch summary</h3>
          <Badge label="Ready to dispatch" variant="pending" />
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
          <dl className="workspace-arrival-summary__facts distributor-dispatch__facts">
            <div>
              <dt>
                <PackageCheck size={15} /> Available allocation
              </dt>
              <dd>
                {available} {unit}
              </dd>
            </div>
            <div>
              <dt>
                <Building2 size={15} /> Supplier
              </dt>
              <dd>{supplierName}</dd>
            </div>
            <div>
              <dt>
                <Warehouse size={15} /> Manufacturer
              </dt>
              <dd>{manufacturerName}</dd>
            </div>
            <div>
              <dt>
                <CalendarClock size={15} /> Expected arrival
              </dt>
              <dd>{formatLocalDateTime(expectedAt)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <div className="workspace-arrival-detail__columns distributor-dispatch__columns">
        <section className="workspace-arrival-panel" aria-labelledby="dispatch-route-title">
          <h3 id="dispatch-route-title">
            <MapPin size={20} aria-hidden="true" /> Dispatch route
          </h3>

          <div className="distributor-dispatch__company-flow">
            <StatusTimeline label="Dispatch company route" steps={companyRoute} variant="route" />
          </div>

          <div className="distributor-dispatch__route" aria-label="Dispatch route">
            <div>
              <MapPin size={18} aria-hidden="true" />
              <span>Pickup location</span>
              <strong>{originName}</strong>
            </div>
            <ArrowRight size={20} aria-hidden="true" />
            <div>
              <Warehouse size={18} aria-hidden="true" />
              <span>Receiving location</span>
              <strong>{destinationName}</strong>
            </div>
          </div>

          <div className="distributor-dispatch__actions">
            <a className="workspace-custody-detail__evidence-link" href={evidenceHref}>
              <ShieldCheck size={17} aria-hidden="true" /> Manage Supplier credential request
            </a>
            {missingLocation && (
              <Btn variant="outline" onClick={onManageLocations}>
                Set up a missing location
              </Btn>
            )}
          </div>
          <Alert
            type="info"
            message="Reviewing does not move stock. Stock changes only after you approve the dispatch transaction in MetaMask."
          />
        </section>

        <section className="workspace-arrival-panel" aria-labelledby="road-dispatch-title">
          <h3 id="road-dispatch-title">
            <Truck size={20} aria-hidden="true" /> Road dispatch details
          </h3>
          <div className="distributor-dispatch__form-grid">
            <Input
              label={`Actual quantity dispatched (${unit})`}
              type="number"
              min="1"
              max={available}
              step="1"
              value={quantity}
              onChange={onQuantityChange}
              required
            />
            <Input
              label="Vehicle registration number"
              value={vehicle}
              onChange={(value) => onVehicleChange(value.toUpperCase())}
              required
              maxLength={32}
              placeholder="e.g. VAB 1234"
            />
            <Input
              label="Actual dispatch date and time"
              type="datetime-local"
              step="1"
              value={actual}
              onChange={onActualChange}
              required
            />
            <Input
              label="Expected arrival"
              type="datetime-local"
              step="1"
              value={expectedAt}
              onChange={onExpectedAtChange}
              required
            />
          </div>

          <Alert
            type="info"
            message="The actual dispatch time is recorded separately from the blockchain transaction time."
          />
          <label className="distributor-dispatch__confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirmedChange(event.target.checked)}
            />
            <span>
              I confirm these goods are physically leaving the selected location in the recorded
              vehicle.
            </span>
          </label>
          <Alert
            type="warning"
            message="MetaMask confirmation is required. TraceChain prepares the transaction but never signs on your behalf."
          />
          <div className="action-row">
            <Btn icon={<Truck size={17} />} disabled={busy || !valid} onClick={onSubmit}>
              {busy ? 'Recording dispatch…' : 'Confirm dispatch with MetaMask'}
            </Btn>
          </div>
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
            { label: 'Pickup location ID', value: order.custodyOrder.location },
            { label: 'Destination location ID', value: order.custodyOrder.receivingLocation },
          ]}
        />
      </div>
    </section>
  );
}

function companyName(data: OrdersState, wallet: string | undefined, fallback: string) {
  return data.companies?.find((company) => same(company.wallet, wallet))?.companyName ?? fallback;
}

function same(left?: string, right?: string) {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function formatLocalDateTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Enter an expected arrival';
}
