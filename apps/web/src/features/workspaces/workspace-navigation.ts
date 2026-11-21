import {
  LayoutDashboard,
  ClipboardList,
  BadgeCheck,
  ShieldCheck,
  ChartNoAxesCombined,
  Layers,
  Inbox,
  Package,
  ArrowRightLeft,
  Truck,
  Warehouse,
  ScanQrCode,
  History,
  AlertTriangle,
  MapPin,
  Route,
  Send,
  KeyRound,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceKey } from './workspace-config';
import type { TraceChainWorkspaceRole } from '@tracechain/shared';
export type WorkspaceRole = WorkspaceKey & TraceChainWorkspaceRole;
export const workspaceNavigation = {
  admin: [
    ['overview', 'Overview', LayoutDashboard],
    ['applications', 'Applications', ClipboardList],
    ['credentials', 'Manage companies', BadgeCheck],
    ['roles', 'Role permissions', ShieldCheck],
    ['matrix', 'Permission matrix', Layers],
    // ['discrepancies', 'Receipt discrepancies', AlertTriangle],
    ['audit', 'Audit reports', ChartNoAxesCombined],
    ['keystore', 'Administrator keystore', KeyRound],
  ],
  supplier: [
    ['overview', 'Overview', LayoutDashboard],
    ['batches', 'My ingredients', Layers],
    ['orders', 'Incoming orders', ClipboardList],
    ['transfers', 'Send to custody', ArrowRightLeft],
    ['shipments', 'Shipment tracking', Truck],
    ['inventory', 'My stock in custody', Warehouse],
    ['requests', 'Received requests', Inbox],
    ['sent-requests', 'Sent requests', Send],
    ['traceability', 'Trace ingredients forward', Route],
    ['mycredential', 'My company identity', BadgeCheck],
    ['profile', 'Company profile & locations', MapPin],
    ['audit', 'Audit history', History],
  ],
  manufacturer: [
    ['overview', 'Overview', LayoutDashboard],
    ['products', 'My products', Package],
    ['ingredients', 'Supplier ingredients', Layers],
    ['orders', 'Ingredient orders', ClipboardList],
    ['product-orders', 'Incoming product orders', ClipboardList],
    ['shipments', 'Incoming ingredients', Truck],
    ['product-shipments', 'Outgoing products', Truck],
    ['transfers', 'Send products to custody', ArrowRightLeft],
    ['inventory', 'My products in custody', Warehouse],
    ['requests', 'Received requests', Inbox],
    ['sent-requests', 'Sent requests', Send],
    ['traceability', 'Traceability', Route],
    ['mycredential', 'My company identity', BadgeCheck],
    ['profile', 'Company profile & locations', MapPin],
    ['audit', 'Audit reports', History],
  ],
  distributor: [
    ['overview', 'Overview', LayoutDashboard],
    ['intake', 'Custody offers', Inbox],
    ['arrivals', 'Warehouse arrivals', Truck],
    ['shipments', 'Ingredient deliveries', Truck],
    ['product-shipments', 'Product deliveries', Truck],
    ['inventory', 'Ingredient custody', Warehouse],
    ['product-inventory', 'Product custody', Warehouse],
    ['requests', 'Received requests', Inbox],
    ['sent-requests', 'Sent requests', Send],
    ['traceability', 'Traceability', Route],
    ['mycredential', 'My company identity', BadgeCheck],
    ['profile', 'Company profile & warehouses', MapPin],
    ['audit', 'Audit reports', History],
  ],
  retailer: [
    ['overview', 'Overview', LayoutDashboard],
    ['browse', 'Browse products', Package],
    ['orders', 'My product orders', ClipboardList],
    ['shipments', 'Incoming products', Truck],
    ['history', 'Received products', History],
    ['traceability', 'Trace products to source', Route],
    ['scan', 'Scan product QR', ScanQrCode],
    ['requests', 'Received requests', Inbox],
    ['sent-requests', 'Sent requests', Send],
    ['mycredential', 'My company identity', BadgeCheck],
    ['profile', 'Company profile & locations', MapPin],
    ['audit', 'Audit reports', History],
  ],
} as const satisfies Record<WorkspaceRole, readonly (readonly [string, string, LucideIcon])[]>;
export function isWorkspaceRole(value: string | undefined): value is WorkspaceRole {
  return !!value && Object.hasOwn(workspaceNavigation, value);
}
export function workspaceNavigationGroups(role: WorkspaceRole) {
  const definitions: readonly (readonly [string, readonly string[]])[] =
    role === 'admin'
      ? [
          ['Workspace', ['overview']],
          ['Company administration', ['applications', 'credentials']],
          ['Permissions', ['roles', 'matrix']],
          ['Review & records', ['discrepancies', 'audit', 'keystore']],
        ]
      : [
          ['Workspace', ['overview']],
          [
            'Stock & products',
            ['batches', 'products', 'ingredients', 'inventory', 'product-inventory', 'history'],
          ],
          ['Orders', ['browse', 'orders', 'product-orders']],
          ['Shipments', ['intake', 'arrivals', 'transfers', 'shipments', 'product-shipments']],
          ['Information requests', ['requests', 'sent-requests']],
          ['Traceability', ['traceability', 'scan']],
          ['Profile', ['mycredential', 'profile', 'audit']],
        ];
  return definitions
    .map(([label, ids]) => ({
      label,
      items: ids.flatMap((id) => workspaceNavigation[role].filter((item) => item[0] === id)),
    }))
    .filter((group) => group.items.length);
}
