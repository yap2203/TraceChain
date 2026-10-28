import { useState } from 'react';
import { T, Btn, Card, Badge, Alert, Modal, TxModal, Textarea, SelectField } from '../../shared/ui';
import { APPS } from './fixtures';

export function AppDetail({ app, onBack }: { app: (typeof APPS)[0]; onBack: () => void }) {
  const [showApprove, setShowApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reviewerNotes, setReviewerNotes] = useState('');

  const doApprove = () => {
    setShowApprove(false);
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 3500);
  };
  const doReject = () => {
    setShowReject(false);
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 2000);
  };

  const CHECKLIST = [
    { label: 'Company registration document verified', done: true },
    { label: 'Business licence is current and valid', done: true },
    { label: 'Registration number cross-checked', done: true },
    { label: 'Business address verified', done: app.docs >= 3 },
    { label: 'Optional certification checked', done: app.docs >= 3 },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>{app.company}</h2>
        <Badge
          label={app.status}
          variant={
            app.status === 'approved'
              ? 'verified'
              : app.status === 'rejected'
                ? 'rejected'
                : 'pending'
          }
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Company profile */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Company Profile
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              {[
                { label: 'Application ID', value: app.id },
                { label: 'Role Requested', value: app.role },
                { label: 'Registration No.', value: app.reg },
                { label: 'Submitted', value: app.submitted },
              ].map((row) => (
                <div
                  key={row.label}
                  style={{ padding: '10px 0', borderBottom: `1px solid ${T.border}` }}
                >
                  <div style={{ fontSize: 11, color: T.text2, marginBottom: 3 }}>{row.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>{row.value}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Documents */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Submitted Documents ({app.docs})
            </div>
            {[
              'Company_Registration_Document.pdf',
              'Business_Licence_2026.pdf',
              app.docs >= 3 && 'Halal_Certification.pdf',
            ]
              .filter(Boolean)
              .map((doc) => (
                <div
                  key={String(doc)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 14px',
                    background: T.surface2,
                    borderRadius: 8,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', color: T.text3 }}>
                      PDF
                    </span>
                    <span style={{ fontSize: 13, color: T.navy }}>{String(doc)}</span>
                  </div>
                  <Btn variant="outline" size="xs">
                    Preview
                  </Btn>
                </div>
              ))}
          </Card>

          {/* Reviewer notes */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Reviewer Notes
            </div>
            <Textarea
              label=""
              value={reviewerNotes}
              onChange={setReviewerNotes}
              placeholder="Add internal review notes here…"
              rows={3}
            />
          </Card>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Verification checklist */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Verification Checklist
            </div>
            {CHECKLIST.map((item) => (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span style={{ color: item.done ? T.green : T.text3, flexShrink: 0, fontSize: 14 }}>
                  {item.done ? '✓' : '○'}
                </span>
                <span style={{ fontSize: 12, color: item.done ? T.text : T.text2 }}>
                  {item.label}
                </span>
              </div>
            ))}
          </Card>

          {/* Application timeline */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Timeline
            </div>
            {[
              { event: 'Application submitted', time: app.submitted, done: true },
              { event: 'Documents received', time: app.submitted, done: true },
              { event: 'Under authority review', time: 'In progress', done: false },
              { event: 'Decision issued', time: 'Pending', done: false },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: item.done ? T.green : T.border2,
                      flexShrink: 0,
                    }}
                  />
                  {i < 3 && (
                    <div
                      style={{
                        width: 1,
                        height: 16,
                        background: item.done ? T.green : T.border,
                        margin: '2px 0',
                      }}
                    />
                  )}
                </div>
                <div>
                  <div
                    style={{ fontSize: 12, fontWeight: 500, color: item.done ? T.navy : T.text2 }}
                  >
                    {item.event}
                  </div>
                  <div style={{ fontSize: 11, color: T.text3 }}>{item.time}</div>
                </div>
              </div>
            ))}
          </Card>

          {app.status === 'pending' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Btn onClick={() => setShowApprove(true)} full>
                Approve & Issue Credential
              </Btn>
              <Btn onClick={() => onBack()} variant="outline" full>
                Request Additional Info
              </Btn>
              <Btn onClick={() => setShowReject(true)} variant="danger" full>
                Reject Application
              </Btn>
            </div>
          )}
        </div>
      </div>

      {/* Approve modal */}
      {showApprove && (
        <Modal
          title="Issue Company Role Credential"
          onClose={() => setShowApprove(false)}
          width={480}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            {[
              { label: 'Company', value: app.company },
              { label: 'Credential Type', value: 'Company Role Credential' },
              { label: 'Assigned Role', value: app.role },
              { label: 'Validity Period', value: '12 months (expires 2027-08-09)' },
              { label: 'Issuer', value: 'Product Traceability Authority' },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: `1px solid ${T.border}`,
                }}
              >
                <span style={{ fontSize: 12, color: T.text2 }}>{row.label}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.navy }}>{row.value}</span>
              </div>
            ))}
            <Alert
              type="info"
              message="Issuing this credential records the company DID and role on the blockchain. This action is irreversible."
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn
                onClick={() => setShowApprove(false)}
                variant="outline"
                size="md"
                style={{ flex: 1 }}
              >
                Cancel
              </Btn>
              <Btn onClick={doApprove} size="md" style={{ flex: 2 }}>
                Confirm & Issue Credential
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject modal */}
      {showReject && (
        <Modal title="Reject Application" onClose={() => setShowReject(false)} width={440}>
          <div style={{ display: 'grid', gap: 14 }}>
            <SelectField
              label="Rejection Reason"
              value={rejectReason}
              onChange={setRejectReason}
              options={[
                { value: '', label: 'Select a reason…' },
                { value: 'docs', label: 'Incomplete or invalid documents' },
                { value: 'reg', label: 'Registration number could not be verified' },
                { value: 'licence', label: 'Business licence has expired' },
                { value: 'other', label: 'Other (add notes below)' },
              ]}
              required
            />
            <Textarea
              label="Additional Notes"
              value=""
              onChange={() => {}}
              placeholder="Explain the reason to the applicant…"
              rows={3}
            />
            <Alert
              type="error"
              message="The applicant will be notified of this rejection with the reason provided."
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn
                onClick={() => setShowReject(false)}
                variant="outline"
                size="md"
                style={{ flex: 1 }}
              >
                Cancel
              </Btn>
              <Btn
                onClick={doReject}
                variant="danger"
                size="md"
                disabled={!rejectReason}
                style={{ flex: 2 }}
              >
                Confirm Rejection
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      <TxModal
        state={txState}
        title="Processing…"
        message="Action completed successfully."
        onClose={() => setTx(null)}
      />
    </div>
  );
}
