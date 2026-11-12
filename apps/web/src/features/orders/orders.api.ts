import type { PreparedTransaction } from '../blockchain/blockchain.api';
export type OrderRecord = Record<string, any>;
export interface SupplierStock {
  batchId: string;
  unit: string;
  availableQuantity: string;
  pendingQuantity: string;
  approvedQuantity: string;
  outstandingQuantity: string;
  remainingAfterRequests: string | null;
  shortfall: string | null;
  requestCount: number;
}
export interface OrdersState {
  supplierStock?: SupplierStock[];
  approvedReceiptsSupported?: boolean;
  listingBatches?: Array<{ batchId: string; unit: string; eligible: boolean; reason: string }>;
  actor: string;
  role: string;
  catalogue: OrderRecord[];
  orders: OrderRecord[];
  shipments: OrderRecord[];
  locations: OrderRecord[];
}
const base = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export interface CatalogueImageUpload {
  data: string;
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}
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
export const uploadIngredientCatalogueImage = (batchId: string, image: CatalogueImageUpload) =>
  request<{ image: { path: string } }>(`/catalogue/ingredients/${batchId}/image`, image);
export const uploadCompanyLogo = (wallet: string, image: CatalogueImageUpload) =>
  request<{ branding: { logoPath: string } }>(`/branding/${wallet}/logo`, image);
export const getMyCompanyBranding = () =>
  request<{ branding: { companyName: string; logoPath?: string; role: string } }>('/branding/me');
export async function fetchCatalogueMedia(path: string) {
  const response = await fetch(`${base}/api/orders${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Catalogue image unavailable.');
  return response.blob();
}

export async function imageFilePayload(file: File): Promise<CatalogueImageUpload> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Images must not exceed 2 MB.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected image could not be read.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
  return { data, fileName: file.name, mimeType: file.type as CatalogueImageUpload['mimeType'] };
}
