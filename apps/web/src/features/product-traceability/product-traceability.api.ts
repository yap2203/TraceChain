import type { ProductTraceabilityResponse } from './product-traceability.types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export class ProductTraceabilityApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function resolveProductTraceability(qrPayload: string) {
  const response = await fetch(`${API_BASE_URL}/api/product-traceability/resolve`, {
    body: JSON.stringify({ qrPayload }),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new ProductTraceabilityApiError(
      body.error?.message ?? 'The product traceability record could not be resolved.',
      body.error?.code ?? 'TRACEABILITY_ERROR',
      response.status,
    );
  }
  return response.json() as Promise<ProductTraceabilityResponse>;
}
