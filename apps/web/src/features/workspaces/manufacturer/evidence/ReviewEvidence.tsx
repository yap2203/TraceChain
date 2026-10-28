import { useState } from 'react';
import {
  T,
  UI,
  MONO,
  Btn,
  Card,
  Badge,
  Alert,
  Modal,
  Textarea,
  SelectField,
} from '../../shared/ui';
import { type EvidenceRequest } from './types';
import { TechnicalDetails } from './TechnicalDetails';
import { VerificationPanel } from './VerificationPanel';

export function ReviewEvidence({
  req,
  onBack,
  onAccept,
  onReject,
}: {
  req: EvidenceRequest;
  onBack: () => void;
  onAccept: (notes: string) => void;
  onReject: (reason: string, notes: string) => void;
}) {
  const [showAccept, setShowAccept] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [acceptNotes, setAcceptNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNotes, setRejectNotes] = useState('');

  const shared = req.sharedClaims ?? [];
  const missingRequired = req.claims.filter(
    (c) => c.req === 'required' && !shared.find((s) => s.name === c.name && s.disclosed),
  );
  const canAccept = req.scenario === 'success' && missingRequired.length === 0;
  const provided = shared.filter((s) => s.disclosed).length;
  const notDisclosed = shared.filter((s) => !s.disclosed).length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 17, color: T.navy }}>{req.ingredient}</span>
            <Badge label="Evidence Received" variant="requested" />
          </div>
          <div style={{ fontSize: 12, color: T.text2, marginTop: 3 }}>
            {req.batch} · {req.supplier} · {req.id}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 10 }}>
              Information Shared by Supplier
            </div>

            {/* Summary line */}
            <div
              style={{
                fontSize: 12.5,
                color: T.text2,
                marginBottom: 12,
                padding: '8px 12px',
                background: T.surface2,
                borderRadius: 8,
              }}
            >
              {provided} requested {provided === 1 ? 'claim' : 'claims'} provided.
              {notDisclosed > 0 &&
                ` ${notDisclosed} ${notDisclosed === 1 ? 'claim' : 'claims'} not disclosed.`}
            </div>

            {missingRequired.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <Alert
                  type="warning"
                  message={`Required information is missing: ${missingRequired.map((c) => c.name).join(', ')}. Request this information before accepting the evidence.`}
                />
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: T.surface2 }}>
                    {['Claim', 'Requirement', 'Shared Value', 'Status'].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: '8px 12px',
                          textAlign: 'left',
                          fontSize: 11,
                          color: T.text2,
                          fontWeight: 600,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          borderBottom: `1px solid ${T.border}`,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {req.claims.map((c) => {
                    const sc = shared.find((s) => s.name === c.name);
                    const disclosed = sc?.disclosed ?? false;
                    return (
                      <tr key={c.name} style={{ borderBottom: `1px solid ${T.border}` }}>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: T.text }}>
                          {c.name}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: c.req === 'required' ? T.amber : T.teal,
                            }}
                          >
                            {c.req === 'required' ? 'Required' : 'Optional'}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: '10px 12px',
                            fontSize: 13,
                            color: disclosed ? T.text : T.text3,
                            fontStyle: disclosed ? 'normal' : 'italic',
                          }}
                        >
                          {disclosed ? sc?.value : 'Not disclosed by supplier.'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <Badge
                            label={disclosed ? 'Provided' : 'Not Disclosed'}
                            variant={disclosed ? 'verified' : 'suspended'}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 12 }}>
              Presentation Information
            </div>
            <div style={{ display: 'grid', gap: 0 }}>
              {[
                { label: 'Presentation ID', value: req.presentationId ?? '—' },
                { label: 'Credential ID', value: req.credentialId ?? '—' },
                { label: 'Credential Issuer', value: 'ABC Ingredients Sdn. Bhd.' },
                { label: 'Presentation Sender', value: req.supplier },
                { label: 'Intended Recipient', value: 'CocoaCraft Manufacturing Sdn. Bhd.' },
                { label: 'Presentation Created', value: '2026-08-03 14:22' },
                { label: 'Presentation Expiry', value: '2026-08-17 14:22' },
                { label: 'Credential Expiry', value: req.credentialExpiry ?? '—' },
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
                      fontFamily:
                        r.label.includes('ID') ||
                        r.label.includes('Expiry') ||
                        r.label.includes('Created')
                          ? MONO
                          : UI,
                      fontSize: 12,
                      color: T.text2,
                    }}
                  >
                    {r.value}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <TechnicalDetails req={req} />
        </div>

        {/* Verification panel */}
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <VerificationPanel
            scenario={req.scenario!}
            canAccept={canAccept}
            onAccept={() => setShowAccept(true)}
            onMissing={() => setShowMissing(true)}
            onReject={() => setShowReject(true)}
          />
        </div>
      </div>

      {/* Accept modal */}
      {showAccept && (
        <Modal title="Accept Ingredient Evidence?" onClose={() => setShowAccept(false)}>
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {[
              { label: 'Supplier', value: req.supplier },
              { label: 'Ingredient', value: req.ingredient },
              { label: 'Batch', value: req.batch },
              { label: 'Credential', value: req.credentialId ?? '—' },
            ].map((r) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '7px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <div style={{ fontSize: 11, color: T.text3, width: 100, flexShrink: 0 }}>
                  {r.label}
                </div>
                <div style={{ fontSize: 13, color: T.text }}>{r.value}</div>
              </div>
            ))}
          </div>
          <Textarea
            label="Review Notes (optional)"
            value={acceptNotes}
            onChange={setAcceptNotes}
            placeholder="Any notes about this evidence…"
            rows={3}
          />
          <Alert
            type="info"
            message="Acceptance records your review decision. It does not automatically create a product batch."
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowAccept(false)} variant="ghost">
              Cancel
            </Btn>
            <Btn
              onClick={() => {
                onAccept(acceptNotes);
                setShowAccept(false);
              }}
              full
            >
              Confirm Acceptance
            </Btn>
          </div>
        </Modal>
      )}

      {/* Request missing info modal */}
      {showMissing && (
        <Modal title="Request Missing Information" onClose={() => setShowMissing(false)}>
          <div style={{ fontSize: 13, color: T.text2, marginBottom: 16 }}>
            The following required claims were not disclosed. A follow-up request will be sent to
            the supplier.
          </div>
          <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
            {(missingRequired.length > 0
              ? missingRequired
              : req.claims.filter((c) => c.req === 'required')
            ).map((c) => (
              <div
                key={c.name}
                style={{
                  padding: '7px 10px',
                  background: T.amberBg,
                  borderRadius: 7,
                  fontSize: 13,
                  color: T.amber,
                }}
              >
                {c.name}
              </div>
            ))}
          </div>
          <Textarea
            label="Additional explanation"
            value={rejectNotes}
            onChange={setRejectNotes}
            placeholder="Explain what you still need…"
            rows={3}
          />
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: T.text2, fontWeight: 500, marginBottom: 6 }}>
              Response Due Date
            </div>
            <input
              type="date"
              defaultValue="2026-09-21"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${T.border}`,
                background: T.surface2,
                color: T.text,
                fontSize: 12,
                fontFamily: UI,
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowMissing(false)} variant="ghost">
              Cancel
            </Btn>
            <Btn onClick={() => setShowMissing(false)} full>
              Send Follow-up Request
            </Btn>
          </div>
        </Modal>
      )}

      {/* Reject modal */}
      {showReject && (
        <Modal title="Reject Evidence" onClose={() => setShowReject(false)}>
          <SelectField
            label="Rejection Reason"
            value={rejectReason}
            onChange={setRejectReason}
            options={[
              { value: '', label: 'Select a reason…' },
              { value: 'batch_mismatch', label: 'Ingredient batch does not match' },
              { value: 'incomplete', label: 'Required information is incomplete' },
              { value: 'failed_verify', label: 'Evidence failed verification' },
              { value: 'requirements', label: 'Evidence does not meet manufacturing requirements' },
              { value: 'other', label: 'Other' },
            ]}
            required
          />
          <Textarea
            label="Additional Notes"
            value={rejectNotes}
            onChange={setRejectNotes}
            placeholder="Provide additional context…"
            rows={3}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn onClick={() => setShowReject(false)} variant="ghost">
              Cancel
            </Btn>
            <Btn
              onClick={() => {
                if (rejectReason) {
                  onReject(rejectReason, rejectNotes);
                  setShowReject(false);
                }
              }}
              variant="danger"
              full
              disabled={!rejectReason}
            >
              Reject Evidence
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}
