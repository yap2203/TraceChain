import type { WorkspaceRole } from './workspace-navigation';

// Map internal page identifiers to the canonical system URLs.
const paths: Record<WorkspaceRole, Record<string, string>> = {
  admin: {
    accesscontrol: 'stakeholders',
    roles: 'permissions/roles',
    personal: 'permissions/companies',
    matrix: 'permissions/matrix',
    audit: 'reports',
  },
  supplier: {
    batches: 'ingredients',
    requests: 'information-requests',
    'sent-requests': 'information-requests/sent',
    mycredential: 'credentials',
    audit: 'reports',
  },
  manufacturer: {
    requests: 'information-requests',
    'sent-requests': 'information-requests/sent',
    evidence: 'information-requests',
    products: 'product-batches',
    mycredential: 'credentials',
    audit: 'reports',
  },
  distributor: {
    requests: 'information-requests',
    'sent-requests': 'information-requests/sent',
    incoming: 'incoming-shipments',
    mycredential: 'credentials',
    audit: 'reports',
  },
  retailer: {
    receive: 'incoming-products',
    scan: 'scan',
    history: 'received-products',
    requests: 'information-requests',
    'sent-requests': 'information-requests/sent',
    evidence: 'information-requests',
    mycredential: 'credentials',
    audit: 'reports',
  },
};

export function workspacePath(role: WorkspaceRole, page: string) {
  return `/${role}/${paths[role][page] ?? page}`;
}

export function workspacePage(role: WorkspaceRole, path: string) {
  if (role === 'retailer' && path === 'incoming-products') return 'shipments';
  if (role === 'distributor' && path === 'transfers') return 'product-shipments';
  if ((role === 'supplier' || role === 'retailer') && path === 'evidence-requests')
    return role === 'retailer' ? 'sent-requests' : 'requests';
  if (
    role === 'distributor' &&
    ['orders', 'ingredient-deliveries', 'incoming-shipments'].includes(path)
  )
    return path === 'incoming-shipments' ? 'arrivals' : 'shipments';
  if (role === 'manufacturer' && (path === 'ingredient-evidence' || path === 'evidence'))
    return 'sent-requests';
  return Object.entries(paths[role]).find(([, value]) => value === path)?.[0] ?? path;
}
