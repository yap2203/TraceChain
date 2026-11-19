import { apiErrorMessage } from '../../../../components/ui/feedback';
import type {
  IngredientOrigin,
  IngredientQualityTest,
  IngredientAllergen,
  IngredientCertification,
  CertificationDocument,
} from '@tracechain/shared';
import type { PreparedTransaction } from '../../../blockchain/blockchain.api';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export interface IngredientBatchInput {
  operationId?: string;
  originDetails?: IngredientOrigin;
  qualityTests?: IngredientQualityTest[];
  internalQualityRemarks?: string;
  allergen?: IngredientAllergen;
  certificationEntries?: IngredientCertification[];
  priceBasis?: string;
  price?: string;
  currency?: string;
  allergenInformation: string;
  batchReference: string;
  category: string;
  certifications: string[];
  expiryDate: string;
  ingredientName: string;
  origin: string;
  productionDate: string;
  productionDateMeaning?: 'production' | 'processing';
  quantity: string;
  unit: string;
}

export interface IngredientBatchWorkflow {
  batchId: string;
  credentialId: string;
  state: 'CREDENTIAL_REGISTRATION_REQUIRED' | 'BATCH_REGISTRATION_REQUIRED' | 'COMPLETE';
  supplierWallet: string;
  transaction?: PreparedTransaction;
}

export type ExtractionConfidence = 'High' | 'Review required' | 'Missing';

export interface ExtractedIngredientField {
  confidence: ExtractionConfidence;
  value: string;
}

export interface IngredientDocumentExtraction {
  document: {
    filename: string;
    format: 'pdf' | 'docx' | 'png' | 'jpeg';
    mimeType: string;
    pageCount?: number;
    size: number;
  };
  fields: {
    allergenInformation: ExtractedIngredientField;
    batchReference: ExtractedIngredientField;
    category: ExtractedIngredientField;
    certifications: ExtractedIngredientField;
    currency: ExtractedIngredientField;
    expiryDate: ExtractedIngredientField;
    ingredientName: ExtractedIngredientField;
    origin: ExtractedIngredientField;
    price: ExtractedIngredientField;
    productionDate: ExtractedIngredientField;
    quantity: ExtractedIngredientField;
    unit: ExtractedIngredientField;
  };
  warnings: string[];
}

export interface RegisteredIngredientBatch {
  originDetails?: IngredientOrigin;
  qualityTests?: IngredientQualityTest[];
  internalQualityRemarks?: string;
  allergen?: IngredientAllergen;
  certificationEntries?: IngredientCertification[];
  allergenInformation: string;
  availableQuantity: string;
  batchId: string;
  batchReference: string;
  category: string;
  certifications: string[];
  credentialId: string;
  encryptedCid: string;
  expiresAt: number;
  ingredientName: string;
  metadataHash: string;
  origin: string;
  producedAt: number;
  quantity: string;
  status: number;
  supplier: string;
  unit: string;
}

export class IngredientBatchRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function prepareIngredientBatch(input: IngredientBatchInput) {
  return ingredientBatchRequest<IngredientBatchWorkflow>('/prepare', {
    body: JSON.stringify(input),
    method: 'POST',
  });
}

export function getIngredientBatches() {
  return ingredientBatchRequest<{ batches: RegisteredIngredientBatch[] }>('/');
}
export function getIngredientDrafts() {
  return ingredientBatchRequest<{ workflows: { batchId: string; input: IngredientBatchInput }[] }>(
    '/workflows',
  );
}
export function uploadCertificationDocument(
  input: {
    id: string;
    operationId: string;
    certificationId: string;
    fileName: string;
    mimeType: string;
    data: string;
  },
  onProgress?: (percent: number) => void,
): Promise<CertificationDocument> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE_URL + '/api/ingredient-batches/attachments');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(new Error('Document upload could not reach the API. Retry this file.'));
    xhr.timeout = 120000;
    xhr.ontimeout = () => reject(new Error('Document upload timed out. Retry this file.'));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else
          reject(
            new Error(
              apiErrorMessage(
                body.error?.message,
                'Encrypted document upload failed. Retry this file.',
              ),
            ),
          );
      } catch {
        reject(new Error('Invalid upload response. Retry this file.'));
      }
    };
    xhr.send(JSON.stringify(input));
  });
}
export function getCertificationDocument(batchId: string, documentId: string) {
  return ingredientBatchRequest<{ fileName: string; mimeType: string; data: string }>(
    `/${encodeURIComponent(batchId)}/documents/${encodeURIComponent(documentId)}`,
  );
}

export async function extractIngredientDocument(file: File) {
  const body = new FormData();
  body.append('document', file);
  const response = await fetch(`${API_BASE_URL}/api/ingredients/extract-document`, {
    body,
    credentials: 'include',
    method: 'POST',
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new IngredientBatchRequestError(
      payload.error?.code ?? 'DOCUMENT_EXTRACTION_FAILED',
      apiErrorMessage(payload.error?.message, 'The document could not be processed.'),
      response.status,
    );
  }
  return response.json() as Promise<IngredientDocumentExtraction>;
}

async function ingredientBatchRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/ingredient-batches${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new IngredientBatchRequestError(
      body.error?.code ?? 'INGREDIENT_BATCH_REQUEST_FAILED',
      apiErrorMessage(body.error?.message, 'The ingredient batch request failed.'),
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
