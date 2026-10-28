import { CheckCircle2 } from 'lucide-react';
import { T, Btn, Card, Alert, HashChip, StepProgress } from '../../shared/ui';
import { RECEIPT_STEPS, TRANSFERS } from '../fixtures';

export function ReceiptSuccess({
  transfer,
  showProgress,
  onBack,
  received,
  damaged,
  rejected,
  usable,
  txHash,
}: {
  transfer: (typeof TRANSFERS)[string];
  showProgress: boolean | undefined;
  onBack: () => void;
  received: number;
  damaged: number;
  rejected: number;
  usable: number;
  txHash: string;
}) {
  return (
    <>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {showProgress && <StepProgress steps={RECEIPT_STEPS} current={4} />}
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
            Receipt Confirmed
          </h2>
          <p style={{ fontSize: 13, color: T.text2, margin: 0 }}>
            The receipt has been recorded on the blockchain.
          </p>
        </div>
        <Card>
          <div style={{ display: 'grid', gap: 0, marginBottom: 16 }}>
            {[
              { label: 'Transfer Reference', value: transfer.id },
              { label: 'Receiving Organisation', value: transfer.recipient },
              {
                label: 'Confirmation Time',
                value: new Date().toLocaleString('en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }),
              },
              { label: 'Quantity Received', value: `${received} units` },
              { label: 'Damaged', value: `${damaged} units` },
              { label: 'Rejected', value: `${rejected} units` },
              { label: 'Usable Quantity', value: `${usable} units` },
              { label: 'Transaction', value: txHash },
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
                <div style={{ fontSize: 11, color: T.text3, width: 180, flexShrink: 0 }}>
                  {r.label}
                </div>
                {r.label === 'Transaction' ? (
                  <HashChip value={r.value} />
                ) : (
                  <div
                    style={{
                      fontSize: 13,
                      color: T.text,
                      fontWeight: r.label === 'Usable Quantity' ? 700 : 400,
                    }}
                  >
                    {r.value}
                  </div>
                )}
              </div>
            ))}
          </div>
          <Alert
            type="success"
            message="Inventory, transfer status and custody timeline have been updated. Both organisations have been notified."
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Btn onClick={onBack}>View Product History</Btn>
            <Btn variant="secondary" onClick={onBack}>
              View Inventory
            </Btn>
            <Btn variant="outline" onClick={onBack}>
              Download Receipt
            </Btn>
          </div>
        </Card>
      </div>
    </>
  );
}
