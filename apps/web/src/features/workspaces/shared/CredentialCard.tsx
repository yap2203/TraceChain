import { BadgeCheck } from 'lucide-react';
import { T, MONO } from './ui';
export function CredentialCard({
  role,
  org,
  did,
  credId,
  issue,
  expiry,
}: {
  role: string;
  org: string;
  did: string;
  credId: string;
  issue: string;
  expiry: string;
}) {
  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${T.navyDark} 0%, #0A2240 100%)`,
        borderRadius: 16,
        padding: 28,
        marginBottom: 20,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: -20,
          right: -20,
          width: 140,
          height: 140,
          borderRadius: '50%',
          background: 'rgba(22,140,140,0.15)',
        }}
      />
      <div style={{ position: 'relative' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                background: T.teal,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BadgeCheck size={22} color="#fff" />
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.45)',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  marginBottom: 2,
                }}
              >
                TraceChain · SSI Credential
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
                {role} Role Credential
              </div>
            </div>
          </div>
          <div
            style={{
              background: T.teal,
              borderRadius: 20,
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            Active
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 18, color: '#fff', marginBottom: 4 }}>{org}</div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            marginBottom: 20,
          }}
        >
          {did}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {[
            { label: 'Credential ID', value: credId },
            { label: 'Issuer', value: 'Product Traceability Authority' },
            { label: 'Issue Date', value: issue },
            { label: 'Expiry Date', value: expiry },
          ].map((r) => (
            <div key={r.label}>
              <div
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.4)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 3,
                }}
              >
                {r.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#fff',
                  fontFamily: r.label === 'Credential ID' ? MONO : undefined,
                }}
              >
                {r.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
