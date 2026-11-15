import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

/** Secondary guidance stays available without competing with the current action. */
export function WorkflowHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="workspace-workflow-help">
      <summary>
        <CircleHelp size={16} aria-hidden="true" />
        {title}
      </summary>
      <div>{children}</div>
    </details>
  );
}
