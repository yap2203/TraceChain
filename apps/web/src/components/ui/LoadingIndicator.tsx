import './loading.css';

interface LoadingIndicatorProps {
  label?: string;
  size?: 'small' | 'medium';
  fullScreen?: boolean;
  page?: boolean;
  layout?: 'cards' | 'table' | 'detail' | 'form';
}

export function LoadingIndicator({
  label = 'Loading',
  size = 'medium',
  fullScreen = false,
  page = false,
  layout = 'cards',
}: LoadingIndicatorProps) {
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
