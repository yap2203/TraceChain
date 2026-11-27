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
  /** Goods moving: in transit. */
  | 'moving'
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
  'transfer-pending': { bg: T.purpleBg, color: T.purple, dot: T.purple },
  moving: { bg: T.purpleBg, color: T.purple, dot: T.purple },
  accepted: { bg: T.tealLight, color: T.teal, dot: T.teal },
  rejected: { bg: T.redBg, color: T.red, dot: T.red },
  requested: { bg: T.purpleBg, color: T.purple, dot: T.purple },
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
  return (
    <span
      className={`inline-flex items-center gap-[5px] rounded-[20px] font-semibold tracking-[0.03em] whitespace-nowrap ${size === 'xs' ? 'px-[6px] py-[1px] text-[11px]' : 'px-[10px] py-[3px] text-[12px]'}`}
      style={{
        background: s.bg,
        color: s.color,
        border: `1px solid color-mix(in srgb, ${s.dot} 19%, transparent)`,
      }}
    >
      <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: s.dot }} />
      {label}
    </span>
  );
}
