import { useState } from 'react';
import { CheckCircle2, Package } from 'lucide-react';
import {
  T,
  UI,
  MONO,
  Btn,
  Card,
  Alert,
  Input,
  Textarea,
  VerifyRow,
  CustodyTimeline,
  StepProgress,
} from '../../shared/ui';
import { RECEIPT_STEPS, TRANSFERS } from '../fixtures';
import { QRPlaceholder } from '../QRPlaceholder';
import { type ConfirmStep } from '../types';
import { ReceiptSuccess } from './ReceiptSuccess';
import { ReceiptSigning } from './ReceiptSigning';
import { ReceiptDialogs } from './ReceiptDialogs';
export function ReviewAndConfirmReceipt({
  transferId,
  onBack,
  identificationMethod,
  showProgress,
}: {
  transferId: string;
  onBack: () => void;
  identificationMethod?: 'camera' | 'upload';
  showProgress?: boolean;
}) {
  const transfer = TRANSFERS[transferId];

  const [step, setStep] = useState<ConfirmStep>('review');
  const [qtyReceived, setQtyRec] = useState(String(transfer?.qty ?? ''));
  const [qtyDamaged, setQtyDmg] = useState('0');
  const [qtyRejected, setQtyRej] = useState('0');
  const [notes, setNotes] = useState('');
  const [discrepExpl, setDiscExp] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showReject, setShowRej] = useState(false);
  const [showDiscrep, setShowDsc] = useState(false);
  const [rejectReason, setRejRsn] = useState('');
  const [sigState, setSigState] = useState<
    'idle' | 'waiting_sig' | 'submitted' | 'confirming' | 'done'
  >('idle');
  const [txHash] = useState('0x7e4a9c18b2f30d1a');

  if (!transfer) return <div style={{ padding: 20, color: T.text2 }}>Transfer not found.</div>;

  const received = parseInt(qtyReceived) || 0;
  const damaged = parseInt(qtyDamaged) || 0;
  const rejected = parseInt(qtyRejected) || 0;
  const usable = Math.max(0, received - damaged - rejected);
  const qtyValid = damaged + rejected <= received && received >= 0;
  const mismatch = received !== transfer.qty && received > 0;

  // ── Sign flow ─────────────────────────────────────────────────────────────
  const startSign = () => {
    setStep('signing');
    setSigState('waiting_sig');
    setTimeout(() => setSigState('submitted'), 1500);
    setTimeout(() => setSigState('confirming'), 3000);
    setTimeout(() => {
      setSigState('done');
      setStep('success');
    }, 5000);
  };

  // ── Success ───────────────────────────────────────────────────────────────
  if (step === 'success')
    return (
      <ReceiptSuccess
        transfer={transfer}
        showProgress={showProgress}
        onBack={onBack}
        received={received}
        damaged={damaged}
        rejected={rejected}
        usable={usable}
        txHash={txHash}
      />
    );
  // ── Signing state ─────────────────────────────────────────────────────────
  if (step === 'signing') return <ReceiptSigning showProgress={showProgress} sigState={sigState} />;

  const confirmStep = step === 'review' || step === 'confirm' ? 1 : 3;

  return (
    <div>
      {showProgress && <StepProgress steps={RECEIPT_STEPS} current={confirmStep} />}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Review Shipment and Confirm Receipt
        </h2>
        {identificationMethod && (
          <div
            style={{
              padding: '3px 10px',
              borderRadius: 20,
              background: T.greenBg,
              border: `1px solid color-mix(in srgb, ${T.green} 19%, transparent)`,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              color: T.green,
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={11} />
            Verified · {identificationMethod === 'camera' ? 'Camera Scan' : 'Evidence Image'}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Shipment details */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Shipment Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {[
                { label: 'Transfer Reference', value: transfer.id },
                { label: 'Product', value: transfer.product },
                { label: 'Batch', value: transfer.batch },
                { label: 'Sender', value: transfer.sender },
                { label: 'Receiving Org', value: transfer.recipient },
                { label: 'Quantity Dispatched', value: `${transfer.qty} units` },
                { label: 'Dispatch Date', value: transfer.dispatch },
                { label: 'Shipment Notes', value: transfer.notes },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{ padding: '9px 0', borderBottom: `1px solid ${T.border}` }}
                >
                  <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{r.label}</div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: T.navy,
                      fontFamily: r.label.includes('Reference') || r.label === 'Batch' ? MONO : UI,
                    }}
                  >
                    {r.value}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Verification */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 12 }}>
              Verification
            </div>
            <div style={{ fontSize: 11.5, color: T.text3, marginBottom: 10 }}>
              A successful QR scan does not confirm the physical goods are correct.
            </div>
            <VerifyRow
              label="Signed-in company matches intended recipient"
              result="Identity matched"
              variant="verified"
            />
            <VerifyRow label="Sender company credential status" result="Active" variant="active" />
            <VerifyRow
              label="Recipient company credential status"
              result="Active"
              variant="active"
            />
            <VerifyRow
              label="Transfer status"
              result="Awaiting receipt"
              variant="transfer-pending"
            />
          </Card>

          {/* Quantity entry */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 6 }}>
              Enter Received Quantities
            </div>
            <div
              style={{
                fontSize: 12,
                color: T.text2,
                marginBottom: 14,
                padding: '10px 12px',
                background: T.surface2,
                borderRadius: 8,
                lineHeight: 1.6,
              }}
            >
              Damaged and rejected quantities are separate categories within the total received. Do
              not count the same units twice.
              <div style={{ marginTop: 6, fontWeight: 600, color: T.navy }}>
                Usable quantity = total received − damaged − rejected
              </div>
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <Input label="Total Received" value={qtyReceived} onChange={setQtyRec} required />
                <Input label="Damaged (of received)" value={qtyDamaged} onChange={setQtyDmg} />
                <Input label="Rejected (of received)" value={qtyRejected} onChange={setQtyRej} />
              </div>
              {!qtyValid && (
                <Alert type="error" message="Damaged + rejected cannot exceed total received." />
              )}
              {mismatch && (
                <Alert
                  type="warning"
                  message={`Shipment discrepancy detected. Dispatched: ${transfer.qty} units, Received: ${received} units. Review the difference before proceeding.`}
                />
              )}
              {mismatch && (
                <Input
                  label="Explanation for quantity difference (required)"
                  value={discrepExpl}
                  onChange={setDiscExp}
                  placeholder="Describe the reason for the quantity difference…"
                  required
                />
              )}
              {received > 0 && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: T.greenBg,
                    borderRadius: 8,
                    fontSize: 13,
                    color: T.green,
                    fontWeight: 600,
                  }}
                >
                  Usable quantity: {usable} units
                  <span style={{ fontSize: 11, fontWeight: 400, color: T.text2, marginLeft: 12 }}>
                    ({received} received − {damaged} damaged − {rejected} rejected)
                  </span>
                </div>
              )}
              <Textarea
                label="Receiving Notes"
                value={notes}
                onChange={setNotes}
                placeholder="Condition on receipt, storage notes…"
                rows={2}
              />

              <div style={{ display: 'flex', gap: 8 }}>
                <Btn
                  onClick={() => setStep('confirm')}
                  full
                  disabled={!qtyValid || received === 0 || (mismatch && !discrepExpl.trim())}
                >
                  Confirm Receipt
                </Btn>
                {mismatch && (
                  <Btn onClick={() => setShowDsc(true)} variant="secondary">
                    Report Discrepancy
                  </Btn>
                )}
                <Btn onClick={() => setShowRej(true)} variant="danger">
                  Reject Shipment
                </Btn>
              </div>
            </div>
          </Card>

          {/* Expandable product history */}
          <div>
            <button
              onClick={() => setShowHistory((o) => !o)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: UI,
                color: T.teal,
                fontSize: 13,
                fontWeight: 600,
                padding: '8px 0',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Package size={14} /> {showHistory ? 'Hide' : 'Show'} Product History
            </button>
            {showHistory && (
              <Card>
                <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
                  Custody Timeline
                </div>
                <CustodyTimeline
                  steps={[
                    {
                      org: 'CocoaCraft Manufacturing Sdn. Bhd.',
                      action: 'Product batch created',
                      date: '2026-08-01',
                      qty: '500 units',
                      verified: true,
                    },
                    {
                      org: 'Swift Distribution Sdn. Bhd.',
                      action: 'Transfer initiated',
                      date: '2026-08-05',
                      qty: `${transfer.qty} units dispatched`,
                      verified: true,
                    },
                    {
                      org: transfer.recipient,
                      action: 'Awaiting receipt confirmation',
                      date: 'Pending',
                      active: true,
                      verified: false,
                    },
                  ]}
                />
              </Card>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.text2,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 10,
              }}
            >
              Receipt Confirmation QR
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
              <QRPlaceholder transferId={transfer.id} size={130} />
            </div>
            <div style={{ fontSize: 11, color: T.text3, textAlign: 'center', lineHeight: 1.5 }}>
              This QR is specific to this shipment.
              <br />
              Separate from the product traceability QR.
            </div>
          </Card>

          <div
            style={{
              padding: '12px 14px',
              background: T.surface2,
              borderRadius: 10,
              border: `1px solid ${T.border}`,
            }}
          >
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 6 }}>Quick Summary</div>
            {[
              { label: 'Dispatched', value: `${transfer.qty}`, color: T.text },
              { label: 'Received', value: received || '—', color: T.text },
              { label: 'Damaged', value: damaged || '—', color: damaged > 0 ? T.amber : T.text },
              { label: 'Rejected', value: rejected || '—', color: rejected > 0 ? T.red : T.text },
              { label: 'Usable', value: received > 0 ? usable : '—', color: T.green },
            ].map((r) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '5px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span style={{ fontSize: 12, color: T.text2 }}>{r.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: r.color as string }}>
                  {r.value} {typeof r.value === 'number' ? 'units' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ReceiptDialogs
        transfer={transfer}
        onBack={onBack}
        received={received}
        damaged={damaged}
        rejected={rejected}
        usable={usable}
        step={step}
        setStep={setStep}
        startSign={startSign}
        showReject={showReject}
        setShowRej={setShowRej}
        rejectReason={rejectReason}
        setRejRsn={setRejRsn}
        notes={notes}
        setNotes={setNotes}
        showDiscrep={showDiscrep}
        setShowDsc={setShowDsc}
        qtyReceived={qtyReceived}
        setQtyRec={setQtyRec}
        discrepExpl={discrepExpl}
        setDiscExp={setDiscExp}
      />
    </div>
  );
}
