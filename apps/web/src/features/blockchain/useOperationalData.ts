import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { chainConfig } from '../../config/network';
import { getOperationalData, type OperationalData } from './blockchain.api';

const emptyData: OperationalData = {
  evidenceRequests: [],
  ingredientBatches: [],
  productBatches: [],
  transfers: [],
};
const CACHE_TTL_MS = 5_000;
const OperationalDataScope = createContext(`chain:${chainConfig.chainId}:session`);

interface QueryState {
  data: OperationalData;
  error: string;
  loading: boolean;
  refreshing: boolean;
}

interface CacheEntry extends QueryState {
  hasData: boolean;
  listeners: Set<(state: QueryState) => void>;
  pending?: Promise<OperationalData>;
  updatedAt: number;
}

const queries = new Map<string, CacheEntry>();

export function OperationalDataScopeProvider({
  children,
  walletAddress,
}: {
  children: ReactNode;
  walletAddress?: string;
}) {
  const wallet = walletAddress?.toLowerCase() ?? 'anonymous';
  return createElement(
    OperationalDataScope.Provider,
    { value: `chain:${chainConfig.chainId}:wallet:${wallet}` },
    children,
  );
}

export function invalidateOperationalData(scope?: string) {
  if (scope) {
    const entry = queries.get(scope);
    if (entry) entry.updatedAt = 0;
    return;
  }
  for (const entry of queries.values()) entry.updatedAt = 0;
}

export function clearOperationalDataCache() {
  queries.clear();
}

export function useOperationalData() {
  const scope = useContext(OperationalDataScope);
  const [state, setState] = useState<QueryState>(() => snapshot(scope));

  const load = useCallback(
    async (force = false) => {
      const entry = cacheEntry(scope);
      if (force) entry.updatedAt = 0;
      if (!force && entry.updatedAt && Date.now() - entry.updatedAt < CACHE_TTL_MS) {
        setState(publicState(entry));
        return entry.data;
      }
      if (entry.pending) return entry.pending;
      entry.loading = true;
      entry.error = '';
      publish(entry);
      const pending = getOperationalData()
        .then((data) => {
          // The API is authoritative for the actor. Never copy a response into a
          // different wallet/network cache key.
          if (data.actorWallet && !scope.endsWith(`wallet:${data.actorWallet.toLowerCase()}`))
            throw new Error('The operational response belongs to a different wallet session.');
          entry.data = data;
          entry.hasData = true;
          entry.updatedAt = Date.now();
          return data;
        })
        .catch((cause) => {
          entry.error = cause instanceof Error ? cause.message : 'Could not read blockchain data.';
          if (!entry.hasData) entry.data = emptyData;
          throw cause;
        })
        .finally(() => {
          entry.loading = false;
          if (entry.pending === pending) entry.pending = undefined;
          publish(entry);
        });
      entry.pending = pending;
      return pending;
    },
    [scope],
  );

  useEffect(() => {
    const entry = cacheEntry(scope);
    const listener = (next: QueryState) => setState(next);
    entry.listeners.add(listener);
    setState(publicState(entry));
    void load().catch(() => undefined);
    return () => {
      entry.listeners.delete(listener);
    };
  }, [load, scope]);

  const reload = useCallback(async () => load(true), [load]);
  return { ...state, reload };
}

function cacheEntry(scope: string): CacheEntry {
  let entry = queries.get(scope);
  if (!entry) {
    entry = {
      data: emptyData,
      hasData: false,
      error: '',
      listeners: new Set(),
      loading: true,
      refreshing: false,
      updatedAt: 0,
    };
    queries.set(scope, entry);
  }
  return entry;
}

function snapshot(scope: string): QueryState {
  return publicState(cacheEntry(scope));
}

function publicState(entry: CacheEntry): QueryState {
  return {
    data: entry.data,
    error: entry.error,
    loading: entry.loading && !entry.hasData,
    refreshing: entry.loading && entry.hasData,
  };
}

function publish(entry: CacheEntry) {
  const state = publicState(entry);
  for (const listener of entry.listeners) listener(state);
}
