import { type ReactNode, type CSSProperties } from 'react';

export function Card({
  children,
  style: sx,
  onClick,
  padding = '20px',
  className = '',
}: {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  padding?: string;
  className?: string;
}) {
  return (
    <div
      className={`workspace-card bg-ws-surface border border-solid border-ws-border rounded-[12px] shadow-[0_1px_4px_rgba(0,0,0,0.35)] min-w-0 max-w-full ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      style={{
        padding,
        ...sx,
      }}
    >
      {children}
    </div>
  );
}
