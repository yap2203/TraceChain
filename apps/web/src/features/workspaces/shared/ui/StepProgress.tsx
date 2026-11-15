import { Check } from 'lucide-react';

export function StepProgress({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="workspace-step-progress" aria-label="Form progress">
      {steps.map((label, index) => (
        <li
          key={label}
          aria-current={index === current ? 'step' : undefined}
          className={index < current ? 'is-complete' : undefined}
        >
          <span
            className="workspace-step-number"
            aria-label={`Step ${index + 1}${index < current ? ' complete' : ''}`}
          >
            {index < current ? <Check size={16} aria-hidden="true" /> : index + 1}
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  );
}
