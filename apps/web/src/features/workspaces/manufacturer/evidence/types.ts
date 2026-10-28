export type ReqStatus =
  'awaiting' | 'received' | 'accepted' | 'declined' | 'rejected' | 'cancelled';

export type ClaimReq = 'required' | 'optional';

export type VerifyScenario = 'success' | 'incomplete' | 'invalid' | 'unavailable';

export interface RequestedClaim {
  name: string;
  req: ClaimReq;
}

export interface SharedClaim {
  name: string;
  value: string | null;
  disclosed: boolean;
}

export interface TimelineEvent {
  date: string;
  event: string;
  type: string;
}

export interface EvidenceRequest {
  id: string;
  supplier: string;
  supplierDid: string;
  ingredient: string;
  batch: string;
  requestDate: string;
  dueDate: string;
  status: ReqStatus;
  overdue: boolean;
  reason: string;
  claims: RequestedClaim[];
  scenario?: VerifyScenario;
  sharedClaims?: SharedClaim[];
  presentationId?: string;
  credentialId?: string;
  credentialExpiry?: string;
  acceptedDate?: string;
  declineReason?: string;
  reviewNotes?: string;
  timeline: TimelineEvent[];
}

export interface AcceptedEvidence {
  reqId: string;
  ingredient: string;
  batch: string;
  supplier: string;
  credentialId: string;
  acceptedDate: string;
  credentialExpiry: string;
  credentialStatus: 'active' | 'suspended' | 'revoked';
  availability: 'available' | 'recheck' | 'unavailable';
}

export type CheckResult = 'pass' | 'fail' | 'pending' | 'idle';
