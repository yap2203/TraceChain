import { type ReactNode, type CSSProperties } from 'react';
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
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 600, color: T.text2 }}>
        {label}
        {required && <span style={{ color: T.red, marginLeft: 2 }}>*</span>}
        {children}
      </label>
      {hint && <div style={{ fontSize: 11, color: T.text3 }}>{hint}</div>}
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
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <FormField label={label} required={required} hint={hint}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}) {
  return (
    <FormField label={label} required={required}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
  return (
    <FormField label={label} required={required}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
