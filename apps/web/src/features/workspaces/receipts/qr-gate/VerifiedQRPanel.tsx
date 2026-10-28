import { CheckCircle2 } from 'lucide-react';
import { T, UI, MONO, Btn, Card, Alert, StepProgress } from '../../shared/ui';
import { RECEIPT_STEPS, TRANSFERS } from '../fixtures';
import type { QrGateModel } from './useMandatoryQRGate';
export function VerifiedQRPanel({ model }: { model: QrGateModel }) {
  const { verified, setVerified, onVerified } = model;
  if (!verified) return null;
  const transfer = TRANSFERS[verified.transferId]!;
  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <StepProgress steps={RECEIPT_STEPS} current={0} />
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: 18,
            background: T.greenBg,
            border: `2px solid color-mix(in srgb, ${T.green} 25%, transparent)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px',
          }}
        >
          <CheckCircle2 size={30} color={T.green} />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: T.navy, margin: '0 0 6px' }}>
          Shipment QR Verified
        </h2>
        <p style={{ fontSize: 13, color: T.text2, margin: 0 }}>
          The receipt confirmation QR has been read and validated. Review the shipment before
          continuing.
        </p>
      </div>
      <Card>
        <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
          Identified Shipment
        </div>
        <div style={{ display: 'grid', gap: 0, marginBottom: 20 }}>
          {[
            { label: 'Transfer Reference', value: transfer.id, mono: true },
            { label: 'Sender', value: transfer.sender, mono: false },
            { label: 'Recipient', value: transfer.recipient, mono: false },
            { label: 'Product', value: transfer.product, mono: false },
            { label: 'Batch', value: transfer.batch, mono: true },
            { label: 'Quantity Dispatched', value: `${transfer.qty} units`, mono: false },
            { label: 'Dispatch Date', value: transfer.dispatch, mono: false },
            {
              label: 'Identification Method',
              value: verified.method === 'camera' ? 'Camera Scan' : 'Product Evidence Image',
              mono: false,
            },
          ].map((r) => (
            <div
              key={r.label}
              style={{
                display: 'flex',
                gap: 14,
                padding: '9px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div style={{ fontSize: 11, color: T.text3, width: 170, flexShrink: 0 }}>
                {r.label}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: r.label === 'Identification Method' ? T.green : T.navy,
                  fontFamily: r.mono ? MONO : UI,
                  fontWeight: r.label === 'Identification Method' ? 600 : 400,
                }}
              >
                {r.value}
              </div>
            </div>
          ))}
        </div>
        <Alert
          type="info"
          message="Scanning the QR confirms shipment identity only. Physical goods must still be counted and verified before accepting custody."
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <Btn onClick={() => onVerified(verified.transferId, verified.method)} full>
            Continue to Review Shipment
          </Btn>
          <Btn onClick={() => setVerified(null)} variant="outline">
            Scan Again
          </Btn>
        </div>
      </Card>
    </div>
  );
}
