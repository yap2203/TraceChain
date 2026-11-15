import {
  LayoutDashboard,
  ClipboardList,
  BadgeCheck,
  ShieldCheck,
  ChartNoAxesCombined,
  Layers,
  Inbox,
  ContactRound,
  FileSearch,
  Package,
  ArrowRightLeft,
  Truck,
  Warehouse,
  PackageCheck,
  ScanQrCode,
  History,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceKey } from './workspace-config';
import type { TraceChainWorkspaceRole } from '@tracechain/shared';

export type WorkspaceRole = WorkspaceKey & TraceChainWorkspaceRole;
export const workspaceNavigation = {
  admin: [
    ['overview', 'Overview', LayoutDashboard],
    ['requests', 'Information requests', Inbox],
    ['orders', 'Requests & recall', ClipboardList],
    ['applications', 'Applications', ClipboardList],
    ['credentials', 'Credentials', BadgeCheck],
    ['accesscontrol', 'Access control', ShieldCheck],
    ['discrepancies', 'Receipt discrepancies', AlertTriangle],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  supplier: [
    ['overview', 'Overview', LayoutDashboard],
    ['orders', 'Order requests', ClipboardList],
    ['batches', 'Ingredient batches', Layers],
    ['transfers', 'Send to custody', ArrowRightLeft],
    ['inventory', 'Custody inventory', Warehouse],
    ['shipments', 'Sent shipments', Truck],
    ['requests', 'Information requests', Inbox],
    ['mycredential', 'My company credential', ContactRound],
    ['audit', 'Audit history', ChartNoAxesCombined],
  ],
  manufacturer: [
    ['overview', 'Overview', LayoutDashboard],
    ['products', 'Products', Package],
    ['shipments', 'Shipments', Truck],
    ['orders', 'My orders', ClipboardList],
    ['requests', 'Information requests', Inbox],
    ['transfers', 'Transfers', ArrowRightLeft],
    ['mycredential', 'My company credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  distributor: [
    ['overview', 'Overview', LayoutDashboard],
    ['requests', 'Information requests', Inbox],
    ['shipments', 'Custody & deliveries', Truck],
    ['inventory', 'Custody inventory', Warehouse],
    ['transfers', 'Product transfers', ArrowRightLeft],
    ['mycredential', 'My company credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  retailer: [
    ['overview', 'Overview', LayoutDashboard],
    ['orders', 'Browse & requests', ClipboardList],
    ['receive', 'Receive products', PackageCheck],
    ['scan', 'Scan & verify', ScanQrCode],
    ['history', 'Product history', History],
    ['requests', 'Information requests', FileSearch],
    ['mycredential', 'My company credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
} as const satisfies Record<WorkspaceRole, readonly (readonly [string, string, LucideIcon])[]>;

export function isWorkspaceRole(value: string | undefined): value is WorkspaceRole {
  return !!value && Object.hasOwn(workspaceNavigation, value);
}
