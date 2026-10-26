import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { LoadingIndicator } from './LoadingIndicator';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  leadingIcon?: ReactNode;
  loading?: boolean;
  size?: 'small' | 'medium';
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({
  children,
  className = '',
  disabled,
  leadingIcon,
  loading = false,
  size = 'medium',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading ? <LoadingIndicator label="Working" size="small" /> : leadingIcon}
      <span>{children}</span>
    </button>
  );
}
