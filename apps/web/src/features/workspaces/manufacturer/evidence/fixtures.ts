import { T } from '../../shared/ui';
import {
  type ReqStatus,
  type ClaimReq,
  type EvidenceRequest,
  type AcceptedEvidence,
} from './types';

export const SUPPLIERS = [
  {
    id: 'abc',
    name: 'ABC Ingredients Sdn. Bhd.',
    did: 'did:ethr:0x8A31…92F0',
    credStatus: 'active' as const,
    batches: [
      { id: 'COCOA-2026-001', name: 'Cocoa Powder' },
      { id: 'MILK-2026-010', name: 'Milk Powder' },
      { id: 'SUGAR-2026-090', name: 'Cane Sugar' },
    ],
  },
];

export const ALL_CLAIMS: { name: string; defaultReq: ClaimReq }[] = [
  { name: 'Ingredient name', defaultReq: 'required' },
  { name: 'Batch number', defaultReq: 'required' },
  { name: 'Origin', defaultReq: 'optional' },
  { name: 'Production date', defaultReq: 'optional' },
  { name: 'Expiry date', defaultReq: 'optional' },
  { name: 'Allergen information', defaultReq: 'required' },
  { name: 'Certification status', defaultReq: 'optional' },
  { name: 'Quality-testing result', defaultReq: 'optional' },
];

export const INIT_REQUESTS: EvidenceRequest[] = [
  {
    id: 'REQ-2026-031',
    supplier: 'ABC Ingredients Sdn. Bhd.',
    supplierDid: 'did:ethr:0x8A31…92F0',
    ingredient: 'Cocoa Powder',
    batch: 'COCOA-2026-001',
    requestDate: '2026-08-01',
    dueDate: '2026-08-15',
    status: 'received',
    overdue: false,
    reason: 'Required for Milk Chocolate batch CHOCOLATE-2026-050.',
    claims: [
      { name: 'Ingredient name', req: 'required' },
      { name: 'Batch number', req: 'required' },
      { name: 'Origin', req: 'required' },
      { name: 'Allergen information', req: 'required' },
      { name: 'Certification status', req: 'required' },
      { name: 'Quality-testing result', req: 'optional' },
    ],
    scenario: 'success',
    sharedClaims: [
      { name: 'Ingredient name', value: 'Cocoa Powder', disclosed: true },
      { name: 'Batch number', value: 'COCOA-2026-001', disclosed: true },
      { name: 'Origin', value: 'Ghana', disclosed: true },
      { name: 'Allergen information', value: 'None', disclosed: true },
      { name: 'Certification status', value: 'Organic, Fair Trade', disclosed: true },
      { name: 'Quality-testing result', value: null, disclosed: false },
    ],
    presentationId: 'PRES-2026-0031',
    credentialId: 'IC-COCOA-2026-001',
    credentialExpiry: '2027-04-15',
    timeline: [
      {
        date: '2026-08-01 09:00',
        event: 'Evidence request sent to ABC Ingredients Sdn. Bhd.',
        type: 'sent',
      },
      {
        date: '2026-08-03 14:22',
        event: 'Supplier shared evidence for Cocoa Powder COCOA-2026-001',
        type: 'received',
      },
    ],
  },
  {
    id: 'REQ-2026-032',
    supplier: 'ABC Ingredients Sdn. Bhd.',
    supplierDid: 'did:ethr:0x8A31…92F0',
    ingredient: 'Milk Powder',
    batch: 'MILK-2026-010',
    requestDate: '2026-08-05',
    dueDate: '2026-08-12',
    status: 'awaiting',
    overdue: true,
    reason: 'Required for Milk Chocolate batch CHOCOLATE-2026-050.',
    claims: [
      { name: 'Ingredient name', req: 'required' },
      { name: 'Batch number', req: 'required' },
      { name: 'Allergen information', req: 'required' },
    ],
    timeline: [
      {
        date: '2026-08-05 10:15',
        event: 'Evidence request sent to ABC Ingredients Sdn. Bhd.',
        type: 'sent',
      },
    ],
  },
  {
    id: 'REQ-2026-033',
    supplier: 'ABC Ingredients Sdn. Bhd.',
    supplierDid: 'did:ethr:0x8A31…92F0',
    ingredient: 'Cane Sugar',
    batch: 'SUGAR-2026-090',
    requestDate: '2026-08-06',
    dueDate: '2026-08-20',
    status: 'received',
    overdue: false,
    reason: 'Required for Dark Chocolate batch CHOC-DARK-2026-040.',
    claims: [
      { name: 'Ingredient name', req: 'required' },
      { name: 'Batch number', req: 'required' },
      { name: 'Origin', req: 'required' },
      { name: 'Certification status', req: 'required' },
    ],
    scenario: 'incomplete',
    sharedClaims: [
      { name: 'Ingredient name', value: 'Cane Sugar', disclosed: true },
      { name: 'Batch number', value: 'SUGAR-2026-090', disclosed: true },
      { name: 'Origin', value: 'Thailand', disclosed: true },
      { name: 'Certification status', value: null, disclosed: false },
    ],
    presentationId: 'PRES-2026-0033',
    credentialId: 'IC-SUGAR-2026-090',
    credentialExpiry: '2027-06-10',
    timeline: [
      {
        date: '2026-08-06 11:00',
        event: 'Evidence request sent to ABC Ingredients Sdn. Bhd.',
        type: 'sent',
      },
      {
        date: '2026-08-08 09:45',
        event: 'Supplier shared evidence for Cane Sugar SUGAR-2026-090',
        type: 'received',
      },
    ],
  },
];

export const INIT_ACCEPTED: AcceptedEvidence[] = [
  {
    reqId: 'REQ-2026-029',
    ingredient: 'Milk Powder',
    batch: 'MILK-2026-010',
    supplier: 'ABC Ingredients Sdn. Bhd.',
    credentialId: 'IC-MILK-2026-010',
    acceptedDate: '2026-07-20',
    credentialExpiry: '2027-05-01',
    credentialStatus: 'active',
    availability: 'available',
  },
];

export const STATUS_LABEL: Record<ReqStatus, string> = {
  awaiting: 'Awaiting Response',
  received: 'Evidence Received',
  accepted: 'Accepted',
  declined: 'Declined by Supplier',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const STATUS_VARIANT: Record<ReqStatus, string> = {
  awaiting: 'pending',
  received: 'requested',
  accepted: 'accepted',
  declined: 'rejected',
  rejected: 'rejected',
  cancelled: 'suspended',
};

export const AVAIL_LABEL = {
  available: 'Available for Product Use',
  recheck: 'Recheck Required',
  unavailable: 'Unavailable',
};

export const AVAIL_COLOR = { available: T.green, recheck: T.amber, unavailable: T.red };

export const VERIFY_CHECKS = [
  'Supplier identity resolved',
  'Supplier Role Credential checked',
  'Ingredient credential issuer and signature checked',
  'Presentation proof, intended recipient and expiry checked',
  'Credential status checked',
  'Ingredient batch and required claims checked',
];
