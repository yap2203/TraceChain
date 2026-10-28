import './loading.css';

interface LoadingIndicatorProps {
  label?: string;
  size?: 'small' | 'medium';
  fullScreen?: boolean;
}

export function LoadingIndicator({
  label = 'Loading',
  size = 'medium',
  fullScreen = false,
}: LoadingIndicatorProps) {
  return (
    <span
      className={`loading-indicator loading-indicator--${size}${fullScreen ? ' loading-indicator--screen' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className="loading-indicator__spinner" />
      <span className={fullScreen ? undefined : 'sr-only'}>{label}</span>
    </span>
  );
}
