import type { CSSProperties } from 'react';
import './loading.css';

interface LoadingIndicatorProps {
  label?: string;
  size?: 'small' | 'medium';
  fullScreen?: boolean;
  page?: boolean;
  layout?: 'cards' | 'table' | 'detail' | 'form' | 'value';
  /** Content inside an existing titled card, without page chrome. */
  embedded?: boolean;
  rows?: number;
  columns?: number;
}

export function LoadingIndicator({
  label = 'Loading',
  size = 'medium',
  fullScreen = false,
  page = false,
  layout = 'cards',
  embedded = false,
  rows = 3,
  columns = 3,
}: LoadingIndicatorProps) {
  if (embedded) {
    const content = (
      <>
        <span className="sr-only">{label}</span>
        {layout === 'value' ? (
          <span className="page-skeleton__line" aria-hidden="true" />
        ) : (
          <span className="embedded-skeleton__rows" aria-hidden="true">
            {Array.from({ length: rows }, (_, row) => (
              <span className="embedded-skeleton__row" key={row}>
                {Array.from({ length: columns }, (_, column) => (
                  <span className="page-skeleton__line" key={column} />
                ))}
              </span>
            ))}
          </span>
        )}
      </>
    );
    return (
      <span
        className={`embedded-skeleton embedded-skeleton--${layout}`}
        style={{ '--skeleton-columns': columns } as CSSProperties}
        role="status"
        aria-label={label}
        aria-busy="true"
        aria-live="polite"
      >
        {content}
      </span>
    );
  }
  if (page && !fullScreen)
    return (
      <div
        className={`page-skeleton page-skeleton--${layout}`}
        role="status"
        aria-label={label}
        aria-busy="true"
        aria-live="polite"
      >
        <span className="page-skeleton__label">{label}</span>
        <div className="page-skeleton__heading" aria-hidden="true" />
        <div className="page-skeleton__content" aria-hidden="true">
          {Array.from(
            { length: layout === 'detail' ? 2 : layout === 'form' ? 4 : 3 },
            (_, index) => (
              <div className="page-skeleton__item" key={index}>
                <span className="page-skeleton__image" />
                <span className="page-skeleton__line" />
                <span className="page-skeleton__line page-skeleton__line--short" />
              </div>
            ),
          )}
        </div>
      </div>
    );
  return (
    <span
      className={`loading-indicator loading-indicator--${size}${fullScreen ? ' loading-indicator--screen' : page ? ' loading-indicator--page' : ''}`}
      role="status"
      aria-label={label}
      aria-live="polite"
    >
      <span aria-hidden="true" className="loading-indicator__spinner" />
      <span className={fullScreen || page ? undefined : 'sr-only'}>{label}</span>
    </span>
  );
}
