import { useState } from 'react';
import { TransferCreatedQR } from '../../receipts';
import {
  T,
  UI,
  MONO,
  Btn,
  Card,
  Badge,
  Alert,
  TxModal,
  Input,
  Textarea,
  SelectField,
} from '../../shared/ui';
import { DIST_INVENTORY, DIST_TRANSFERS } from '../../shared/custody-fixtures';

export function DistributorTransferToRetailer({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<'form' | 'review' | 'created'>('form');
  const [batchId, setBatch] = useState('CHOCOLATE-2026-050');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState('2026-09-07');
  const [ref, setRef] = useState('TRET-2026-002');
  const [notes, setNotes] = useState('');
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);

  const batch = DIST_INVENTORY.find((i) => i.batch === batchId);
  const qtyNum = parseInt(qty) || 0;
  const canContinue =
    !!batchId && qtyNum > 0 && qtyNum <= (batch?.available ?? 0) && date.trim().length > 0;

  const confirm = () => {
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 3000);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Transfer Product to Retailer
        </h2>
      </div>

      {step === 'form' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 20 }}>
              Transfer Details
            </div>
            <div style={{ display: 'grid', gap: 14 }}>
              {/* Sender */}
              <div
                style={{
                  padding: '12px 14px',
                  background: T.surface2,
                  borderRadius: 10,
                  border: `1px solid ${T.border}`,
                }}
              >
                <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>
                  Sending Organisation
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: T.navy }}>
                  Swift Distribution Sdn. Bhd.
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.teal, marginTop: 2 }}>
                  did:ethr:0x5C91…19D4
                </div>
              </div>

              {/* Batch selector */}
              <SelectField
                label="Product Batch"
                value={batchId}
                onChange={setBatch}
                required
                options={DIST_INVENTORY.map((i) => ({
                  value: i.batch,
                  label: `${i.name} — ${i.batch} (${i.available} available)`,
                }))}
              />

              {batch && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                  {[
                    { label: 'Product', value: batch.name },
                    { label: 'Available', value: `${batch.available} units` },
                    { label: 'Damaged', value: `${batch.damaged} units` },
                  ].map((r) => (
                    <div
                      key={r.label}
                      style={{ padding: '10px 12px', background: T.tealLight, borderRadius: 8 }}
                    >
                      <div style={{ fontSize: 10, color: T.text3, marginBottom: 3 }}>{r.label}</div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: T.navy }}>{r.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Receiver */}
              <div
                style={{
                  padding: '14px',
                  background: T.surface2,
                  borderRadius: 10,
                  border: `1px solid ${T.border}`,
                }}
              >
                <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>
                  Receiving Retailer — Verified
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: T.navy }}>
                      FreshMart Retail Sdn. Bhd.
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 10, color: T.teal, marginTop: 3 }}>
                      did:ethr:0x2D18…73B2
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: T.text3, marginBottom: 3 }}>
                      Role Credential
                    </div>
                    <Badge label="active" variant="active" />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, color: T.text2, fontWeight: 500, marginBottom: 6 }}>
                    Transfer Quantity <span style={{ color: T.red }}>*</span>
                  </div>
                  <input
                    type="number"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    min={1}
                    max={batch?.available}
                    placeholder={`Max ${batch?.available ?? 0}`}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: 8,
                      border: `1px solid ${qtyNum > (batch?.available ?? 0) ? T.red : T.border}`,
                      background: T.surface2,
                      color: T.text,
                      fontSize: 13,
                      fontFamily: UI,
                      outline: 'none',
                    }}
                  />
                  {qtyNum > (batch?.available ?? 0) && (
                    <div style={{ fontSize: 11, color: T.red, marginTop: 4 }}>
                      Cannot exceed available stock ({batch?.available} units).
                    </div>
                  )}
                </div>
                <Input label="Dispatch Date" type="date" value={date} onChange={setDate} required />
              </div>

              <Input
                label="Shipment Reference"
                value={ref}
                onChange={setRef}
                placeholder="TRET-2026-002"
              />
              <Textarea
                label="Handling Notes"
                value={notes}
                onChange={setNotes}
                placeholder="Temperature requirements, handling instructions…"
                rows={2}
              />

              <Alert
                type="info"
                message="Transferred quantities will remain reserved until FreshMart Retail accepts the shipment."
              />
              <Btn onClick={() => setStep('review')} full disabled={!canContinue}>
                Review Transfer
              </Btn>
            </div>
          </Card>

          {/* History sidebar */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Transfer History
            </div>
            {DIST_TRANSFERS.map((t) => (
              <div key={t.ref} style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.navy }}>{t.product}</span>
                  <Badge label={t.status} variant={t.status} />
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: T.text3 }}>{t.ref}</div>
                <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                  {t.qty} units → {t.recipient.split(' ')[0]}
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {step === 'review' && batch && (
        <div style={{ maxWidth: 680 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
              Review Transfer
            </div>
            <div style={{ display: 'grid', gap: 0, marginBottom: 20 }}>
              {[
                { label: 'Sender', value: 'Swift Distribution Sdn. Bhd.' },
                { label: 'Recipient', value: 'FreshMart Retail Sdn. Bhd.' },
                { label: 'Product', value: batch.name },
                { label: 'Batch', value: batchId },
                { label: 'Transfer Qty', value: `${qty} units` },
                { label: 'Dispatch Date', value: date },
                { label: 'Shipment Ref', value: ref },
                { label: 'Handling Notes', value: notes || '—' },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{
                    display: 'flex',
                    gap: 14,
                    padding: '10px 0',
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  <div style={{ fontSize: 12, color: T.text3, width: 140, flexShrink: 0 }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 13, color: T.text, fontWeight: 500 }}>{r.value}</div>
                </div>
              ))}
            </div>
            <Alert
              type="info"
              message="FreshMart Retail must accept the shipment to complete the handoff. The quantity will remain reserved until acceptance."
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Btn onClick={() => setStep('form')} variant="ghost">
                Back
              </Btn>
              <Btn onClick={confirm} full>
                Confirm and Sign Transfer
              </Btn>
            </div>
          </Card>
        </div>
      )}

      <TxModal
        state={txState}
        title="Recording Transfer on Blockchain"
        message="Transfer submitted. FreshMart Retail must accept the shipment to complete the handoff."
        onClose={() => {
          setTx(null);
          setStep('created');
        }}
      />

      {step === 'created' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            style={{
              background: 'var(--c-surface)',
              borderRadius: 16,
              padding: 32,
              maxWidth: 820,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              border: '1px solid var(--c-border)',
            }}
          >
            <TransferCreatedQR
              transferId="TRANSFER-2026-002"
              onViewDetails={() => {
                setStep('form');
                onBack();
              }}
              onDone={onBack}
            />
          </div>
        </div>
      )}
    </div>
  );
}
