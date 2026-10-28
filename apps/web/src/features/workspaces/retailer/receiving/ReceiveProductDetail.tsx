import { useState } from 'react';
import {
  T,
  Btn,
  Card,
  Badge,
  Alert,
  TxModal,
  Input,
  Textarea,
  SelectField,
  VerifyRow,
  CustodyTimeline,
  Modal,
} from '../../shared/ui';
import { RETAIL_SHIPMENTS } from '../../shared/custody-fixtures';

export function ReceiveProduct({
  shipmentId,
  onBack,
  onViewHistory,
}: {
  shipmentId?: string;
  onBack: () => void;
  onViewHistory: (batch: string) => void;
}) {
  const shipment = RETAIL_SHIPMENTS[0];
  const [qty, setQty] = useState('490');
  const [damaged, setDamaged] = useState('0');
  const [rejected, setRejected] = useState('0');
  const [notes, setNotes] = useState('');
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showDiscrep, setShowDiscrep] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [discrepType, setDiscrepType] = useState('');
  const [discrepDesc, setDiscrepDesc] = useState('');

  const received = parseInt(qty) || 0;
  const dmg = parseInt(damaged) || 0;
  const rej = parseInt(rejected) || 0;
  const usable = Math.max(0, received - dmg - rej);
  const qtyValid = dmg + rej <= received;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back to Shipments
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Receive Product · {shipment.id}
        </h2>
        <Badge
          label={accepted ? 'Accepted' : 'Awaiting Acceptance'}
          variant={accepted ? 'accepted' : 'transfer-pending'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Shipment Verification
            </div>
            <VerifyRow
              label="Product batch identity"
              result="CHOCOLATE-2026-050 found on blockchain"
              variant="matched"
            />
            <VerifyRow
              label="Distributor identity"
              result="Swift Distribution Sdn. Bhd. — Verified"
              variant="verified"
            />
            <VerifyRow
              label="Product verification"
              result="Ingredient credentials valid"
              variant="verified"
            />
            <VerifyRow label="Distributor credential" result="Active" variant="active" />
            <VerifyRow label="Custody history" result="2 of 4 stages recorded" variant="verified" />
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Shipment Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {[
                { label: 'Product', value: shipment.product },
                { label: 'Batch', value: shipment.batch },
                { label: 'Sender', value: shipment.sender },
                { label: 'Expected Qty', value: `${shipment.qty} units` },
                { label: 'Dispatch Date', value: shipment.dispatch },
                { label: 'Sender Credential', value: 'Active' },
              ].map((r) => (
                <div
                  key={r.label}
                  style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}
                >
                  <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{r.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>{r.value}</div>
                </div>
              ))}
            </div>
          </Card>

          {!accepted && (
            <Card>
              <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
                Receipt Form
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: T.text2,
                  marginBottom: 14,
                  padding: '10px 12px',
                  background: T.surface2,
                  borderRadius: 8,
                }}
              >
                Damaged and rejected are separate categories.
                <div style={{ marginTop: 4, fontWeight: 600, color: T.navy }}>
                  Usable quantity = total received − damaged − rejected
                </div>
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Input label="Total Received" value={qty} onChange={setQty} required />
                  <Input label="Damaged (of received)" value={damaged} onChange={setDamaged} />
                  <Input label="Rejected (of received)" value={rejected} onChange={setRejected} />
                </div>
                {!qtyValid && (
                  <Alert type="error" message="Damaged + rejected cannot exceed total received." />
                )}
                <div
                  style={{
                    padding: '10px 12px',
                    background: T.greenBg,
                    borderRadius: 8,
                    fontSize: 13,
                    color: T.green,
                    fontWeight: 600,
                  }}
                >
                  Usable quantity: {usable} units
                </div>
                <Textarea
                  label="Receiving Notes"
                  value={notes}
                  onChange={setNotes}
                  placeholder="Condition on receipt, packaging notes…"
                  rows={2}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <Btn
                    onClick={() => {
                      setTx('pending');
                      setTimeout(() => {
                        setTx('confirmed');
                        setAccepted(true);
                      }, 3000);
                    }}
                    full
                    disabled={!qtyValid}
                  >
                    Accept Custody
                  </Btn>
                  <Btn variant="danger" onClick={() => setShowReject(true)}>
                    Reject Shipment
                  </Btn>
                  <Btn variant="outline" onClick={() => setShowDiscrep(true)}>
                    Report Discrepancy
                  </Btn>
                </div>
                <Btn onClick={() => onViewHistory(shipment.batch)} variant="outline" full>
                  View Full Product History
                </Btn>
              </div>
            </Card>
          )}

          {accepted && (
            <>
              <Alert
                type="success"
                message={`Custody accepted. FreshMart Retail Sdn. Bhd. is now the custodian of ${shipment.batch}. ${usable} units received.`}
              />
              <Btn onClick={() => onViewHistory(shipment.batch)} variant="outline">
                View Full Product History
              </Btn>
            </>
          )}
        </div>

        <Card>
          <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
            Custody History Preview
          </div>
          <CustodyTimeline
            steps={[
              {
                org: 'CocoaCraft Manufacturing Sdn. Bhd.',
                action: 'Product created · 500 units',
                date: '2026-08-01',
                verified: true,
              },
              {
                org: 'Swift Distribution Sdn. Bhd.',
                action: 'Accepted custody · 490 units (10 damaged)',
                date: '2026-08-09',
                verified: true,
              },
              {
                org: 'FreshMart Retail Sdn. Bhd.',
                action: accepted ? `Custody accepted · ${usable} units` : 'Awaiting receipt',
                date: accepted ? '2026-09-07' : 'Pending',
                verified: accepted,
                active: !accepted,
              },
            ]}
          />
        </Card>
      </div>

      {showReject && (
        <Modal title="Reject Shipment" onClose={() => setShowReject(false)}>
          <SelectField
            label="Rejection Reason"
            value={rejectReason}
            onChange={setRejectReason}
            required
            options={[
              { value: '', label: 'Select a reason…' },
              { value: 'damaged', label: 'Goods arrived damaged' },
              { value: 'wrong_product', label: 'Wrong product delivered' },
              { value: 'qty_mismatch', label: 'Quantity does not match' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <Textarea
            label="Notes"
            value={rejectNotes}
            onChange={setRejectNotes}
            placeholder="Provide detail…"
            rows={3}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowReject(false)} variant="ghost">
              Cancel
            </Btn>
            <Btn
              variant="danger"
              full
              disabled={!rejectReason}
              onClick={() => setShowReject(false)}
            >
              Confirm Rejection
            </Btn>
          </div>
        </Modal>
      )}

      {showDiscrep && (
        <Modal title="Report Discrepancy" onClose={() => setShowDiscrep(false)}>
          <Alert
            type="warning"
            message="A discrepancy report does not complete the transfer. The sender will be notified."
          />
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <SelectField
              label="Discrepancy Type"
              value={discrepType}
              onChange={setDiscrepType}
              required
              options={[
                { value: '', label: 'Select type…' },
                { value: 'shortage', label: 'Shortage' },
                { value: 'excess', label: 'Excess' },
                { value: 'damage', label: 'Damage' },
                { value: 'wrong_product', label: 'Wrong Product' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <Textarea
              label="Description"
              value={discrepDesc}
              onChange={setDiscrepDesc}
              rows={3}
              required
              placeholder="Describe the discrepancy…"
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowDiscrep(false)} variant="ghost">
              Cancel
            </Btn>
            <Btn full disabled={!discrepType || !discrepDesc} onClick={() => setShowDiscrep(false)}>
              Submit Report
            </Btn>
          </div>
        </Modal>
      )}

      <TxModal
        state={txState}
        title="Recording Custody Acceptance"
        message="FreshMart Retail Sdn. Bhd. is now the custodian of CHOCOLATE-2026-050."
        onClose={() => setTx(null)}
      />
    </div>
  );
}
