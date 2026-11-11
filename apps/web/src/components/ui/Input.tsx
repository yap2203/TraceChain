import { useId, useState, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  hint?: string;
  label: string;
}

export function Input({
  className = '',
  error,
  hint,
  id,
  label,
  onBlur,
  onChange,
  onInvalid,
  ...props
}: InputProps) {
  const generatedId = useId();
  const [validationMessage, setValidationMessage] = useState('');
  error = error || validationMessage;
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
        onChange={(event) => {
          event.currentTarget.setCustomValidity('');
          setValidationMessage('');
          onChange?.(event);
        }}
        onBlur={(event) => {
          event.currentTarget.setCustomValidity(
            props.required && !event.currentTarget.value.trim()
              ? `${label.replace(/\s*\*$/, '')} is required.`
              : '',
          );
          setValidationMessage(event.currentTarget.validationMessage);
          onBlur?.(event);
        }}
        onInvalid={(event) => {
          setValidationMessage(event.currentTarget.validationMessage);
          onInvalid?.(event);
        }}
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
