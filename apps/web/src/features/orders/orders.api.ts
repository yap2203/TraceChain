import { apiErrorMessage } from '../../components/ui/feedback';
import { authRequestScope } from '../auth/auth-request-scope';
import type { PreparedTransaction } from '../blockchain/blockchain.api';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
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
  readModel?: { updatedAt: string; stale: boolean; refreshing: boolean; refreshFailed: boolean };
  pagination?: { page: number; pageSize: number; total: number; counts: Record<string, number> };
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
  companies?: Array<{ wallet: string; companyName: string; role: string; logoPath?: string }>;
  ingredientDeliverySupported?: boolean;
  chainId?: number;
  ordersAddress?: string;
  distributors?: Array<{ wallet: string; companyName: string; logoPath?: string }>;
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
const ordersRequests = new Map<string, Promise<OrdersState>>();
export interface OrderListOptions {
  orderId?: string;
  page?: number;
  pageSize?: number;
  direction?: 'all' | 'sent' | 'received';
  search?: string;
  status?: string;
  sort?: 'newest' | 'oldest' | 'deadline' | 'updated';
  refresh?: boolean;
}
export const getOrders = (
  scope?:
    | 'supplier-inventory'
    | 'order-list'
    | 'order-detail'
    | 'shipment-workspace'
    | 'custody-inventory'
    | 'catalogue',
  options: OrderListOptions = {},
) => {
  const query = new URLSearchParams(scope ? { scope } : {});
  for (const [key, value] of Object.entries(options))
    if (value !== undefined) query.set(key, key === 'refresh' ? (value ? '1' : '') : String(value));
  if (!options.refresh) query.delete('refresh');
  const path = query.size ? `?${query}` : '';
  const scopeKey = authRequestScope();
  const key = `${scopeKey}:${path}`;
  const existing = ordersRequests.get(key);
  if (existing) return existing;
  const pending = request<OrdersState>(path).then((result) => {
    if (scopeKey !== authRequestScope())
      throw new Error('The wallet session changed. Reload your requests.');
    return result;
  });
  ordersRequests.set(key, pending);
  const clear = () => {
    if (ordersRequests.get(key) === pending) ordersRequests.delete(key);
  };
  void pending.then(clear, clear);
  return pending;
};
export interface CompanyLocation {
  location: string;
  registeredLabel: string;
  address?: string;
  label: string;
  warehouse: boolean;
}
export interface CompanyProfile {
  wallet: string;
  role: string;
  initialLocationName?: string;
  initialLocationAddress?: string;
  locations: CompanyLocation[];
}
export const getCompanyProfile = () => request<CompanyProfile>('/profile');
export const updateLocationLabel = async (location: string, label: string, address?: string) => {
  const update = () =>
    request<MediaUpdateResult & { location: string; label: string; address?: string }>(
      `/profile/locations/${encodeURIComponent(location)}`,
      { label, ...(address !== undefined ? { address } : {}) },
      'PATCH',
    );
  let result = await update();
  if (result.transaction) {
    await submitProductionTransaction(result.transaction, result.actorWallet);
    result = await update();
  }
  if (result.state && result.state !== 'COMPLETE')
    throw new Error('The location update transaction was not confirmed.');
  return result;
};
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
    category?: string;
    imagePath?: string;
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
  fromLocationAddress?: string;
  toLocationName?: string;
  toLocationAddress?: string;
  expiresAt: number;
  status:
    'REQUESTED' | 'ACCEPTED' | 'SCHEDULED' | 'REJECTED' | 'DISPATCHED' | 'RECEIVED' | 'EXPIRED';
  pickupAt?: number;
  shipmentId?: string;
  /** Shipment ID the handoff will record; lets the label be printed before pickup. */
  plannedShipmentId?: string;
  createdAt?: string;
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
  sharedReference?: boolean;
  requestId: string;
  referenceId: string;
  context: 'delivery' | 'order' | 'ingredient' | 'custody';
  direction: 'sent' | 'received';
  company: string;
  counterpartyWallet?: string;
  counterpartyRole?: string;
  /** Item and quantity for custody-offer requests. */
  subject?: string;
  requiredClaims?: string[];
  optionalClaims?: string[];
  verifiedAt?: string;
  purpose: string;
  requestedFieldsCount?: number;
  requiredFieldsCount?: number;
  requestedAt?: string | number;
  expiresAt: number;
  status: string;
}
export const getInformationRequests = () =>
  request<{ requests: CompanyProofRequestRow[]; actor?: string }>('/information-requests');
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
  const upload = () =>
    request<MediaUpdateResult & { image: { path: string } }>(
      `/catalogue/ingredients/${batchId}/image`,
      image,
    );
  let result = await upload();
  if (result.transaction) {
    await submitProductionTransaction(result.transaction, result.actorWallet);
    result = await upload();
  }
  if (result.state && result.state !== 'COMPLETE')
    throw new Error('The ingredient image transaction was not confirmed.');
  mediaRequests.delete(result.image.path);
  return result;
};
export const uploadProductCatalogueImage = async (batchId: string, image: CatalogueImageUpload) => {
  const upload = () =>
    request<MediaUpdateResult & { image: { path: string } }>(
      `/catalogue/products/${batchId}/image`,
      image,
    );
  let result = await upload();
  if (result.transaction) {
    await submitProductionTransaction(result.transaction, result.actorWallet);
    result = await upload();
  }
  if (result.state && result.state !== 'COMPLETE')
    throw new Error('The product image transaction was not confirmed.');
  mediaRequests.delete(result.image.path);
  return result;
};
export const uploadCompanyLogo = async (wallet: string, image: CatalogueImageUpload) => {
  const upload = () =>
    request<MediaUpdateResult & { branding: { logoPath: string } }>(
      `/branding/${wallet}/logo`,
      image,
    );
  let result = await upload();
  if (result.transaction) {
    await submitProductionTransaction(result.transaction, result.actorWallet);
    result = await upload();
  }
  if (result.state && result.state !== 'COMPLETE')
    throw new Error('The company logo transaction was not confirmed.');
  mediaRequests.delete(result.branding.logoPath);
  return result;
};

interface MediaUpdateResult {
  actorWallet: string;
  state: 'COMPLETE' | 'TRANSACTION_REQUIRED';
  transaction?: PreparedTransaction;
}
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

export function fetchCatalogueMedia(path: string, revision = 0) {
  const scope = authRequestScope();
  const requestKey = `${scope}:${path}#${revision}`;
  const existing = mediaRequests.get(requestKey);
  if (existing) return existing;
  const mediaUrl = path.startsWith('/api/') ? `${base}${path}` : `${base}/api/orders${path}`;
  const pending = fetch(mediaUrl, { credentials: 'include' }).then(async (response) => {
    if (!response.ok)
      throw new CatalogueMediaError(
        response.status === 404
          ? 'missing'
          : response.status === 401 || response.status === 403
            ? 'denied'
            : 'unavailable',
        response.status,
      );
    const blob = await response.blob();
    if (scope !== authRequestScope()) throw new CatalogueMediaError('denied', 403);
    return blob;
  });
  mediaRequests.set(requestKey, pending);
  const clear = () => {
    if (mediaRequests.get(requestKey) === pending) mediaRequests.delete(requestKey);
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
