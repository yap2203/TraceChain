import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { WorkspaceRole } from './workspace-navigation';

const startingPoints: Record<WorkspaceRole, readonly (readonly [string, string, string])[]> = {
  admin: [
    ['applications', 'Review applications', 'Approve or reject company registrations.'],
    ['credentials', 'Manage credentials', 'Review issued credentials and their status.'],
    ['accesscontrol', 'Manage access', 'Set role and individual permissions.'],
  ],
  supplier: [
    ['batches', 'Manage ingredients', 'Register batches and check your remaining stock.'],
    ['orders', 'Review orders', 'Approve requests and arrange delivery.'],
    ['shipments', 'Track shipments', 'Follow custody intake and onward delivery.'],
  ],
  manufacturer: [
    ['products', 'Manage products', 'Create products from received ingredients.'],
    ['orders', 'Manage ingredient orders', 'Track requests sent to Suppliers.'],
    ['shipments', 'Receive ingredients', 'Scan the shipment QR when goods arrive.'],
  ],
  distributor: [
    ['intake', 'Review custody offers', 'Accept stock and arrange the pickup time.'],
    ['inventory', 'Check custody stock', 'See stock held by your company.'],
    ['shipments', 'Manage deliveries', 'Dispatch assigned deliveries to buyers.'],
  ],
  retailer: [
    ['browse', 'Find products', 'View product details and request quantities.'],
    ['shipments', 'Receive products', 'Track delivery and scan goods on arrival.'],
    ['traceability', 'Check traceability', 'Follow received products back to their source.'],
  ],
};

export function WorkspaceGuide({
  role,
  page,
  pathForPage,
}: {
  role: WorkspaceRole;
  page: string;
  pathForPage: (page: string) => string;
}) {
  if (page === 'overview')
    return (
      <section className="workspace-start" aria-label="Quick actions">
        {startingPoints[role].map(([id, label, description]) => (
          <Link key={id} to={pathForPage(id)}>
            <strong>
              {label}
              <ArrowRight size={16} aria-hidden="true" />
            </strong>
            <span>{description}</span>
          </Link>
        ))}
      </section>
    );
  return null;
}
