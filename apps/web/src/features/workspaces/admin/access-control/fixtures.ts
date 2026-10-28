import { T } from '../../shared/ui';
import { type Role, type Permission, type RoleDefinition, type Stakeholder } from './types';

export const ALL_PERMISSIONS: Permission[] = [
  {
    id: 'register_product',
    label: 'Register Product',
    description: 'Create new product entries on-chain',
  },
  {
    id: 'receive_transfer',
    label: 'Receive Transfer',
    description: 'Accept incoming product handoffs',
  },
  {
    id: 'initiate_transfer',
    label: 'Initiate Transfer',
    description: 'Send products to the next chain stage',
  },
  {
    id: 'view_history',
    label: 'View Full History',
    description: 'Read complete chain-of-custody timeline',
  },
  {
    id: 'view_credentials',
    label: 'View Credentials',
    description: "See other stakeholders' credential status",
  },
  {
    id: 'add_metadata',
    label: 'Add Stage Metadata',
    description: 'Attach notes/batch data to a product stage',
  },
  {
    id: 'export_records',
    label: 'Export Records',
    description: 'Download product history as CSV/JSON',
  },
  {
    id: 'issue_credential',
    label: 'Issue Credential',
    description: 'Approve applications and mint SSI credentials',
  },
  {
    id: 'revoke_credential',
    label: 'Revoke Credential',
    description: 'Revoke an existing stakeholder credential',
  },
  {
    id: 'deploy_contract',
    label: 'Deploy Contract',
    description: 'Deploy or upgrade the smart contract',
  },
  { id: 'manage_roles', label: 'Manage Roles', description: 'Assign and change stakeholder roles' },
];

export const INITIAL_ROLE_DEFS: RoleDefinition[] = [
  {
    role: 'Supplier',
    color: T.teal,
    count: 2,
    canTransferTo: ['Manufacturer'],
    permissions: [
      'register_product',
      'initiate_transfer',
      'view_history',
      'add_metadata',
      'export_records',
    ],
  },
  {
    role: 'Manufacturer',
    color: T.navy,
    count: 2,
    canTransferTo: ['Distributor'],
    permissions: [
      'receive_transfer',
      'initiate_transfer',
      'view_history',
      'add_metadata',
      'export_records',
      'view_credentials',
    ],
  },
  {
    role: 'Distributor',
    color: '#0369A1',
    count: 2,
    canTransferTo: ['Retailer'],
    permissions: [
      'receive_transfer',
      'initiate_transfer',
      'view_history',
      'add_metadata',
      'export_records',
      'view_credentials',
    ],
  },
  {
    role: 'Retailer',
    color: '#7C3AED',
    count: 1,
    canTransferTo: [],
    permissions: ['receive_transfer', 'view_history', 'add_metadata', 'export_records'],
  },
];

export const INITIAL_STAKEHOLDERS: Stakeholder[] = [
  {
    company: 'BioFarm Exports Ltd',
    wallet: '0xA4f3C9B2e1D07A4A4f3C9B2e1D07A4A4',
    role: 'Supplier',
    status: 'verified',
    joined: '2026-05-10',
    cred: 'VC-2026-05-0019',
  },
  {
    company: 'EuroProcess GmbH',
    wallet: '0xC81aE4D7B9F02C8C81aE4D7B9F02C8C8',
    role: 'Manufacturer',
    status: 'verified',
    joined: '2026-05-22',
    cred: 'VC-2026-05-0021',
  },
  {
    company: 'Meridian Logistics GmbH',
    wallet: '0xF027A1C83B4D11FF027A1C83B4D11FF0',
    role: 'Distributor',
    status: 'verified',
    joined: '2026-06-14',
    cred: 'VC-2026-06-0031',
  },
  {
    company: 'Nordic Freight AB',
    wallet: '0x4A2b8c9D3e1F0a4A4A2b8c9D3e1F0a4A',
    role: 'Distributor',
    status: 'verified',
    joined: '2026-07-01',
    cred: 'VC-2026-07-0029',
  },
  {
    company: 'Pacific Agro Ltd',
    wallet: '0x7C3d1A8B5f0e2C7C7C3d1A8B5f0e2C7C',
    role: 'Supplier',
    status: 'verified',
    joined: '2026-07-18',
    cred: 'VC-2026-07-0033',
  },
  {
    company: 'MedCore Pharma GmbH',
    wallet: '0x9F4c2E7A1b8D06F99F4c2E7A1b8D06F9',
    role: 'Manufacturer',
    status: 'verified',
    joined: '2026-07-25',
    cred: 'VC-2026-07-0035',
  },
  {
    company: 'RetailMax Europe',
    wallet: '0xB62e9A4C1d07E8BB62e9A4C1d07E8BB6',
    role: 'Retailer',
    status: 'verified',
    joined: '2026-08-02',
    cred: 'VC-2026-08-0037',
  },
];

export const ROLE_COLORS: Record<Role, string> = {
  Supplier: T.teal,
  Manufacturer: T.navy,
  Distributor: '#0369A1',
  Retailer: '#7C3AED',
};
