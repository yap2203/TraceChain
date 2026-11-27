import { useId, useState } from 'react';
import { Check, Copy, Maximize2, Minimize2 } from 'lucide-react';
import { notify } from '../../../../components/ui/feedback';
import './technical-identifier.css';

/** Shortens for display only; the copied and expanded value is always the original. */
export function shortIdentifier(value: string) {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

/**
 * One technical identifier (wallet, DID, transaction hash, credential ID, CID…): shortened,
 * monospace, with a copy action for the full value and a toggle to inspect it in full.
 * `boxed` renders it as a bordered field row.
 */
export function TechnicalIdentifier({
  label,
  value,
  boxed = false,
  expandable = true,
}: {
  label: string;
  value: string;
  boxed?: boolean;
  /** False in tight spaces: copy only; the full value stays in the tooltip and the copy. */
  expandable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = useId();
  // Compact form (6…4) where there is no room to expand.
  const short =
    !expandable && value.length > 12
      ? `${value.slice(0, 6)}…${value.slice(-4)}`
      : shortIdentifier(value);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      notify(`${label} copied.`, 'success');
    } catch {
      notify('Copy failed. Please try again or select and copy the value manually.', 'error');
    }
  };
  return (
    <span
      className={`technical-identifier${boxed ? ' is-boxed' : ''}${expanded ? ' is-expanded' : ''}`}
    >
      <code id={id} title={value}>
        {expanded ? value : short}
      </code>
      <button
        type="button"
        className="technical-identifier__icon"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={() => void copy()}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      {expandable && short !== value && (
        <button
          type="button"
          className="technical-identifier__icon"
          aria-expanded={expanded}
          aria-controls={id}
          aria-label={`${expanded ? 'Shorten' : 'Show full'} ${label}`}
          title={expanded ? 'Shorten' : 'Show full value'}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <Minimize2 size={14} aria-hidden="true" />
          ) : (
            <Maximize2 size={14} aria-hidden="true" />
          )}
        </button>
      )}
    </span>
  );
}
