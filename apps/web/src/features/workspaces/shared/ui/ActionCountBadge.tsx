/** Needs-action counts, never unread notifications. Unknown or failed sources have no red count. */
export function ActionCountBadge({ count, label }: { count?: number | null; label: string }) {
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
