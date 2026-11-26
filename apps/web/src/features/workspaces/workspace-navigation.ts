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
  MapPin,
  Route,
  Send,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceKey } from './workspace-config';
import type { TraceChainWorkspaceRole } from '@tracechain/shared';
export type WorkspaceRole = WorkspaceKey & TraceChainWorkspaceRole;
/** Every routable page per role, with its page title. The sidebar shows a subset (see sections). */
export const workspaceNavigation = {
  admin: [
    ['overview', 'Overview', LayoutDashboard],
    ['applications', 'Applications', ClipboardList],
    ['credentials', 'Manage companies', BadgeCheck],
    ['roles', 'Role permissions', ShieldCheck],
    ['matrix', 'Permission matrix', Layers],
    // ['discrepancies', 'Receipt discrepancies', AlertTriangle],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  supplier: [
    ['overview', 'Overview', LayoutDashboard],
    ['batches', 'My ingredients', Layers],
    ['orders', 'Incoming orders', ClipboardList],
    ['transfers', 'Send to custody', ArrowRightLeft],
    ['shipments', 'Shipments', Truck],
    ['inventory', 'Stock at distributors', Warehouse],
    ['requests', 'Evidence Exchange', Inbox],
    ['sent-requests', 'Evidence Exchange', Send],
    ['traceability', 'Trace ingredients', Route],
    ['mycredential', 'Company identity', BadgeCheck],
    ['profile', 'Profile & locations', MapPin],
    ['audit', 'Activity log', History],
  ],
  manufacturer: [
    ['overview', 'Overview', LayoutDashboard],
    ['products', 'My products', Package],
    ['ingredients', 'Supplier ingredients', Layers],
    ['orders', 'Buying ingredients', ClipboardList],
    ['product-orders', 'Selling products', ClipboardList],
    ['shipments', 'Incoming ingredients', Truck],
    ['product-shipments', 'Outgoing products', Truck],
    ['transfers', 'Send to custody', ArrowRightLeft],
    ['inventory', 'Stock at distributors', Warehouse],
    ['requests', 'Evidence Exchange', Inbox],
    ['sent-requests', 'Evidence Exchange', Send],
    ['traceability', 'Traceability', Route],
    ['mycredential', 'Company identity', BadgeCheck],
    ['profile', 'Profile & locations', MapPin],
    ['audit', 'Activity log', History],
  ],
  distributor: [
    ['overview', 'Overview', LayoutDashboard],
    ['intake', 'Custody offers', Inbox],
    ['arrivals', 'Warehouse arrivals', Truck],
    ['shipments', 'Ingredient deliveries', Truck],
    ['product-shipments', 'Product deliveries', Truck],
    ['inventory', 'Ingredient stock', Warehouse],
    ['product-inventory', 'Product stock', Warehouse],
    ['requests', 'Evidence Exchange', Inbox],
    ['sent-requests', 'Evidence Exchange', Send],
    ['traceability', 'Traceability', Route],
    ['mycredential', 'Company identity', BadgeCheck],
    ['profile', 'Profile & warehouses', MapPin],
    ['audit', 'Activity log', History],
  ],
  retailer: [
    ['overview', 'Overview', LayoutDashboard],
    ['browse', 'Browse products', Package],
    ['orders', 'My orders', ClipboardList],
    ['shipments', 'Incoming deliveries', Truck],
    ['history', 'Received products', History],
    ['traceability', 'Trace a product', Route],
    ['scan', 'Scan product QR', ScanQrCode],
    ['requests', 'Evidence Exchange', Inbox],
    ['sent-requests', 'Evidence Exchange', Send],
    ['mycredential', 'Company identity', BadgeCheck],
    ['profile', 'Profile & locations', MapPin],
    ['audit', 'Activity log', History],
  ],
} as const satisfies Record<WorkspaceRole, readonly (readonly [string, string, LucideIcon])[]>;

/** Pages shown as tabs of one sidebar entry. The first page is the entry's link. */
export type WorkspaceSection = { label: string; pages: readonly (readonly [string, string])[] };
const workspaceSections: Partial<Record<WorkspaceRole, readonly WorkspaceSection[]>> = {
  supplier: [
    {
      label: 'Custody',
      pages: [
        ['inventory', 'Stock at distributors'],
        ['transfers', 'Send to custody'],
      ],
    },
  ],
  manufacturer: [
    {
      label: 'Orders',
      pages: [
        ['orders', 'Buying ingredients'],
        ['product-orders', 'Selling products'],
      ],
    },
    {
      label: 'Shipments',
      pages: [
        ['shipments', 'Incoming ingredients'],
        ['product-shipments', 'Outgoing products'],
      ],
    },
    {
      label: 'Custody',
      pages: [
        ['inventory', 'Stock at distributors'],
        ['transfers', 'Send to custody'],
      ],
    },
  ],
  distributor: [
    {
      label: 'Deliveries',
      pages: [
        ['shipments', 'Ingredients'],
        ['product-shipments', 'Products'],
      ],
    },
    {
      label: 'Warehouse stock',
      pages: [
        ['inventory', 'Ingredients'],
        ['product-inventory', 'Products'],
      ],
    },
  ],
  retailer: [
    {
      label: 'Deliveries',
      pages: [
        ['shipments', 'Incoming'],
        ['history', 'Received'],
      ],
    },
    {
      label: 'Trace a product',
      pages: [
        ['traceability', 'Search'],
        ['scan', 'Scan QR'],
      ],
    },
  ],
};
export function workspaceSection(role: WorkspaceRole, page: string) {
  return workspaceSections[role]?.find((section) => section.pages.some(([id]) => id === page));
}

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
          ['Review & records', ['discrepancies', 'audit']],
        ]
      : [
          ['Home', ['overview']],
          ['Products', ['batches', 'products', 'ingredients', 'browse']],
          ['Orders', ['orders', 'product-orders']],
          [
            'Logistics',
            [
              'intake',
              'arrivals',
              'shipments',
              'product-shipments',
              'history',
              'inventory',
              'product-inventory',
              'transfers',
            ],
          ],
          ['Evidence & tracing', ['requests', 'traceability', 'scan']],
          ['Company', ['mycredential', 'profile', 'audit']],
        ];
  return definitions
    .map(([label, ids]) => ({
      label,
      items: ids.flatMap((id) => {
        const section = workspaceSection(role, id);
        // A merged section shows once, under its own label, linking to its first page.
        if (section && section.pages[0]![0] !== id) return [];
        return workspaceNavigation[role]
          .filter((item) => item[0] === id)
          .map(([, title, icon]) => [id, section?.label ?? title, icon] as const);
      }),
    }))
    .filter((group) => group.items.length);
}
