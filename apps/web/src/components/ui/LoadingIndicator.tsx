import './loading.css';

interface LoadingIndicatorProps {
  label?: string;
  size?: 'small' | 'medium';
  fullScreen?: boolean;
  page?: boolean;
}

export function LoadingIndicator({
  label = 'Loading',
  size = 'medium',
  fullScreen = false,
  page = false,
}: LoadingIndicatorProps) {
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
