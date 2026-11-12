import { T } from './tokens';

export interface TechnicalField {
  label: string;
  value: string;
}

export function TechnicalDetails({ fields }: { fields: TechnicalField[] }) {
  const visible = fields.filter((field) => field.value);
  if (!visible.length) return null;
  return (
    <details
      style={{
        marginTop: 16,
        padding: '12px 14px',
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <summary style={{ color: T.text2, cursor: 'pointer', fontSize: 12 }}>
        Technical details
      </summary>
      <dl style={{ display: 'grid', gap: 10, margin: '12px 0 0' }}>
        {visible.map((field) => (
          <div key={field.label} style={{ display: 'grid', gap: 4 }}>
            <dt style={{ color: T.text2, fontSize: 11 }}>{field.label}</dt>
            <dd
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
                margin: 0,
                minWidth: 0,
                maxWidth: '100%',
              }}
            >
              <code
                title={field.value}
                style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {shortIdentifier(field.value)}
              </code>
              <button
                type="button"
                aria-label={`Copy ${field.label}`}
                onClick={() => void navigator.clipboard.writeText(field.value)}
                style={{
                  padding: '3px 8px',
                  border: `1px solid ${T.border2}`,
                  borderRadius: 5,
                  background: 'transparent',
                  color: T.teal,
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function shortIdentifier(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}
