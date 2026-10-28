import { type ReactNode } from 'react';
import { T } from './tokens';
import { Card } from './Card';

export function StatCard({
  label,
  value,
  color,
  icon,
  delta,
}: {
  label: string;
  value: string | number;
  color?: string;
  icon?: ReactNode;
  delta?: string;
}) {
  return (
    <Card padding="20px">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 12, color: T.text2, fontWeight: 500, marginBottom: 8 }}>
            {label}
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, color: color ?? T.navy, lineHeight: 1 }}>
            {value}
          </div>
          {delta && <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>{delta}</div>}
        </div>
        {icon && <div style={{ opacity: 0.5, color }}>{icon}</div>}
      </div>
    </Card>
  );
}
