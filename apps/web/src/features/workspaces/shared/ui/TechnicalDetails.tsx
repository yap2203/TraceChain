import { T } from './tokens';
import { TechnicalIdentifier } from './TechnicalIdentifier';

export { shortIdentifier } from './TechnicalIdentifier';

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
      <summary style={{ color: T.text2, cursor: 'pointer', fontSize: 'var(--text-label,13px)' }}>
        Technical details
      </summary>
      <dl style={{ display: 'grid', gap: 10, margin: '12px 0 0' }}>
        {visible.map((field) => (
          <div key={field.label} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <dt style={{ color: T.text2, fontSize: 'var(--text-label,13px)' }}>{field.label}</dt>
            <dd style={{ margin: 0, minWidth: 0 }}>
              <TechnicalIdentifier label={field.label} value={field.value} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
