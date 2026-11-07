import { BadgeCheck, Copy } from 'lucide-react';

import { MONO, T } from './ui';

export interface CredentialCardProps {
  credentialId: string;
  expiry: string;
  issue: string;
  issuer: string;
  org: string;
  registrationNumber: string;
  role: string;
  status: string;
  subjectDid: string;
  wallet: string;
  onCopy?: (label: string, value: string) => void;
}

export function CredentialCard(props: CredentialCardProps) {
  const fields = [
    { label: 'Registration number', value: props.registrationNumber },
    { label: 'Approved role', value: props.role },
    { label: 'Issuer', value: props.issuer },
    { label: 'Issue date', value: props.issue },
    { label: 'Expiry date', value: props.expiry },
    { label: 'Credential ID', value: props.credentialId, copy: true },
  ];
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
            gap: 16,
            marginBottom: 24,
            flexWrap: 'wrap',
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
                TraceChain · Company Digital Identity
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
                {props.role} Company Role Credential
              </div>
            </div>
          </div>
          <div
            style={{
              background: statusColor(props.status),
              borderRadius: 20,
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            {titleCase(props.status)}
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: 20, color: '#fff', marginBottom: 4 }}>
          {props.org}
        </div>
        <CopyValue label="Associated wallet" value={props.wallet} onCopy={props.onCopy} />
        <CopyValue label="Company / subject DID" value={props.subjectDid} onCopy={props.onCopy} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
            gap: 16,
            marginTop: 20,
          }}
        >
          {fields.map((field) => (
            <div key={field.label}>
              <div
                style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.4)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 3,
                }}
              >
                {field.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#fff',
                  fontFamily: field.copy ? MONO : undefined,
                  overflowWrap: 'anywhere',
                }}
              >
                {field.copy ? short(field.value) : field.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CopyValue({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy?: (label: string, value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minWidth: 0 }}>
      <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase' }}>
        {label}
      </span>
      <code
        style={{
          color: '#fff',
          fontFamily: MONO,
          fontSize: 11,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {short(value)}
      </code>
      <button
        type="button"
        aria-label={`Copy full ${label}`}
        title={`Copy full ${label}`}
        onClick={() => onCopy?.(label, value)}
        style={{
          background: 'transparent',
          border: 0,
          color: '#fff',
          cursor: 'pointer',
          display: 'inline-flex',
          padding: 3,
        }}
      >
        <Copy size={14} />
      </button>
    </div>
  );
}
function short(value: string) {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}
function titleCase(value: string) {
  return value.toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}
function statusColor(status: string) {
  return status === 'ACTIVE'
    ? T.teal
    : status === 'SUSPENDED'
      ? T.amber
      : status === 'UNKNOWN'
        ? T.grey
        : T.red;
}
