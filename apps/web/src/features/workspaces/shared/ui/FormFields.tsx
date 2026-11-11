import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { T, UI, MONO } from './tokens';

export const inputBase: CSSProperties = {
  width: '100%',
  background: T.surface,
  border: `1px solid ${T.border2}`,
  borderRadius: 8,
  padding: '9px 12px',
  fontSize: 13,
  color: T.text,
  outline: 'none',
  fontFamily: UI,
  transition: 'border-color 0.15s',
};

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600, color: T.text2 }}>
        <span>
          {label}
          {required && <span style={{ color: T.red, marginLeft: 2 }}> *</span>}
        </span>
        {children}
      </label>
      {(error || hint) && (
        <div
          id={descriptionId}
          role={error ? 'alert' : undefined}
          style={{ fontSize: 11, color: error ? T.red : T.text3 }}
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
      <input
        {...constraints}
        required={required}
        aria-invalid={Boolean(error || validationMessage)}
        aria-describedby={error || validationMessage || hint ? descriptionId : undefined}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          e.target.setCustomValidity('');
          setValidationMessage('');
          onChange(e.target.value);
        }}
        onBlur={(e) => check(e.currentTarget)}
        onInvalid={(e) => check(e.currentTarget)}
        style={{ ...inputBase, fontFamily: mono ? MONO : UI }}
      />
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  maxLength?: number;
}) {
  const descriptionId = useId();
  const [message, setMessage] = useState('');
  return (
    <FormField label={label} required={required} error={message} descriptionId={descriptionId}>
      <textarea
        required={required}
        maxLength={maxLength}
        value={value}
        aria-invalid={!!message}
        aria-describedby={message ? descriptionId : undefined}
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
        style={{ ...inputBase, resize: 'vertical' }}
      />
    </FormField>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  const descriptionId = useId();
  const [message, setMessage] = useState('');
  return (
    <FormField label={label} required={required} error={message} descriptionId={descriptionId}>
      <select
        required={required}
        value={value}
        aria-invalid={!!message}
        aria-describedby={message ? descriptionId : undefined}
        onChange={(e) => {
          setMessage('');
          onChange(e.target.value);
        }}
        onBlur={(e) => setMessage(e.currentTarget.validationMessage)}
        style={{ ...inputBase, cursor: 'pointer' }}
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
