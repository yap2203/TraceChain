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
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceKey } from './workspace-config';

export type WorkspaceRole = WorkspaceKey;
export const workspaceNavigation = {
  admin: [
    ['overview', 'Overview', LayoutDashboard],
    ['applications', 'Applications', ClipboardList],
    ['credentials', 'Credentials', BadgeCheck],
    ['accesscontrol', 'Access control', ShieldCheck],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  supplier: [
    ['overview', 'Overview', LayoutDashboard],
    ['batches', 'Ingredient batches', Layers],
    ['requests', 'Information requests', Inbox],
    ['mycredential', 'My credential', ContactRound],
    ['audit', 'Audit history', ChartNoAxesCombined],
  ],
  manufacturer: [
    ['overview', 'Overview', LayoutDashboard],
    ['evidence', 'Ingredient evidence', FlaskConical],
    ['products', 'Product batches', Package],
    ['transfers', 'Transfers', ArrowRightLeft],
    ['mycredential', 'My credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  distributor: [
    ['overview', 'Overview', LayoutDashboard],
    ['incoming', 'Incoming shipments', Truck],
    ['inventory', 'Custody inventory', Warehouse],
    ['transfers', 'Transfers', ArrowRightLeft],
    ['mycredential', 'My credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
  retailer: [
    ['overview', 'Overview', LayoutDashboard],
    ['receive', 'Receive products', PackageCheck],
    ['scan', 'Scan & verify', ScanQrCode],
    ['history', 'Product history', History],
    ['evidence', 'Evidence requests', FileSearch],
    ['mycredential', 'My credential', ContactRound],
    ['audit', 'Audit reports', ChartNoAxesCombined],
  ],
} as const satisfies Record<WorkspaceRole, readonly (readonly [string, string, LucideIcon])[]>;

export function isWorkspaceRole(value: string | undefined): value is WorkspaceRole {
  return !!value && Object.hasOwn(workspaceNavigation, value);
}
