import { ArrowRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { WorkspaceRole } from './workspace-navigation';
import { workspacePath } from './workspace-paths';

const startingPoints: Record<WorkspaceRole, readonly (readonly [string, string, string])[]> = {
  admin: [
    ['applications', 'Review applications', 'Approve or reject company registrations.'],
    [
      'credentials',
      'Manage companies',
      'Review company access, credentials and individual permissions.',
    ],
    ['roles', 'Role permissions', 'Set default permissions for each role.'],
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

/** Overview quick actions, rendered by each overview directly under its page title. */
export function WorkspaceGuide() {
  const role = useLocation().pathname.split('/')[1] as WorkspaceRole;
  const points = startingPoints[role];
  if (!points) return null;
  return (
    <section className="workspace-start" aria-label="Quick actions">
      {points.map(([id, label, description]) => (
        <Link key={id} to={workspacePath(role, id)}>
          <strong>
            {label}
            <ArrowRight size={16} aria-hidden="true" />
          </strong>
          <span>{description}</span>
        </Link>
      ))}
    </section>
  );
}
