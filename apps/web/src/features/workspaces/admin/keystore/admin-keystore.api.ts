import { apiErrorMessage } from '../../../../components/ui/feedback';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

export interface AdminKeystoreStatus {
  backupRequired: boolean;
  initializationAllowed: boolean;
  status: 'Locked' | 'Unlocked';
}

export function getAdminKeystoreStatus() {
  return request<AdminKeystoreStatus>('/status');
}

export function unlockAdminKeystore(keystore: string, password: string) {
  return request<Pick<AdminKeystoreStatus, 'backupRequired' | 'status'>>('/unlock', {
    body: JSON.stringify({ keystore, password }),
    method: 'POST',
  });
}

export function lockAdminKeystore() {
  return request<Pick<AdminKeystoreStatus, 'backupRequired' | 'status'>>('/lock', {
    method: 'POST',
  });
}

export async function downloadAdminKeystore(
  action: 'export' | 'initialize',
  password: string,
  confirmPassword: string,
) {
  const response = await fetch(`${API_BASE_URL}/api/admin/keystore/${action}`, {
    body: JSON.stringify({ password, confirmPassword }),
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw await responseError(response);
  return response.blob();
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}/api/admin/keystore${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
}

async function responseError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };
  return new Error(
    apiErrorMessage(body.error?.message, 'The administrator keystore operation failed.'),
  );
}
