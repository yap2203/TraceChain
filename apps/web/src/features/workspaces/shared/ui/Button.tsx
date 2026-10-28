import { type ReactNode, type CSSProperties, type MouseEventHandler } from 'react';
import { T, UI } from './tokens';

export type BtnVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

export type BtnSize = 'xs' | 'sm' | 'md' | 'lg';

export function Btn({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  full = false,
  icon,
  style: sx,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  variant?: BtnVariant;
  size?: BtnSize;
  disabled?: boolean;
  full?: boolean;
  icon?: ReactNode;
  style?: CSSProperties;
  type?: 'button' | 'submit';
}) {
  const V: Record<BtnVariant, CSSProperties> = {
    primary: { background: T.teal, color: 'var(--c-on-accent)', border: `1px solid ${T.teal}` },
    secondary: { background: T.surface, color: T.teal, border: `1px solid ${T.teal}` },
    outline: { background: 'transparent', color: T.text2, border: `1px solid ${T.border2}` },
    ghost: { background: 'transparent', color: T.text2, border: '1px solid transparent' },
    danger: { background: T.red, color: '#fff', border: `1px solid ${T.red}` },
  };
  const SZ: Record<BtnSize, CSSProperties> = {
    xs: { padding: '4px 10px', fontSize: 11, borderRadius: 6 },
    sm: { padding: '6px 14px', fontSize: 12, borderRadius: 7 },
    md: { padding: '9px 18px', fontSize: 13, borderRadius: 8 },
    lg: { padding: '12px 24px', fontSize: 14, borderRadius: 9 },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || (!onClick && type !== 'submit')}
      title={!onClick && type !== 'submit' ? 'This action is not available yet' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
        fontFamily: UI,
        width: full ? '100%' : undefined,
        justifyContent: 'center',
        ...V[variant],
        ...SZ[size],
        ...sx,
      }}
    >
      {icon && <span>{icon}</span>}
      {children}
    </button>
  );
}
