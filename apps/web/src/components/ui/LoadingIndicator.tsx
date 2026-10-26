interface LoadingIndicatorProps {
  label?: string;
  size?: 'small' | 'medium';
}

export function LoadingIndicator({ label = 'Loading', size = 'medium' }: LoadingIndicatorProps) {
  return (
    <span className={`loading-indicator loading-indicator--${size}`} role="status">
      <span aria-hidden="true" className="loading-indicator__spinner" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
