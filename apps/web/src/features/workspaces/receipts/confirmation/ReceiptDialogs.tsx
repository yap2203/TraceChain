import { T, UI, Btn, Alert, Modal, Input, Textarea } from '../../shared/ui';
import { TRANSFERS } from '../fixtures';
import { type ConfirmStep } from '../types';

export function ReceiptDialogs({
  transfer,
  onBack,
  received,
  damaged,
  rejected,
  usable,
  step,
  setStep,
  startSign,
  showReject,
  setShowRej,
  rejectReason,
  setRejRsn,
  notes,
  setNotes,
  showDiscrep,
  setShowDsc,
  qtyReceived,
  setQtyRec,
  discrepExpl,
  setDiscExp,
}: {
  transfer: (typeof TRANSFERS)[string];
  onBack: () => void;
  received: number;
  damaged: number;
  rejected: number;
  usable: number;
  step: ConfirmStep;
  setStep: (step: ConfirmStep) => void;
  startSign: () => void;
  showReject: boolean;
  setShowRej: (value: boolean) => void;
  rejectReason: string;
  setRejRsn: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  showDiscrep: boolean;
  setShowDsc: (value: boolean) => void;
  qtyReceived: string;
  setQtyRec: (value: string) => void;
  discrepExpl: string;
  setDiscExp: (value: string) => void;
}) {
  return (
    <>
      {' '}
      {/* Confirm dialog */}
      {step === 'confirm' && (
        <Modal
          title="Confirm Receipt of This Shipment?"
          onClose={() => setStep('review')}
          width={520}
        >
          <div style={{ display: 'grid', gap: 0, marginBottom: 16 }}>
            {[
              { label: 'Sender', value: transfer.sender },
              { label: 'Recipient', value: transfer.recipient },
              { label: 'Transfer Reference', value: transfer.id },
              { label: 'Product Batch', value: transfer.batch },
              { label: 'Received', value: `${received} units` },
              { label: 'Damaged', value: `${damaged} units` },
              { label: 'Rejected', value: `${rejected} units` },
              { label: 'Usable', value: `${usable} units` },
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
                <div style={{ fontSize: 11, color: T.text3, width: 150, flexShrink: 0 }}>
                  {r.label}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: T.text,
                    fontWeight: r.label === 'Usable' ? 700 : 400,
                  }}
                >
                  {r.value}
                </div>
              </div>
            ))}
          </div>
          <div
            style={{
              padding: '12px 14px',
              background: T.amberBg,
              borderRadius: 8,
              fontSize: 12,
              color: T.amber,
              marginBottom: 16,
            }}
          >
            I confirm that my organisation has received and checked the quantities shown above.
          </div>
          <div style={{ fontSize: 12, color: T.text3, marginBottom: 16 }}>
            This records your organisation's receipt and custody acceptance on the blockchain. A
            network fee may apply.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={() => setStep('review')} variant="ghost">
              Cancel
            </Btn>
            <Btn onClick={startSign} full>
              Sign and Confirm Receipt
            </Btn>
          </div>
        </Modal>
      )}
      {/* Reject dialog */}
      {showReject && (
        <Modal title="Reject Shipment" onClose={() => setShowRej(false)}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: T.text2, fontWeight: 500, marginBottom: 6 }}>
                Rejection Reason <span style={{ color: T.red }}>*</span>
              </div>
              <select
                value={rejectReason}
                onChange={(e) => setRejRsn(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: `1px solid ${T.border}`,
                  background: T.surface2,
                  color: T.text,
                  fontSize: 13,
                  fontFamily: UI,
                }}
              >
                <option value="">Select a reason…</option>
                <option>Goods arrived damaged</option>
                <option>Wrong product delivered</option>
                <option>Quantity does not match</option>
                <option>Credential verification failed</option>
                <option>Other</option>
              </select>
            </div>
            <Textarea
              label="Notes"
              value={notes}
              onChange={setNotes}
              placeholder="Provide additional detail…"
              rows={3}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => setShowRej(false)} variant="ghost">
                Cancel
              </Btn>
              <Btn
                variant="danger"
                full
                disabled={!rejectReason}
                onClick={() => {
                  setShowRej(false);
                  onBack();
                }}
              >
                Confirm Rejection
              </Btn>
            </div>
          </div>
        </Modal>
      )}
      {/* Discrepancy dialog */}
      {showDiscrep && (
        <Modal title="Report Discrepancy" onClose={() => setShowDsc(false)}>
          <Alert
            type="warning"
            message="A discrepancy report keeps the transfer unresolved until reviewed. It does not complete the transfer."
          />
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: T.text2, fontWeight: 500, marginBottom: 6 }}>
                Discrepancy Type <span style={{ color: T.red }}>*</span>
              </div>
              <select
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: `1px solid ${T.border}`,
                  background: T.surface2,
                  color: T.text,
                  fontSize: 13,
                  fontFamily: UI,
                }}
              >
                <option>Shortage — fewer units than expected</option>
                <option>Excess — more units than expected</option>
                <option>Damage — goods arrived damaged</option>
                <option>Wrong Product</option>
                <option>Other</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input label="Expected Quantity" value={String(transfer.qty)} onChange={() => {}} />
              <Input label="Actual Quantity" value={qtyReceived} onChange={setQtyRec} />
            </div>
            <Textarea
              label="Description (required)"
              value={discrepExpl}
              onChange={setDiscExp}
              placeholder="Describe the discrepancy…"
              rows={3}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowDsc(false)} variant="ghost">
              Cancel
            </Btn>
            <Btn
              full
              onClick={() => {
                setShowDsc(false);
                onBack();
              }}
              disabled={!discrepExpl.trim()}
            >
              Submit Report
            </Btn>
          </div>
        </Modal>
      )}
    </>
  );
}
