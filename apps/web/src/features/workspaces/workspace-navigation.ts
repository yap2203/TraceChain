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
  FlaskConical,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceKey } from './workspace-config';
import type { TraceChainWorkspaceRole } from '@tracechain/shared';

export type WorkspaceRole = WorkspaceKey & TraceChainWorkspaceRole;
export const workspaceNavigation = {
  admin: [
    ['overview', 'Overview', LayoutDashboard],
    ['orders', 'Requests & recall', ClipboardList],
    ['applications', 'Applications', ClipboardList],
    ['credentials', 'Credentials', BadgeCheck],
    ['accesscontrol', 'Access control', ShieldCheck],
    ['discrepancies', 'Receipt discrepancies', AlertTriangle],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  supplier: [
    ['overview', 'Overview', LayoutDashboard],
    ['orders', 'Manage orders', ClipboardList],
    ['batches', 'Ingredient batches', Layers],
    ['requests', 'Information requests', Inbox],
    ['mycredential', 'My company credential', ContactRound],
    ['audit', 'Audit history', ChartNoAxesCombined],
  ],
  manufacturer: [
    ['overview', 'Overview', LayoutDashboard],
    ['orders', 'Browse & requests', ClipboardList],
    ['evidence', 'Ingredient evidence', FlaskConical],
    ['products', 'Product batches', Package],
    ['transfers', 'Transfers', ArrowRightLeft],
    ['mycredential', 'My company credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  distributor: [
    ['overview', 'Overview', LayoutDashboard],
    ['orders', 'Browse & requests', ClipboardList],
    ['incoming', 'Incoming shipments', Truck],
    ['inventory', 'Custody inventory', Warehouse],
    ['transfers', 'Transfers', ArrowRightLeft],
    ['mycredential', 'My company credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  retailer: [
    ['overview', 'Overview', LayoutDashboard],
    ['orders', 'Browse & requests', ClipboardList],
    ['receive', 'Receive products', PackageCheck],
    ['scan', 'Scan & verify', ScanQrCode],
    ['history', 'Product history', History],
    ['evidence', 'Evidence requests', FileSearch],
    ['mycredential', 'My company credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
} as const satisfies Record<WorkspaceRole, readonly (readonly [string, string, LucideIcon])[]>;

export function isWorkspaceRole(value: string | undefined): value is WorkspaceRole {
  return !!value && Object.hasOwn(workspaceNavigation, value);
}
