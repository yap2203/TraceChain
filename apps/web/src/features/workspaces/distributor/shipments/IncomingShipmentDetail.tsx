import { useState } from 'react';
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
  VerifyRow,
  CustodyTimeline,
  Modal,
} from '../../shared/ui';
import { INCOMING_SHIPMENTS } from '../../shared/custody-fixtures';

export function IncomingShipment({
  shipmentId,
  onBack,
}: {
  shipmentId?: string;
  onBack: () => void;
}) {
  const shipment = INCOMING_SHIPMENTS[0];
  const [qtyReceived, setQtyReceived] = useState('500');
  const [qtyDamaged, setQtyDamaged] = useState('0');
  const [qtyRejected, setQtyRejected] = useState('0');
  const [remarks, setRemarks] = useState('');
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showDiscrep, setShowDiscrep] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');
  const [discrepType, setDiscrepType] = useState('');
  const [discrepDesc, setDiscrepDesc] = useState('');
  const [discrepActual, setDiscrepActual] = useState('');

  const received = parseInt(qtyReceived) || 0;
  const damaged = parseInt(qtyDamaged) || 0;
  const rejected = parseInt(qtyRejected) || 0;
  const usable = Math.max(0, received - damaged - rejected);
  const qtyValid = damaged + rejected <= received;

  const accept = () => {
    if (!qtyValid) return;
    setTx('pending');
    setTimeout(() => {
      setTx('confirmed');
      setAccepted(true);
    }, 3000);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back to Shipments
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>
          Incoming Shipment · {shipment.id}
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
              Shipment Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {[
                { label: 'Product Name', value: shipment.product },
                { label: 'Product Batch', value: shipment.batch },
                { label: 'Sender', value: shipment.sender },
                { label: 'Sender DID', value: shipment.senderDid },
                { label: 'Expected Qty', value: `${shipment.qty} units` },
                { label: 'Dispatch Date', value: shipment.dispatch },
                { label: 'Shipment Ref', value: shipment.id },
                { label: 'Sender Credential', value: 'Active' },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}
                >
                  <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{row.label}</div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: T.navy,
                      fontFamily: row.label.includes('DID') ? MONO : UI,
                    }}
                  >
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Credential Integrity Check
            </div>
            <VerifyRow
              label="Manufacturer identity"
              result="Company identity verified"
              variant="verified"
            />
            <VerifyRow label="Manufacturer credential" result="Active" variant="active" />
            <VerifyRow
              label="Product batch record"
              result="Found on blockchain"
              variant="matched"
            />
            <VerifyRow label="Ingredient credentials" result="All 3 verified" variant="verified" />
            <VerifyRow label="Overall result" result="Verified" variant="verified" />
          </Card>

          {!accepted && (
            <Card>
              <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
                Accept Custody
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
                Damaged and rejected quantities are separate. Damaged units are received but not
                usable. Rejected units are refused at delivery.
                <div style={{ marginTop: 6, fontWeight: 600, color: T.navy }}>
                  Usable quantity = total received − damaged − rejected
                </div>
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Input
                    label="Total Received"
                    value={qtyReceived}
                    onChange={setQtyReceived}
                    required
                  />
                  <Input
                    label="Damaged (of received)"
                    value={qtyDamaged}
                    onChange={setQtyDamaged}
                  />
                  <Input
                    label="Rejected (of received)"
                    value={qtyRejected}
                    onChange={setQtyRejected}
                  />
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
                {received !== shipment.qty && received > 0 && (
                  <div>
                    <Input
                      label="Explanation for quantity difference (required)"
                      value={remarks}
                      onChange={setRemarks}
                      placeholder={`Expected ${shipment.qty}, received ${received}. Please explain.`}
                      required
                    />
                  </div>
                )}
                <Textarea
                  label="Receiving Remarks"
                  value={remarks}
                  onChange={setRemarks}
                  placeholder="Condition on receipt, packaging notes…"
                  rows={2}
                />
                <Alert
                  type="warning"
                  message="Accepting custody transfers product responsibility to Swift Distribution Sdn. Bhd. This is recorded on the blockchain."
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <Btn onClick={accept} full disabled={!qtyValid}>
                    Accept Custody
                  </Btn>
                  <Btn variant="danger" onClick={() => setShowReject(true)}>
                    Reject Shipment
                  </Btn>
                  <Btn variant="outline" onClick={() => setShowDiscrep(true)}>
                    Report Discrepancy
                  </Btn>
                </div>
              </div>
            </Card>
          )}

          {accepted && (
            <Alert
              type="success"
              message={`Custody accepted. Swift Distribution Sdn. Bhd. is now the custodian of ${shipment.batch}. ${usable} units available${damaged > 0 ? `, ${damaged} damaged` : ''}.`}
            />
          )}
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Custody Timeline
            </div>
            <CustodyTimeline
              steps={[
                {
                  org: 'CocoaCraft Manufacturing Sdn. Bhd.',
                  action: 'Product batch created & transferred',
                  date: '2026-08-05',
                  qty: '500 units dispatched',
                  verified: true,
                },
                {
                  org: 'Swift Distribution Sdn. Bhd.',
                  action: accepted
                    ? `Custody accepted — ${usable} units (${damaged} damaged)`
                    : 'Awaiting custody acceptance',
                  date: accepted ? '2026-08-09' : 'Pending',
                  qty: accepted ? `${usable} units available` : undefined,
                  verified: accepted,
                  active: !accepted,
                },
                {
                  org: 'Retailer',
                  action: 'Pending transfer from distributor',
                  date: '—',
                  verified: false,
                },
              ]}
            />
          </Card>
        </div>
      </div>

      {/* Reject dialog */}
      {showReject && (
        <Modal title="Reject Shipment" onClose={() => setShowReject(false)}>
          <div style={{ fontSize: 13, color: T.text2, marginBottom: 16 }}>
            Rejecting this shipment will return it to the sender. This action is recorded on the
            blockchain.
          </div>
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
              { value: 'failed_verification', label: 'Credential verification failed' },
              { value: 'other', label: 'Other' },
            ]}
          />
          <Textarea
            label="Additional Notes"
            value={rejectNotes}
            onChange={setRejectNotes}
            placeholder="Provide more detail about the rejection…"
            rows={3}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowReject(false)} variant="ghost">
              Cancel
            </Btn>
            <Btn
              variant="danger"
              full
              onClick={() => {
                setShowReject(false);
              }}
              disabled={!rejectReason}
            >
              Confirm Rejection
            </Btn>
          </div>
        </Modal>
      )}

      {/* Discrepancy dialog */}
      {showDiscrep && (
        <Modal title="Report Discrepancy" onClose={() => setShowDiscrep(false)}>
          <Alert
            type="warning"
            message="A discrepancy report does not complete the transfer. The sender will be notified and the shipment remains in a discrepancy state pending resolution."
          />
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <SelectField
              label="Discrepancy Type"
              value={discrepType}
              onChange={setDiscrepType}
              required
              options={[
                { value: '', label: 'Select type…' },
                { value: 'shortage', label: 'Shortage — fewer units than expected' },
                { value: 'excess', label: 'Excess — more units than expected' },
                { value: 'damage', label: 'Damage — goods arrived damaged' },
                { value: 'wrong_product', label: 'Wrong Product — product does not match order' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input label="Expected Quantity" value={`${shipment.qty}`} onChange={() => {}} />
              <Input
                label="Actual Quantity"
                value={discrepActual}
                onChange={setDiscrepActual}
                placeholder="e.g. 450"
              />
            </div>
            <Textarea
              label="Description"
              value={discrepDesc}
              onChange={setDiscrepDesc}
              placeholder="Describe the discrepancy in detail…"
              rows={3}
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowDiscrep(false)} variant="ghost">
              Cancel
            </Btn>
            <Btn full onClick={() => setShowDiscrep(false)} disabled={!discrepType || !discrepDesc}>
              Submit Report
            </Btn>
          </div>
        </Modal>
      )}

      <TxModal
        state={txState}
        title="Recording Custody Acceptance"
        message="Custody accepted. You are now the custodian of CHOCOLATE-2026-050."
        onClose={() => setTx(null)}
      />
    </div>
  );
}
