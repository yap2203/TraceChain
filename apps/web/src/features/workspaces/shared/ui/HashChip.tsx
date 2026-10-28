import { useState } from 'react';
import { T, MONO } from './tokens';

export function HashChip({ value, full }: { value: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const display = full ? value : value.slice(0, 8) + '…' + value.slice(-4);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: T.surface2,
        border: `1px solid ${T.border}`,
        borderRadius: 5,
        padding: '2px 8px',
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 11, color: T.teal }}>{display}</span>
      <button
        onClick={copy}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: copied ? T.green : T.text3,
          fontSize: 11,
          padding: 0,
          lineHeight: 1,
        }}
      >
        {copied ? '✓' : '⎘'}
      </button>
    </span>
  );
}
