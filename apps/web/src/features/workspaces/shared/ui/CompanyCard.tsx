import { T, MONO } from './tokens';
import { type BadgeVariant, Badge } from './Badge';

export function CompanyCard({
  name,
  role,
  did,
  status,
}: {
  name: string;
  role: string;
  did: string;
  status: BadgeVariant;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        background: T.surface2,
        borderRadius: 10,
        border: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: T.tealLight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: T.teal,
          fontWeight: 700,
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {name
          .split(' ')
          .map((w) => w[0])
          .slice(0, 2)
          .join('')}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: T.navy }}>{name}</div>
        <div style={{ fontSize: 11, color: T.text2 }}>{role}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.text3, marginTop: 2 }}>{did}</div>
      </div>
      <Badge label={status} variant={status} />
    </div>
  );
}
