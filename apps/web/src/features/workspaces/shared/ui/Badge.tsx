import { T } from './tokens';

export type BadgeVariant =
  | 'verified'
  | 'active'
  | 'pending'
  | 'suspended'
  | 'revoked'
  | 'expired'
  | 'valid'
  | 'invalid'
  | 'matched'
  | 'mismatch'
  | 'transfer-pending'
  | 'accepted'
  | 'rejected'
  | 'requested'
  | 'shared'
  | 'default';

export const BADGE: Record<BadgeVariant, { bg: string; color: string; dot: string }> = {
  verified: { bg: T.greenBg, color: T.green, dot: T.green },
  active: { bg: T.greenBg, color: T.green, dot: T.green },
  pending: { bg: T.amberBg, color: T.amber, dot: T.amber },
  suspended: { bg: T.amberBg, color: T.amber, dot: T.amber },
  revoked: { bg: T.redBg, color: T.red, dot: T.red },
  expired: { bg: T.greyBg, color: T.grey, dot: T.grey },
  valid: { bg: T.greenBg, color: T.green, dot: T.green },
  invalid: { bg: T.redBg, color: T.red, dot: T.red },
  matched: { bg: T.greenBg, color: T.green, dot: T.green },
  mismatch: { bg: T.redBg, color: T.red, dot: T.red },
  'transfer-pending': { bg: 'rgba(139,92,246,0.15)', color: '#A78BFA', dot: '#A78BFA' },
  accepted: { bg: T.tealLight, color: T.teal, dot: T.teal },
  rejected: { bg: T.redBg, color: T.red, dot: T.red },
  requested: { bg: 'rgba(139,92,246,0.15)', color: '#A78BFA', dot: '#A78BFA' },
  shared: { bg: T.tealLight, color: T.teal, dot: T.teal },
  default: { bg: T.surface2, color: T.text2, dot: T.text3 },
};

export function Badge({
  label,
  variant = 'default',
  size = 'sm',
}: {
  label: string;
  variant?: BadgeVariant;
  size?: 'xs' | 'sm';
}) {
  const s = BADGE[variant] ?? BADGE.default;
  const pad = size === 'xs' ? '1px 6px' : '3px 10px';
  const fs = size === 'xs' ? 10 : 11;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: s.bg,
        color: s.color,
        border: `1px solid color-mix(in srgb, ${s.dot} 19%, transparent)`,
        borderRadius: 20,
        padding: pad,
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0 }}
      />
      {label}
    </span>
  );
}
