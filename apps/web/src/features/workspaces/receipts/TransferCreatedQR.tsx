import { useState } from 'react';
import { CheckCircle2, Download, Printer, Link2 } from 'lucide-react';
import { T, UI, MONO, Btn, Card, Badge, Alert } from '../shared/ui';
import { TRANSFERS } from './fixtures';
import { QRPlaceholder } from './QRPlaceholder';

export function TransferCreatedQR({
  transferId,
  onViewDetails,
  onDone,
}: {
  transferId: string;
  onViewDetails: () => void;
  onDone: () => void;
}) {
  const transfer = TRANSFERS[transferId];
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard?.writeText(`https://tracechain.app/receipt/${transferId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!transfer) return null;

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: T.greenBg,
            border: `2px solid color-mix(in srgb, ${T.green} 25%, transparent)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
          }}
        >
          <CheckCircle2 size={28} color={T.green} />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: T.navy, margin: '0 0 6px' }}>
          Transfer Created — Awaiting Receipt
        </h2>
        <p style={{ fontSize: 13, color: T.text2, margin: 0 }}>
          Share this QR code with the receiving organisation to confirm the shipment.
        </p>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'start' }}
      >
        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Transfer Details
          </div>
          <div style={{ display: 'grid', gap: 0 }}>
            {[
              { label: 'Transfer Reference', value: transfer.id },
              { label: 'Product', value: transfer.product },
              { label: 'Batch', value: transfer.batch },
              { label: 'Sender', value: transfer.sender },
              { label: 'Recipient', value: transfer.recipient },
              { label: 'Quantity Dispatched', value: `${transfer.qty} units` },
              { label: 'Dispatch Date', value: transfer.dispatch },
            ].map((r) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <div style={{ fontSize: 11, color: T.text3, width: 160, flexShrink: 0 }}>
                  {r.label}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: T.text,
                    fontFamily:
                      r.label.includes('Transfer') || r.label.includes('Batch') ? MONO : UI,
                    fontWeight: r.label === 'Transfer Reference' ? 600 : 400,
                  }}
                >
                  {r.value}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 12, padding: '8px 0' }}>
              <div style={{ fontSize: 11, color: T.text3, width: 160, flexShrink: 0 }}>Status</div>
              <Badge label="Awaiting Receipt" variant="transfer-pending" />
            </div>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.text2,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 8,
              }}
            >
              Receipt Confirmation QR
            </div>
            <QRPlaceholder transferId={transfer.id} size={160} />
            <div
              style={{ fontSize: 10, color: T.text3, marginTop: 8, maxWidth: 160, lineHeight: 1.5 }}
            >
              Ask the receiving company to scan this code and confirm the quantity received.
            </div>
          </div>

          <div style={{ display: 'grid', gap: 6, width: 160 }}>
            <Btn size="sm" full>
              <Download size={12} style={{ marginRight: 4 }} />
              Download QR
            </Btn>
            <Btn size="sm" variant="secondary" full>
              <Printer size={12} style={{ marginRight: 4 }} />
              Print Label
            </Btn>
            <Btn size="sm" variant="outline" full onClick={copyLink}>
              <Link2 size={12} style={{ marginRight: 4 }} />
              {copied ? 'Copied!' : 'Copy Link'}
            </Btn>
          </div>
        </div>
      </div>

      <Alert
        type="info"
        message="The receipt QR is only for confirming this specific shipment. It is separate from the product traceability QR."
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Btn onClick={onViewDetails} variant="secondary">
          View Transfer Details
        </Btn>
        <Btn onClick={onDone} variant="outline">
          Done
        </Btn>
      </div>
    </div>
  );
}
