import { Check, Circle, Clock3 } from 'lucide-react';
import type { ReactNode } from 'react';

export interface StatusTimelineStep {
  actor?: string;
  detail?: string;
  icon?: ReactNode;
  label: string;
  state: 'complete' | 'current' | 'pending';
}

export function StatusTimeline({
  label = 'Workflow status',
  steps,
  variant = 'default',
}: {
  label?: string;
  steps: StatusTimelineStep[];
  variant?: 'default' | 'custody' | 'arrival';
}) {
  return (
    <ol
      className={`workspace-status-timeline workspace-status-timeline--${variant}`}
      aria-label={label}
    >
      {steps.map((step) => {
        const Icon = step.state === 'complete' ? Check : step.state === 'current' ? Clock3 : Circle;
        return (
          <li
            key={step.label}
            className={`is-${step.state}`}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="workspace-status-timeline__icon" aria-hidden="true">
              {step.icon ?? <Icon size={16} />}
              {variant === 'custody' && step.state === 'complete' && (
                <span className="workspace-status-timeline__check">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
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
