import { useId, type SelectHTMLAttributes } from 'react';

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  hint?: string;
  label: string;
  options: readonly SelectOption[];
}

export function Select({ className = '', hint, id, label, options, ...props }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-description` : undefined;

  return (
    <label className={`field ${className}`.trim()} htmlFor={selectId}>
      <span className="field__label">{label}</span>
      <select aria-describedby={hintId} className="field__control" id={selectId} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <span className="field__message" id={hintId}>
          {hint}
        </span>
      )}
    </label>
  );
}
