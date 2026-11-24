import { type ReactNode, type CSSProperties, type MouseEventHandler } from 'react';

export type BtnVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

export type BtnSize = 'xs' | 'sm' | 'md' | 'lg';

const variants: Record<BtnVariant, string> = {
  primary: 'bg-ws-teal text-ws-on-accent border-ws-teal',
  secondary: 'bg-ws-surface text-ws-teal border-ws-teal',
  outline: 'bg-transparent text-ws-text2 border-ws-border2',
  ghost: 'bg-transparent text-ws-text2 border-transparent',
  danger: 'bg-ws-red text-white border-ws-red',
};
const sizes: Record<BtnSize, string> = {
  xs: 'min-h-[28px] px-[10px] py-[4px] text-[12px] rounded-[6px]',
  sm: 'min-h-[32px] px-[14px] py-[6px] text-[12px] rounded-[7px]',
  md: 'min-h-[38px] px-[18px] py-[9px] text-[13px] rounded-[8px]',
  lg: 'min-h-[44px] px-[24px] py-[12px] text-[14px] rounded-[9px]',
};

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
  'aria-current': ariaCurrent,
  'aria-pressed': ariaPressed,
  'aria-label': ariaLabel,
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
  'aria-current'?: 'page';
  'aria-pressed'?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type={type}
      aria-current={ariaCurrent}
      aria-pressed={ariaPressed}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled || (!onClick && type !== 'submit')}
      title={!onClick && type !== 'submit' ? 'This action is not available yet' : undefined}
      className={`workspace-button inline-flex flex-row flex-nowrap items-center justify-center gap-[6px] font-semibold font-ui min-w-0 max-w-full border border-solid transition-all duration-150 ease-[ease] ${variants[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer opacity-100'}`}
      style={sx}
    >
      {icon && <span className="workspace-button__icon">{icon}</span>}
      <span className="workspace-button__label">{children}</span>
    </button>
  );
}
