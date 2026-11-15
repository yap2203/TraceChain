import type { WorkspaceRole } from './workspace-navigation';

// Map internal page identifiers to the canonical system URLs.
const paths: Record<WorkspaceRole, Record<string, string>> = {
  admin: { requests: 'information-requests', accesscontrol: 'stakeholders', audit: 'reports' },
  supplier: {
    batches: 'ingredients',
    requests: 'information-requests',
    mycredential: 'credentials',
    audit: 'reports',
  },
  manufacturer: {
    requests: 'information-requests',
    evidence: 'information-requests',
    products: 'product-batches',
    mycredential: 'credentials',
    audit: 'reports',
  },
  distributor: {
    requests: 'information-requests',
    incoming: 'incoming-shipments',
    mycredential: 'credentials',
    audit: 'reports',
  },
  retailer: {
    receive: 'incoming-products',
    scan: 'scan',
    history: 'traceability',
    requests: 'information-requests',
    evidence: 'information-requests',
    mycredential: 'credentials',
    audit: 'reports',
  },
};

export function workspacePath(role: WorkspaceRole, page: string) {
  return `/${role}/${paths[role][page] ?? page}`;
}

export function workspacePage(role: WorkspaceRole, path: string) {
  if ((role === 'supplier' || role === 'retailer') && path === 'evidence-requests')
    return 'requests';
  if (
    role === 'distributor' &&
    ['orders', 'ingredient-deliveries', 'incoming-shipments'].includes(path)
  )
    return 'shipments';
  if (role === 'manufacturer' && (path === 'ingredient-evidence' || path === 'evidence'))
    return 'requests';
  return Object.entries(paths[role]).find(([, value]) => value === path)?.[0] ?? path;
}
