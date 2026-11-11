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
      className="rounded-[8px] px-[14px] py-[10px] flex gap-[10px] items-start"
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
      }}
    >
      <Icon
        aria-hidden="true"
        size={17}
        strokeWidth={1.8}
        className="shrink-0 mt-[1px]"
        style={{ color: s.color }}
      />
      <span className="text-[13px]" style={{ color: s.color }}>
        {message}
      </span>
    </div>
  );
}
