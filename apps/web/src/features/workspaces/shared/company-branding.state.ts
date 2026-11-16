import { useSyncExternalStore } from 'react';

export interface CompanyBranding {
  companyName: string;
  logoPath?: string;
  role: string;
}

interface CompanyBrandingSnapshot {
  branding?: CompanyBranding;
  owner?: string;
  revision: number;
}

type BrandingLoader = () => Promise<{ branding: CompanyBranding }>;

let generation = 0;
let snapshot: CompanyBrandingSnapshot = { revision: 0 };
let inFlight: { owner: string; request: Promise<void>; requestGeneration: number } | undefined;
const listeners = new Set<() => void>();

const normalized = (wallet?: string) => wallet?.toLowerCase();
const emit = () => listeners.forEach((listener) => listener());

export function useCompanyBrandingState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function selectCompanyBranding(wallet: string | undefined) {
  return normalized(snapshot.owner) === normalized(wallet) ? snapshot : { revision: 0 };
}

export function resetCompanyBrandingOwner(wallet?: string) {
  if (normalized(snapshot.owner) === normalized(wallet)) return;
  generation += 1;
  inFlight = undefined;
  snapshot = { owner: wallet, revision: 0 };
  emit();
}

export function loadCompanyBranding(wallet: string, loader: BrandingLoader) {
  resetCompanyBrandingOwner(wallet);
  if (snapshot.branding) return Promise.resolve();
  if (
    inFlight &&
    normalized(inFlight.owner) === normalized(wallet) &&
    inFlight.requestGeneration === generation
  )
    return inFlight.request;

  const requestGeneration = generation;
  const request = loader()
    .then(({ branding }) => {
      if (requestGeneration !== generation || normalized(snapshot.owner) !== normalized(wallet))
        return;
      snapshot = { ...snapshot, branding };
      emit();
    })
    .catch((error: unknown) => {
      if (requestGeneration === generation && normalized(snapshot.owner) === normalized(wallet))
        throw error;
    })
    .finally(() => {
      if (inFlight?.request === request) inFlight = undefined;
    });
  inFlight = { owner: wallet, request, requestGeneration };
  return request;
}

export function publishCompanyBranding(wallet: string, branding: CompanyBranding) {
  resetCompanyBrandingOwner(wallet);
  generation += 1;
  inFlight = undefined;
  snapshot = { branding, owner: wallet, revision: snapshot.revision + 1 };
  emit();
}

export function clearCompanyBrandingState() {
  generation += 1;
  inFlight = undefined;
  snapshot = { revision: 0 };
  emit();
}
