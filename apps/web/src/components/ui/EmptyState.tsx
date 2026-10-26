import type { ReactNode } from 'react';

interface EmptyStateProps {
  action?: ReactNode;
  description: string;
  icon?: ReactNode;
  title: string;
}

export function EmptyState({ action, description, icon, title }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-state__icon">{icon}</span>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
