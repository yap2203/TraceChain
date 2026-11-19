import { Copy, LockKeyhole } from 'lucide-react';
import { useState } from 'react';

export function ClaimRow({
  label,
  value,
  requirement,
  included,
  locked = false,
  technical = false,
  onToggle,
}: {
  label: string;
  value: string;
  requirement: 'required' | 'optional' | 'always';
  included: boolean;
  locked?: boolean;
  technical?: boolean;
  onToggle?: () => void;
}) {
  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const displayValue = technical && !showFull ? shortenTechnicalValue(value) : value;

  const copyValue = async () => {
    await navigator.clipboard?.writeText(value);
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
            {requirement === 'always'
              ? 'Always included'
              : requirement === 'required'
                ? 'Required'
                : 'Optional'}
          </span>
        </div>
        <span className="evidence-claim-row__value" title={technical ? value : undefined}>
          {displayValue}
        </span>
        {technical && (
          <div className="evidence-claim-row__technical-actions">
            <button type="button" onClick={() => setShowFull((current) => !current)}>
              {showFull ? 'Hide full value' : 'Show full value'}
            </button>
            <button type="button" aria-label={`Copy ${label}`} onClick={() => void copyValue()}>
              <Copy size={13} aria-hidden="true" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
      <div className="evidence-claim-row__control">
        <span>{locked ? 'On — locked' : included ? 'On' : 'Off'}</span>
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
