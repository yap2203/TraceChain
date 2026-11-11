import { PaginatedTable } from '../../../../components/ui/PaginatedTable';
import { type ReactNode } from 'react';

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <PaginatedTable>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-ws-surface2">
            {headers.map((h) => (
              <th
                key={h}
                className="px-[16px] py-[10px] text-left text-[11px] text-ws-text2 font-semibold tracking-[0.05em] uppercase whitespace-nowrap border-b [border-bottom-style:solid] border-ws-border"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </PaginatedTable>
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
      className={`border-b [border-bottom-style:solid] border-ws-border transition-[background] duration-[120ms] ease-[ease] ${onClick ? 'cursor-pointer hover:bg-ws-surface2' : ''}`}
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
      className={`px-[16px] py-[12px] text-[13px] ${mono ? 'font-code' : 'font-ui'} ${muted ? 'text-ws-text2' : 'text-ws-text'} ${bold ? 'font-semibold' : 'font-normal'}`}
    >
      {children}
    </td>
  );
}
