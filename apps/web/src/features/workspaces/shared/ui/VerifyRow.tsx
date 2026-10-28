import { T } from './tokens';
import { type BadgeVariant, Badge } from './Badge';

export function VerifyRow({
  label,
  result,
  variant,
}: {
  label: string;
  result: string;
  variant: BadgeVariant;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      <span style={{ fontSize: 13, color: T.text }}>{label}</span>
      <Badge label={result} variant={variant} />
    </div>
  );
}
