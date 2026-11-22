import { apiErrorMessage } from '../../components/ui/feedback';
const API = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}/api/didcomm${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(apiErrorMessage(body.error?.message, 'The secure messaging request failed.'));
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
};
