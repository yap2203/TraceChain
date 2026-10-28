import { BadgeCheck } from 'lucide-react';
import { T, MONO, Badge } from '../../shared/ui';

export function SupplierIdentityCard({
  name,
  did,
  credStatus,
}: {
  name: string;
  did: string;
  credStatus: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: T.surface2,
        borderRadius: 10,
        border: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: T.tealLight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <BadgeCheck size={18} color={T.teal} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{name}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: T.text2, marginTop: 2 }}>{did}</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: T.text3, marginBottom: 3 }}>Role Credential</div>
        <Badge label={credStatus} variant={credStatus as any} />
      </div>
    </div>
  );
}
