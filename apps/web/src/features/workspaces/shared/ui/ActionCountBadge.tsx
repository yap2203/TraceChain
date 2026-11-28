import { CircleHelp } from 'lucide-react';
/** Needs-action counts, never unread notifications. Failed/stale counts are neutral, not zero. */
export function ActionCountBadge({ count, label }: { count?: number | null; label: string }) {
  if (count === null)
    return (
      <span
        className="inline-flex shrink-0 items-center text-ws-text2"
        role="img"
        aria-label={`${label} action count unavailable`}
        title="Refresh to check actions"
      >
        <CircleHelp size={13} aria-hidden="true" />
      </span>
    );
  if (!count || count < 0) return null;
  return (
    <span
      className="workspace-action-count"
      aria-label={`${count > 99 ? 'More than 99' : count} ${count === 1 ? 'action' : 'actions'} required for ${label}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
