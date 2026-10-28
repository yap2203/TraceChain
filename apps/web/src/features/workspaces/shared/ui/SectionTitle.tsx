import { type ReactNode } from 'react';
import { T } from './tokens';

export function SectionTitle({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20,
      }}
    >
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>{title}</h2>
        {sub && <div style={{ fontSize: 13, color: T.text2, marginTop: 3 }}>{sub}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
