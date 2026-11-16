import { Check, Circle, Clock3 } from 'lucide-react';

export interface StatusTimelineStep {
  actor?: string;
  detail?: string;
  label: string;
  state: 'complete' | 'current' | 'pending';
}

export function StatusTimeline({
  label = 'Workflow status',
  steps,
}: {
  label?: string;
  steps: StatusTimelineStep[];
}) {
  return (
    <ol className="workspace-status-timeline" aria-label={label}>
      {steps.map((step) => {
        const Icon = step.state === 'complete' ? Check : step.state === 'current' ? Clock3 : Circle;
        return (
          <li
            key={step.label}
            className={`is-${step.state}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="workspace-status-timeline__icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span className="workspace-status-timeline__copy">
              <strong>{step.label}</strong>
              {step.actor && <span>{step.actor}</span>}
              {step.detail && <small>{step.detail}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
