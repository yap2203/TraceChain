import { type ReactNode } from 'react';

export function SectionTitle({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <header className="workspace-section-title flex justify-between items-start flex-wrap gap-[12px] mb-[20px]">
      <div>
        <h2 className="font-bold text-ws-navy m-0">{title}</h2>
        {sub && (
          <p className="text-[length:var(--text-body,14px)] text-ws-text2 mt-[3px] max-w-[72ch]">
            {sub}
          </p>
        )}
      </div>
      {action && <div>{action}</div>}
    </header>
  );
}
