import { type ReactNode, type CSSProperties } from 'react';
import { T } from './tokens';

export function Card({
  children,
  style: sx,
  onClick,
  padding = '20px',
}: {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
  padding?: string;
}) {
  return (
    <div
      className="workspace-card"
      onClick={onClick}
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        padding,
        minWidth: 0,
        maxWidth: '100%',
        ...sx,
        cursor: onClick ? 'pointer' : undefined,
      }}
    >
      {children}
    </div>
  );
}
