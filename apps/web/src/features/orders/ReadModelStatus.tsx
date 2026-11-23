import { useEffect, useRef } from 'react';
import type { OrdersState } from './orders.api';

export function useReadModelRefresh(
  state: OrdersState | undefined,
  refresh: () => Promise<void>,
  onError: (cause: unknown) => void,
) {
  const failure = useRef(onError);
  failure.current = onError;
  useEffect(() => {
    if (!state?.readModel?.refreshing) return;
    let active = true;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void refresh()
        .catch((cause) => {
          if (!active) return;
          clearInterval(timer);
          failure.current(cause);
        })
        .finally(() => {
          pending = false;
        });
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [state?.readModel?.refreshing, refresh]);
}

export function ReadModelStatus({ state }: { state?: OrdersState }) {
  const model = state?.readModel;
  if (!model) return null;
  return (
    <p role="status" className="text-sm text-[var(--c-text2)]">
      {model.refreshing
        ? 'Updating from blockchain… '
        : model.refreshFailed
          ? 'Refresh unavailable. Showing the last loaded records. Retry with Refresh. '
          : ''}
      Last updated {new Date(model.updatedAt).toLocaleTimeString()}.
      {model.stale && !model.refreshing && !model.refreshFailed
        ? ' Refresh to check for changes.'
        : ''}
    </p>
  );
}
