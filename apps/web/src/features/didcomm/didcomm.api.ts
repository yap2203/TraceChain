const API = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/api/didcomm${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? 'The secure messaging request failed.');
  }
  return response.json() as Promise<T>;
}
export interface MessagingIdentity {
  companyName: string;
  did: string;
  role: string;
  wallet: string;
}
export interface RelayEnvelope {
  businessReference: string;
  createdAt: string;
  envelope: string;
  expiresAt: string;
  fromDid: string;
  id: string;
  ingredientBatchReference?: string;
  messageType: string;
  parentThreadId?: string;
  threadId: string;
  toDid: string;
  deliveryState?: 'SENT' | 'RECEIVED_DECRYPTED';
  receivedAt?: string;
}
export const didCommApi = {
  bind: (proof: string) =>
    request<MessagingIdentity>('/binding', { method: 'POST', body: JSON.stringify({ proof }) }),
  challenge: () =>
    request<{
      chainId: number;
      domain: string;
      expiresAt: string;
      nonce: string;
      purpose: string;
      wallet: string;
    }>('/binding/challenge', { method: 'POST' }),
  directory: () => request<MessagingIdentity[]>('/directory'),
  mailbox: () => request<{ envelopes: RelayEnvelope[]; identity?: MessagingIdentity }>('/mailbox'),
  relay: (envelope: RelayEnvelope) =>
    request<{ accepted: true; id: string }>('/relay', {
      method: 'POST',
      body: JSON.stringify(envelope),
    }),
  send: (message: {
    body: Record<string, unknown>;
    businessReference: string;
    expiresAt: string;
    ingredientBatchReference?: string;
    messageType: string;
    parentThreadId?: string;
    recipientWallet: string;
    threadId: string;
  }) =>
    request<{ accepted: true; id: string }>('/send', {
      method: 'POST',
      body: JSON.stringify(message),
    }),
};
export const EVIDENCE_REQUEST_TYPE =
  'https://tracechain.local/didcomm/ingredient-evidence-request/1.0';
export const EVIDENCE_ACK_TYPE = 'https://tracechain.local/didcomm/ingredient-evidence-ack/1.0';
export const EVIDENCE_PRESENTATION_TYPE =
  'https://tracechain.local/didcomm/ingredient-evidence-presentation/1.0';
export const EVIDENCE_DECLINED_TYPE =
  'https://tracechain.local/didcomm/ingredient-evidence-declined/1.0';
export const EVIDENCE_DECISION_TYPE =
  'https://tracechain.local/didcomm/ingredient-evidence-decision/1.0';
export const EVIDENCE_FOLLOW_UP_TYPE =
  'https://tracechain.local/didcomm/ingredient-evidence-follow-up/1.0';
export const COMPANY_IDENTITY_REQUEST_TYPE =
  'https://tracechain.local/didcomm/company-identity-request/1.0';
export const COMPANY_IDENTITY_PRESENTATION_TYPE =
  'https://tracechain.local/didcomm/company-identity-presentation/1.0';
export const COMPANY_IDENTITY_DECLINED_TYPE =
  'https://tracechain.local/didcomm/company-identity-declined/1.0';
