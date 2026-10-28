import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import { T } from './tokens';

export function Alert({
  type = 'warning',
  message,
}: {
  type?: 'warning' | 'error' | 'success' | 'info';
  message: string;
}) {
  const styles = {
    warning: {
      bg: T.amberBg,
      color: T.amber,
      border: `color-mix(in srgb, ${T.amber} 19%, transparent)`,
      icon: TriangleAlert,
    },
    error: {
      bg: T.redBg,
      color: T.red,
      border: `color-mix(in srgb, ${T.red} 19%, transparent)`,
      icon: CircleX,
    },
    success: {
      bg: T.greenBg,
      color: T.green,
      border: `color-mix(in srgb, ${T.green} 19%, transparent)`,
      icon: CircleCheck,
    },
    info: {
      bg: T.tealLight,
      color: T.teal,
      border: `color-mix(in srgb, ${T.teal} 19%, transparent)`,
      icon: Info,
    },
  };
  const s = styles[type];
  const Icon = s.icon;
  return (
    <div
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <Icon
        aria-hidden="true"
        size={17}
        strokeWidth={1.8}
        style={{ color: s.color, flexShrink: 0, marginTop: 1 }}
      />
      <span style={{ fontSize: 13, color: s.color }}>{message}</span>
    </div>
  );
}
