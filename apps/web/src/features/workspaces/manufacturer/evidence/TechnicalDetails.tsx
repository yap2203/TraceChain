import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { T, UI, MONO, Card } from '../../shared/ui';
import { type EvidenceRequest } from './types';

export function TechnicalDetails({ req }: { req: EvidenceRequest }) {
  const [open, setOpen] = useState(false);
  return (
    <Card padding="0px">
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '13px 18px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: UI,
          color: T.text2,
          fontSize: 12.5,
          fontWeight: 500,
        }}
      >
        Technical Details
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div style={{ padding: '4px 18px 16px', borderTop: `1px solid ${T.border}` }}>
          {[
            { label: 'Supplier DID', value: req.supplierDid },
            { label: 'Credential ID', value: req.credentialId ?? '—' },
            { label: 'Presentation ID', value: req.presentationId ?? '—' },
          ].map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                gap: 12,
                padding: '7px 0',
                borderBottom: `1px solid ${T.border}`,
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: 11, color: T.text3, width: 130, flexShrink: 0 }}>
                {row.label}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: T.text2, flex: 1 }}>
                {row.value}
              </div>
              {row.value !== '—' && (
                <button
                  onClick={() => navigator.clipboard?.writeText(row.value)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: T.text3,
                  }}
                >
                  <Copy size={11} />
                </button>
              )}
            </div>
          ))}
          <div style={{ fontSize: 11, color: T.text3, marginTop: 10, lineHeight: 1.6 }}>
            No hash comparison is shown for selectively disclosed presentations. A full hash
            comparison requires the complete credential.
          </div>
        </div>
      )}
    </Card>
  );
}
