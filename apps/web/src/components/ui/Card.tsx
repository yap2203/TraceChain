import type { ReactNode } from 'react';

interface CardProps {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: string;
  title?: string;
}

export function Card({ action, children, className = '', description, title }: CardProps) {
  return (
    <section className={`ui-card ${className}`.trim()}>
      {(title || description || action) && (
        <header className="ui-card__header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="ui-card__body">{children}</div>
    </section>
  );
}
