import type { WorkspaceRole } from './workspace-navigation';

// Map internal page identifiers to the canonical system URLs.
const paths: Record<WorkspaceRole, Record<string, string>> = {
  admin: { accesscontrol: 'stakeholders', audit: 'reports' },
  supplier: {
    batches: 'ingredients',
    requests: 'evidence-requests',
    mycredential: 'credentials',
    audit: 'reports',
  },
  manufacturer: {
    evidence: 'ingredient-evidence',
    products: 'product-batches',
    mycredential: 'credentials',
    audit: 'reports',
  },
  distributor: { incoming: 'incoming-shipments', mycredential: 'credentials', audit: 'reports' },
  retailer: {
    receive: 'incoming-products',
    scan: 'scan',
    history: 'traceability',
    evidence: 'evidence-requests',
    mycredential: 'credentials',
    audit: 'reports',
  },
};

export function workspacePath(role: WorkspaceRole, page: string) {
  return `/${role}/${paths[role][page] ?? page}`;
}

export function workspacePage(role: WorkspaceRole, path: string) {
  return Object.entries(paths[role]).find(([, value]) => value === path)?.[0] ?? path;
}
