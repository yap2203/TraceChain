import { RequiredLabel } from '../../../../components/ui/RequiredLabel';
import { openDatePicker } from '../../../../components/ui/date-picker';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

const inputClasses =
  'min-w-0 max-w-full w-full bg-ws-surface border border-solid border-ws-border2 rounded-[8px] px-[12px] py-[9px] text-[length:var(--text-body,14px)] text-ws-text focus:border-ws-teal transition-[border-color] duration-150 ease-[ease]';

export function FormField({
  label,
  required,
  children,
  hint,
  error,
  descriptionId,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
  error?: string;
  descriptionId?: string;
}) {
  return (
    <div className="workspace-form-field flex flex-col gap-[5px] min-w-0">
      <label className="grid gap-[5px] text-[length:var(--text-label,13px)] font-semibold text-ws-text2 min-w-0">
        <span>
          <RequiredLabel label={label} required={required} />
        </span>
        {children}
      </label>
      {(error || hint) && (
        <div
          id={descriptionId}
          role={error ? 'alert' : undefined}
          className={`text-[length:var(--text-label,13px)] ${error ? 'text-ws-red' : 'text-ws-text3'}`}
        >
          {error || hint}
        </div>
      )}
    </div>
  );
}

export function Input({
  label,
  placeholder,
  value,
  onChange,
  type = 'text',
  required,
  hint,
  mono,
  icon,
  error,
  ...constraints
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
  mono?: boolean;
  icon?: ReactNode;
  error?: string;
} & Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | 'min'
  | 'max'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'step'
  | 'inputMode'
  | 'readOnly'
  | 'disabled'
>) {
  const descriptionId = useId();
  const [validationMessage, setValidationMessage] = useState('');
  const check = (input: HTMLInputElement) => {
    input.setCustomValidity(required && !input.value.trim() ? `${label} is required.` : '');
    setValidationMessage(input.validationMessage);
  };
  return (
    <FormField
      label={label}
      required={required}
      hint={hint}
      error={error || validationMessage}
      descriptionId={descriptionId}
    >
      <span className="relative block min-w-0">
        {icon && (
          <span
            aria-hidden="true"
            className="absolute left-[12px] top-1/2 -translate-y-1/2 inline-flex text-ws-text3 pointer-events-none"
          >
            {icon}
          </span>
        )}
        <input
          {...constraints}
          required={required}
          aria-invalid={Boolean(error || validationMessage)}
          aria-describedby={error || validationMessage || hint ? descriptionId : undefined}
          type={type}
          value={value}
          placeholder={placeholder}
          onClick={openDatePicker}
          onChange={(e) => {
            e.target.setCustomValidity('');
            setValidationMessage('');
            onChange(e.target.value);
          }}
          onBlur={(e) => check(e.currentTarget)}
          onInvalid={(e) => check(e.currentTarget)}
          className={`${inputClasses} ${icon ? 'pl-[38px]' : '[padding-left:revert]'} ${mono ? 'font-code' : 'font-ui'}`}
        />
      </span>
    </FormField>
  );
}

export function Textarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  required,
  maxLength = 4000,
  error,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  maxLength?: number;
  error?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  const [message, setMessage] = useState('');
  const shown = error || message;
  return (
    <FormField
      label={label}
      required={required}
      error={shown}
      hint={hint}
      descriptionId={descriptionId}
    >
      <textarea
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        value={value}
        aria-invalid={!!shown}
        aria-describedby={shown || hint ? descriptionId : undefined}
        onChange={(e) => {
          e.target.setCustomValidity('');
          setMessage('');
          onChange(e.target.value);
        }}
        onBlur={(e) => {
          e.currentTarget.setCustomValidity(
            required && !e.currentTarget.value.trim() ? `${label} is required.` : '',
          );
          setMessage(e.currentTarget.validationMessage);
        }}
        placeholder={placeholder}
        rows={rows}
        className={`${inputClasses} font-ui resize-y`}
      />
    </FormField>
  );
}

/** A small set of mutually exclusive choices, all visible (use SelectField for long lists). */
export function RadioGroup({
  label,
  value,
  onChange,
  options,
  required,
  error,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  required?: boolean;
  error?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const name = useId();
  const descriptionId = useId();
  return (
    <fieldset
      className="workspace-radio-group"
      aria-describedby={error || hint ? descriptionId : undefined}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
    >
      <legend>
        <RequiredLabel label={label} required={required} />
      </legend>
      <div className="workspace-radio-group__options">
        {options.map((option) => (
          <label key={option.value} className={value === option.value ? 'is-selected' : undefined}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              required={required}
              onChange={() => onChange(option.value)}
            />
            <span>
              {option.label}
              {option.hint && <small>{option.hint}</small>}
            </span>
          </label>
        ))}
      </div>
      {(error || hint) && (
        <div
          id={descriptionId}
          role={error ? 'alert' : undefined}
          className={`text-[length:var(--text-label,13px)] ${error ? 'text-ws-red' : 'text-ws-text3'}`}
        >
          {error || hint}
        </div>
      )}
    </fieldset>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  const [message, setMessage] = useState('');
  return (
    <FormField label={label} required={required} error={message} descriptionId={descriptionId}>
      <select
        disabled={disabled}
        required={required}
        value={value}
        aria-invalid={!!message}
        aria-describedby={message ? descriptionId : undefined}
        onChange={(e) => {
          setMessage('');
          onChange(e.target.value);
        }}
        onBlur={(e) => setMessage(e.currentTarget.validationMessage)}
        className={`${inputClasses} font-ui cursor-pointer`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
