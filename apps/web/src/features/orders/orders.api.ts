import { apiErrorMessage } from '../../components/ui/feedback';
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
  productDeliverySupported?: boolean;
  fulfilmentSupported?: boolean;
  warehouseSupported?: boolean;
  shipmentReviewSupported?: boolean;
  logistics?: {
    warehouses: OrderRecord[];
    positions: OrderRecord[];
    shipments: OrderRecord[];
    productStock: OrderRecord[];
    productPositions?: OrderRecord[];
  };
  companies?: Array<{ wallet: string; companyName: string; role: string }>;
  ingredientDeliverySupported?: boolean;
  chainId?: number;
  ordersAddress?: string;
  distributors?: Array<{ wallet: string; companyName: string }>;
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
async function request<T>(
  path: string,
  body?: unknown,
  method = body ? 'POST' : 'GET',
): Promise<T> {
  const response = await fetch(`${base}/api/orders${path}`, {
    credentials: 'include',
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(error.error?.message, 'The order service is unavailable.'));
  }
  return response.json();
}
let ordersRequest: Promise<OrdersState> | undefined;
export const getOrders = () => {
  if (ordersRequest) return ordersRequest;
  const pending = request<OrdersState>('');
  ordersRequest = pending;
  const clear = () => {
    if (ordersRequest === pending) ordersRequest = undefined;
  };
  void pending.then(clear, clear);
  return pending;
};
export interface CompanyLocation {
  location: string;
  registeredLabel: string;
  label: string;
  warehouse: boolean;
}
export interface CompanyProfile {
  wallet: string;
  role: string;
  initialLocationName?: string;
  locations: CompanyLocation[];
}
export const getCompanyProfile = () => request<CompanyProfile>('/profile');
export const updateLocationLabel = (location: string, label: string) =>
  request(`/profile/locations/${encodeURIComponent(location)}`, { label }, 'PATCH');
export interface PickupPlan {
  pickupAt: number;
  arrangedAt: string;
  distributor: string;
}
export const getPickupPlan = (referenceId: string) =>
  request<{ plan: PickupPlan | null }>(`/${encodeURIComponent(referenceId)}/pickup`);
export const savePickupPlan = (referenceId: string, pickupAt: number) =>
  request<{ plan: PickupPlan }>(`/${encodeURIComponent(referenceId)}/pickup`, { pickupAt }, 'PUT');
export interface TraceStage {
  id: string;
  title: string;
  state: 'recorded' | 'in-progress' | 'not-recorded';
  records: OrderRecord[];
}
export interface TraceRoute {
  id: string;
  productBatchId: string | null;
  name: string;
  ingredients: OrderRecord[];
  stages: TraceStage[];
}
export interface BusinessTraceability {
  roots: Array<{
    batchId: string;
    kind: 'ingredient' | 'product';
    name: string;
    reference: string;
  }>;
  root: BusinessTraceability['roots'][number] | null;
  routes: TraceRoute[];
}
export const getBusinessTraceability = (kind?: string, batchId?: string) =>
  request<BusinessTraceability>(
    '/traceability' + (kind && batchId ? '?' + new URLSearchParams({ kind, batchId }) : ''),
  );
export interface CustodyOffer {
  offerId: string;
  kind: 1 | 2;
  batchId: string;
  quantity: string;
  unit: string;
  sender: string;
  distributor: string;
  senderName: string;
  distributorName: string;
  itemName: string;
  fromLocation: string;
  toLocation: string;
  fromLocationName?: string;
  toLocationName?: string;
  expiresAt: number;
  status:
    'REQUESTED' | 'ACCEPTED' | 'SCHEDULED' | 'REJECTED' | 'DISPATCHED' | 'RECEIVED' | 'EXPIRED';
  pickupAt?: number;
  shipmentId?: string;
}
export const getCustodyOffers = () => request<{ offers: CustodyOffer[] }>('/custody-offers');
export const getCustodyOffer = (offerId: string) =>
  request<{ offer: CustodyOffer }>(`/custody-offers/${encodeURIComponent(offerId)}`);
