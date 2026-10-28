export type Role = 'Supplier' | 'Manufacturer' | 'Distributor' | 'Retailer';

export type Status = 'verified' | 'suspended' | 'revoked';

export type Tab = 'stakeholders' | 'roles' | 'permissions';

export interface Permission {
  id: string;
  label: string;
  description: string;
}

export interface RoleDefinition {
  role: Role;
  color: string;
  permissions: string[];
  count: number;
  canTransferTo: Role[];
}

export interface Stakeholder {
  company: string;
  wallet: string;
  role: Role;
  status: Status;
  joined: string;
  cred: string;
}
