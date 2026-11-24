import type { OrdersState } from './orders.api';

export function ReadModelStatus({ state }: { state?: OrdersState }) {
  const model = state?.readModel;
  if (!model) return null;
  return (
    <p role="status" className="text-sm text-[var(--c-text2)]">
      {model.refreshing
        ? 'Newer blockchain data may be available. Use Refresh when you need it. '
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
