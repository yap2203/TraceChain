import { useEffect, useState } from 'react';
import type { OrdersState } from './orders.api';

/** Display clock only. Never fetches or treats a saved snapshot as a fresh chain read. */
export function ReadModelStatus({
  state,
  refreshing = false,
  failed = false,
}: {
  state?: Pick<OrdersState, 'readModel'>;
  refreshing?: boolean;
  failed?: boolean;
}) {
  const model = state?.readModel;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!model?.updatedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [model?.updatedAt]);
  if (!model && !refreshing && !failed) return null;
  const time = Date.parse(model?.updatedAt ?? '');
  const minutes = Math.floor((now - time) / 60_000);
  const age =
    !Number.isFinite(time) || minutes < 0
      ? 'Update time unavailable'
      : minutes === 0
        ? 'Updated just now'
        : minutes < 60
          ? `Updated ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
          : `Updated ${Math.floor(minutes / 60)} ${minutes < 120 ? 'hour' : 'hours'} ago`;
  const text = refreshing
    ? 'Refreshing…'
    : failed || model?.refreshFailed
      ? model
        ? `Refresh failed · saved records · ${age}`
        : 'Refresh failed'
      : model?.refreshing
        ? 'Refreshing…'
        : model?.stale
          ? `Stale data · ${age} · refresh needed`
          : age;
  return (
    <span
      role="status"
      className="text-[length:var(--text-label)] text-ws-text2"
      title={model?.updatedAt}
    >
      {text}
    </span>
  );
}
