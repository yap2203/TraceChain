import { type ReactNode } from 'react';
import { T, UI, MONO } from './tokens';

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: T.surface2 }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: '10px 16px',
                  textAlign: 'left',
                  fontSize: 11,
                  color: T.text2,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function TR({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick?.();
        }
      }}
      style={{
        borderBottom: `1px solid ${T.border}`,
        cursor: onClick ? 'pointer' : undefined,
        transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => onClick && (e.currentTarget.style.background = T.surface2)}
      onMouseLeave={(e) => onClick && (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  mono,
  muted,
  bold,
}: {
  children: ReactNode;
  mono?: boolean;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <td
      style={{
        padding: '12px 16px',
        fontSize: 13,
        fontFamily: mono ? MONO : UI,
        color: muted ? T.text2 : T.text,
        fontWeight: bold ? 600 : 400,
      }}
    >
      {children}
    </td>
  );
}
