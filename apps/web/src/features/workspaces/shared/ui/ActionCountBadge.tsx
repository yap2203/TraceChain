import type { ActionCount } from '../../action-counts';

export function actionCountLabel(count: ActionCount, label: string) {
  if (count === null) return `${label}, action count unavailable`;
  if (count === 'loading') return `${label}, loading action count`;
  if (typeof count === 'number' && count > 0)
    return `${label}, ${count > 99 ? 'more than 99' : count} ${count === 1 ? 'action' : 'actions'} required`;
  return label;
}

/** Needs-action counts, never unread notifications. Failed/stale counts are neutral, not zero. */
export function ActionCountBadge({
  count,
  label,
  reserveSpace = false,
}: {
  count?: ActionCount;
  label: string;
  reserveSpace?: boolean;
}) {
  const content =
    count === null || count === 'loading' ? (
      <span
        className={`workspace-action-indicator${count === 'loading' ? ' is-loading' : ''}`}
        role={count === 'loading' ? 'status' : 'img'}
        aria-label={
          count === 'loading'
            ? `Loading action count for ${label}`
            : `${label} action count unavailable`
        }
        title={
          count === 'loading' ? 'Loading actions' : 'Action count unavailable. Refresh to update.'
        }
      >
        <span aria-hidden="true" />
      </span>
    ) : typeof count === 'number' && count > 0 ? (
      <span
        className="workspace-action-count"
        aria-label={`${count > 99 ? 'More than 99' : count} ${count === 1 ? 'action' : 'actions'} required for ${label}`}
      >
        {count > 99 ? '99+' : count}
      </span>
    ) : null;
  return reserveSpace ? <span className="workspace-action-slot">{content}</span> : content;
}
