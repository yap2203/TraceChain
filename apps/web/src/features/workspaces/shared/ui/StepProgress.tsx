import { Check } from 'lucide-react';

/**
 * Step indicator. With `onSelect`, each step is a button so users can jump between steps;
 * the page decides whether a jump is allowed (e.g. validate before moving forward).
 */
export function StepProgress({
  steps,
  current,
  onSelect,
  disabled = false,
  completed,
}: {
  steps: string[];
  current: number;
  onSelect?: (index: number) => void;
  disabled?: boolean;
  completed?: readonly number[];
}) {
  return (
    <ol
      className={`workspace-step-progress${onSelect ? ' is-navigable' : ''}`}
      aria-label="Form progress"
    >
      {steps.map((label, index) => {
        const complete = completed
          ? index !== current && completed.includes(index)
          : index < current;
        const content = (
          <>
            <span
              className="workspace-step-number"
              aria-label={`Step ${index + 1}${complete ? ' complete' : ''}`}
            >
              {complete ? <Check size={16} aria-hidden="true" /> : index + 1}
            </span>
            <span>{label}</span>
          </>
        );
        return (
          <li
            key={label}
            aria-current={index === current ? 'step' : undefined}
            className={complete ? 'is-complete' : undefined}
          >
            {onSelect ? (
              <button
                type="button"
                className="workspace-step-button"
                disabled={disabled}
                onClick={() => onSelect(index)}
              >
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}
