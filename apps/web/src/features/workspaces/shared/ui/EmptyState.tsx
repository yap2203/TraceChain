import { type ReactNode } from 'react';
import { T } from './tokens';

export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px' }}>
      <div style={{ marginBottom: 14, opacity: 0.25, display: 'flex', justifyContent: 'center' }}>
        {icon}
      </div>
      <div style={{ fontWeight: 600, fontSize: 15, color: T.navy, marginBottom: 6 }}>{title}</div>
      <div
        style={{
          fontSize: 13,
          color: T.text2,
          marginBottom: action ? 20 : 0,
          maxWidth: 360,
          margin: '0 auto',
        }}
      >
        {sub}
      </div>
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}