export const createCustodyOffer = (input: Record<string, unknown>) =>
  request<{ offer: CustodyOffer }>('/custody-offers', input);
export const actCustodyOffer = (
  offerId: string,
  input: { action: 'accept' | 'reject' | 'schedule'; pickupAt?: number },
) =>
  request<{ offer: CustodyOffer }>(`/custody-offers/${encodeURIComponent(offerId)}/action`, input);
export const prepareCustodyOffer = (
  offerId: string,
  input: { vehicle: string; occurredAt: number; expectedAt: number },
) =>
  request<{ transaction: PreparedTransaction; resultId: string; offerId: string }>(
    `/custody-offers/${encodeURIComponent(offerId)}/prepare`,
    input,
  );
export interface CompanyProofRequestRow {
  requestId: string;
  referenceId: string;
  context: 'delivery' | 'order' | 'ingredient' | 'custody';
  direction: 'sent' | 'received';
  company: string;
  purpose: string;
  expiresAt: number;
  status: string;
}
export const getInformationRequests = () =>
  request<{ requests: CompanyProofRequestRow[] }>('/information-requests');
export const prepareOrder = (input: Record<string, unknown>) =>
  request<{ resultId: string; transaction: PreparedTransaction }>('/prepare', input);
export const orderIdentity = (orderId: string, input: Record<string, unknown>) =>
  request<any>(`/${orderId}/identity`, input);
export const deliveryIdentity = (orderId: string, input: Record<string, unknown>) =>
  request<any>(`/${orderId}/delivery/identity`, input);
export const getRecall = (batchId: string) => request<OrderRecord>(`/recall/${batchId}`);
export const prepareOrderEvidence = (orderId: string, input: Record<string, unknown>) =>
  request<any>(`/${orderId}/evidence/prepare`, input);
export const uploadIngredientCatalogueImage = async (
  batchId: string,
  image: CatalogueImageUpload,
) => {
  const result = await request<{ image: { path: string } }>(
    `/catalogue/ingredients/${batchId}/image`,
    image,
  );
  mediaRequests.delete(result.image.path);
  return result;
};
export const uploadCompanyLogo = async (wallet: string, image: CatalogueImageUpload) => {
  const result = await request<{ branding: { logoPath: string } }>(
    `/branding/${wallet}/logo`,
    image,
  );
  mediaRequests.delete(result.branding.logoPath);
  return result;
};
export const getMyCompanyBranding = () =>
  request<{ branding: { companyName: string; logoPath?: string; role: string } }>('/branding/me');
export class CatalogueMediaError extends Error {
  constructor(
    readonly reason: 'missing' | 'denied' | 'unavailable',
    readonly status: number,
  ) {
    super(
      reason === 'missing'
        ? 'No image has been provided.'
        : reason === 'denied'
          ? 'This image is not available to the current account.'
          : 'The image service is unavailable.',
    );
  }
}

const mediaRequests = new Map<string, Promise<Blob>>();

export function fetchCatalogueMedia(path: string) {
  const existing = mediaRequests.get(path);
  if (existing) return existing;
  const pending = fetch(`${base}/api/orders${path}`, { credentials: 'include' }).then(
    async (response) => {
      if (!response.ok)
        throw new CatalogueMediaError(
          response.status === 404
            ? 'missing'
            : response.status === 401 || response.status === 403
              ? 'denied'
              : 'unavailable',
          response.status,
        );
      return response.blob();
    },
  );
  mediaRequests.set(path, pending);
  const clear = () => {
    if (mediaRequests.get(path) === pending) mediaRequests.delete(path);
  };
  void pending.then(clear, clear);
  return pending;
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
export const prepareLogistics = (input: Record<string, unknown>) =>
  request<{ resultId: string; transaction: PreparedTransaction }>('/logistics/prepare', input);
