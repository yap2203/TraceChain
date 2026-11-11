import type { PreparedTransaction } from '../blockchain/blockchain.api';
export type OrderRecord = Record<string, any>;
export interface OrdersState {
  listingBatches?: Array<{ batchId: string; unit: string; eligible: boolean; reason: string }>;
  actor: string;
  role: string;
  catalogue: OrderRecord[];
  orders: OrderRecord[];
  shipments: OrderRecord[];
  locations: OrderRecord[];
}
const base = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}/api/orders${path}`, {
    credentials: 'include',
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message ?? 'The order service is unavailable.');
  }
  return response.json();
}
export const getOrders = () => request<OrdersState>('');
export const prepareOrder = (input: Record<string, unknown>) =>
  request<{ resultId: string; transaction: PreparedTransaction }>('/prepare', input);
export const orderIdentity = (orderId: string, input: Record<string, unknown>) =>
  request<any>(`/${orderId}/identity`, input);
export const getRecall = (batchId: string) => request<OrderRecord>(`/recall/${batchId}`);
export const prepareOrderEvidence = (orderId: string, input: Record<string, unknown>) =>
  request<any>(`/${orderId}/evidence/prepare`, input);
