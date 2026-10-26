import { useId, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  hint?: string;
  label: string;
}

export function Input({ className = '', error, hint, id, label, ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = error || hint ? `${inputId}-description` : undefined;

  return (
    <label className={`field ${className}`.trim()} htmlFor={inputId}>
      <span className="field__label">{label}</span>
      <input
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        className="field__control"
        id={inputId}
        {...props}
      />
      {(error || hint) && (
        <span
          className={error ? 'field__message field__message--error' : 'field__message'}
          id={descriptionId}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
