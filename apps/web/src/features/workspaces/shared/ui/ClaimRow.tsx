import { Copy, LockKeyhole } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function ClaimRow({
  label,
  value,
  requirement,
  requirementLabel,
  included,
  locked = false,
  technical = false,
  onToggle,
}: {
  label: string;
  /** Text, or richer content such as a certification or a document preview. */
  value: ReactNode;
  requirement: 'required' | 'optional' | 'always';
  /** Overrides the tag text, e.g. "Choose one" for a row in a required group. */
  requirementLabel?: string;
  included: boolean;
  locked?: boolean;
  technical?: boolean;
  onToggle?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Only plain technical text is shortened and copyable.
  const text = technical && typeof value === 'string' ? value : undefined;
  const displayValue = text ? shortenTechnicalValue(text) : value;

  const copyValue = async () => {
    await navigator.clipboard?.writeText(text ?? '');
    setCopied(true);
  };

  return (
    <div className={`evidence-claim-row${included ? ' is-included' : ''}`}>
      <div className="evidence-claim-row__content">
        <div className="evidence-claim-row__title">
          <strong>{label}</strong>
          <span
            className={`evidence-claim-row__requirement is-${requirement === 'always' ? 'required' : requirement}`}
          >
            {requirementLabel ?? (requirement === 'optional' ? 'Optional' : 'Required')}
          </span>
        </div>
        <div className="evidence-claim-row__value" title={text}>
          {displayValue}
          {text && (
            <button
              type="button"
              className="evidence-claim-row__copy"
              aria-label={copied ? `${label} copied` : `Copy ${label}`}
              title={copied ? 'Copied' : 'Copy full value'}
              onClick={() => void copyValue()}
            >
              <Copy size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="evidence-claim-row__control">
        <button
          type="button"
          role="switch"
          aria-label={`Share ${label}`}
          aria-checked={included}
          disabled={locked}
          className="evidence-claim-switch"
          onClick={onToggle}
        >
          <span aria-hidden="true" />
        </button>
        {locked && <LockKeyhole size={14} aria-label="Required and locked" />}
      </div>
    </div>
  );
}

function shortenTechnicalValue(value: string) {
  if (value.length <= 20) return value;
  if (value.startsWith('0x')) return `${value.slice(0, 6)}…${value.slice(-4)}`;
  if (value.startsWith('did:')) return `${value.slice(0, 16)}…${value.slice(-8)}`;
  return `${value.slice(0, 12)}…${value.slice(-6)}`;
}
