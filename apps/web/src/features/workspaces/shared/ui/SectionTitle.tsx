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
    <div className="workspace-section-title flex justify-between items-start flex-wrap gap-[12px] mb-[20px]">
      <div>
        <h2 className="text-[18px] font-bold text-ws-navy m-0">{title}</h2>
        {sub && <div className="text-[13px] text-ws-text2 mt-[3px]">{sub}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
