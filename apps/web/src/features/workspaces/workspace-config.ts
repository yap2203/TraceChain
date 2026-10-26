import type { AppIconName } from '../../components/icons/AppIcon';
import type { NavigationItem } from '../../components/layout/ApplicationLayout';

export type WorkspaceKey = 'admin' | 'distributor' | 'manufacturer' | 'retailer' | 'supplier';

interface WorkspaceDefinition {
  navigation: readonly NavigationItem[];
  organisation: string;
  roleLabel: string;
}

interface PageDefinition {
  actionLabel: string;
  description: string;
  icon: AppIconName;
  title: string;
}

const nav = (base: WorkspaceKey, items: readonly [string, string, AppIconName][]) =>
  items.map(([path, label, icon]) => ({ icon, label, to: `/${base}/${path}` }));

export const workspaces: Record<WorkspaceKey, WorkspaceDefinition> = {
  admin: {
    roleLabel: 'System Admin',
    organisation: 'TraceChain Authority',
    navigation: nav('admin', [
      ['applications', 'Applications', 'applications'],
      ['credentials', 'Credentials', 'credentials'],
      ['stakeholders', 'Stakeholders', 'stakeholders'],
    ]),
  },
  supplier: {
    roleLabel: 'Supplier',
    organisation: 'Supplier organisation',
    navigation: nav('supplier', [
      ['ingredients', 'Ingredients', 'ingredients'],
      ['credentials', 'Credentials', 'credentials'],
      ['evidence-requests', 'Evidence requests', 'evidence'],
    ]),
  },
  manufacturer: {
    roleLabel: 'Manufacturer',
    organisation: 'Manufacturer organisation',
    navigation: nav('manufacturer', [
      ['ingredient-evidence', 'Ingredient evidence', 'evidence'],
      ['product-batches', 'Product batches', 'boxes'],
      ['transfers', 'Transfers', 'transfers'],
    ]),
  },
  distributor: {
    roleLabel: 'Distributor',
    organisation: 'Distributor organisation',
    navigation: nav('distributor', [
      ['incoming-shipments', 'Incoming shipments', 'transfers'],
      ['inventory', 'Inventory', 'inventory'],
      ['transfers', 'Transfers', 'transfers'],
    ]),
  },
  retailer: {
    roleLabel: 'Retailer',
    organisation: 'Retailer organisation',
    navigation: nav('retailer', [
      ['incoming-products', 'Incoming products', 'boxes'],
      ['traceability', 'Traceability', 'scan'],
      ['reports', 'Reports', 'reports'],
    ]),
  },
};

export const workspacePages: Record<string, PageDefinition> = {
  'admin:applications': {
    title: 'Company applications',
    description: 'Review organisations requesting access to the TraceChain network.',
    actionLabel: 'Review application',
    icon: 'applications',
  },
  'admin:credentials': {
    title: 'Company credentials',
    description: 'View the future Company Role Credential issuance workspace.',
    actionLabel: 'Issue credential',
    icon: 'credentials',
  },
  'admin:stakeholders': {
    title: 'Stakeholders',
    description: 'Manage approved organisations and their assigned supply-chain roles.',
    actionLabel: 'View stakeholder',
    icon: 'stakeholders',
  },
  'supplier:ingredients': {
    title: 'Ingredient batches',
    description: 'Prepare and manage traceable ingredient batch records.',
    actionLabel: 'New ingredient',
    icon: 'ingredients',
  },
  'supplier:credentials': {
    title: 'Ingredient credentials',
    description: 'Manage the future credential records issued for ingredient batches.',
    actionLabel: 'Issue credential',
    icon: 'credentials',
  },
  'supplier:evidence-requests': {
    title: 'Evidence requests',
    description: 'Review requests for selectively disclosed ingredient evidence.',
    actionLabel: 'Review request',
    icon: 'evidence',
  },
  'manufacturer:ingredient-evidence': {
    title: 'Ingredient evidence',
    description: 'Verify supplier evidence before using ingredients in production.',
    actionLabel: 'Request evidence',
    icon: 'evidence',
  },
  'manufacturer:product-batches': {
    title: 'Product batches',
    description: 'Prepare product batches linked to verified ingredient records.',
    actionLabel: 'New product batch',
    icon: 'boxes',
  },
  'manufacturer:transfers': {
    title: 'Product transfers',
    description: 'Prepare custody transfers for distributor organisations.',
    actionLabel: 'New transfer',
    icon: 'transfers',
  },
  'distributor:incoming-shipments': {
    title: 'Incoming shipments',
    description: 'Review products awaiting distributor receipt confirmation.',
    actionLabel: 'Review shipment',
    icon: 'transfers',
  },
  'distributor:inventory': {
    title: 'Inventory',
    description: 'View received products available for onward distribution.',
    actionLabel: 'View inventory',
    icon: 'inventory',
  },
  'distributor:transfers': {
    title: 'Retail transfers',
    description: 'Prepare available products for transfer to retailer organisations.',
    actionLabel: 'New transfer',
    icon: 'transfers',
  },
  'retailer:incoming-products': {
    title: 'Incoming products',
    description: 'Review products awaiting retailer receipt confirmation.',
    actionLabel: 'Review product',
    icon: 'boxes',
  },
  'retailer:traceability': {
    title: 'Product traceability',
    description: 'Look up authorised product history using a traceability reference.',
    actionLabel: 'Scan reference',
    icon: 'scan',
  },
  'retailer:reports': {
    title: 'Reports',
    description: 'Prepare authorised traceability summaries for future export.',
    actionLabel: 'Create report',
    icon: 'reports',
  },
};
