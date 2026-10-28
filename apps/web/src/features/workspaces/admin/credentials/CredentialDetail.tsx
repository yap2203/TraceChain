import { useState } from 'react';
import {
  T,
  MONO,
  Btn,
  Card,
  Badge,
  Alert,
  Modal,
  TxModal,
  Input,
  Textarea,
  SelectField,
  VerifyRow,
} from '../../shared/ui';
import { CREDS } from './fixtures';

export function CredDetail({ cred, onBack }: { cred: (typeof CREDS)[0]; onBack: () => void }) {
  const [showTech, setShowTech] = useState(false);
  const [showSuspend, setShowSuspend] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [txState, setTx] = useState<'pending' | 'confirmed' | 'failed' | null>(null);

  const doSuspend = () => {
    setShowSuspend(false);
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 3000);
  };
  const doRevoke = () => {
    setShowRevoke(false);
    setTx('pending');
    setTimeout(() => setTx('confirmed'), 3000);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
        <Btn onClick={onBack} variant="ghost" size="sm">
          Back
        </Btn>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>{cred.company}</h2>
        <Badge label={cred.status} variant={cred.status as any} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Credential card */}
          <div
            style={{
              background: T.navyDark,
              borderRadius: 14,
              padding: '28px',
              color: T.text,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 200,
                height: 200,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.03)',
                transform: 'translate(50%,-50%)',
              }}
            />
            <div
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              Company Role Credential · TraceChain
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>{cred.company}</div>
            <div style={{ fontSize: 14, color: T.teal, marginBottom: 20 }}>{cred.role}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                { label: 'Credential ID', value: cred.id },
                { label: 'Issuer', value: 'Product Traceability Authority' },
                { label: 'Issue Date', value: cred.issued },
                { label: 'Expiry Date', value: cred.expiry },
              ].map((row) => (
                <div key={row.label}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 3 }}>
                    {row.label}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{row.value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 4 }}>
                Subject DID
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: T.teal }}>{cred.did}</div>
            </div>
          </div>

          {/* Verification */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Verification Summary
            </div>
            <VerifyRow
              label="Company identity"
              result="Company identity verified"
              variant="verified"
            />
            <VerifyRow
              label="Credential issuer"
              result="Issued by Product Traceability Authority"
              variant="verified"
            />
            <VerifyRow label="Digital signature" result="Valid Signature" variant="valid" />
            <VerifyRow label="Blockchain hash" result="Hash Matched" variant="matched" />
            <VerifyRow
              label="Overall status"
              result={cred.status === 'active' ? 'Verified' : 'Suspended'}
              variant={cred.status === 'active' ? 'verified' : 'suspended'}
            />
          </Card>

          {/* Status timeline */}
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Status History
            </div>
            {[
              { event: 'Credential Issued', date: cred.issued, done: true },
              { event: 'Activated', date: cred.issued, done: true },
              ...(cred.status === 'suspended'
                ? [{ event: 'Suspended — pending review', date: '2026-07-15', done: true }]
                : []),
              {
                event: cred.expiry <= '2027-08-09' ? 'Expires' : 'Active',
                date: cred.expiry,
                done: false,
              },
            ].map((item, i, arr) => (
              <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: item.done ? T.green : T.border2,
                      flexShrink: 0,
                    }}
                  />
                  {i < arr.length - 1 && (
                    <div
                      style={{
                        width: 1,
                        height: 20,
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
                  <div style={{ fontSize: 11, color: T.text3 }}>{item.date}</div>
                </div>
              </div>
            ))}
          </Card>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: 14, color: T.navy, marginBottom: 14 }}>
              Actions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Btn onClick={() => setShowTech(!showTech)} variant="outline" full>
                {showTech ? 'Hide' : 'View'} Technical Details
              </Btn>
              <Btn onClick={() => navigator.clipboard.writeText(cred.id)} variant="outline" full>
                Copy Credential ID
              </Btn>
              <Btn
                onClick={() => setShowSuspend(true)}
                variant="outline"
                style={{ color: T.amber, borderColor: T.amber }}
                full
              >
                Suspend Credential
              </Btn>
              <Btn onClick={() => setShowRevoke(true)} variant="danger" full>
                Revoke Credential
              </Btn>
              <Btn variant="outline" full>
                Download Summary
              </Btn>
            </div>
          </Card>

          {showTech && (
            <Card style={{ background: '#0E2035', color: '#E2F5FF' }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: T.teal, marginBottom: 12 }}>
                Technical Details
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  lineHeight: 1.8,
                  color: 'rgba(200,230,255,0.8)',
                }}
              >
                {`{
  "@context": ["...vc/v1"],
  "type": ["VerifiableCredential"],
  "issuer": "did:ethr:0xPTA…",
  "id": "${cred.id}",
  "credentialSubject": {
    "id": "${cred.did}",
    "role": "${cred.role}"
  },
  "proof": {
    "type": "EcdsaSecp256k1",
    "jws": "eyJ…"
  }
}`}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Suspend modal */}
      {showSuspend && (
        <Modal title="Suspend Credential" onClose={() => setShowSuspend(false)}>
          <div style={{ display: 'grid', gap: 14 }}>
            <Alert
              type="warning"
              message="Suspension is temporary. The credential can be reactivated once the issue is resolved. The company will be notified."
            />
            <SelectField
              label="Suspension Reason"
              value=""
              onChange={() => {}}
              options={[
                { value: '', label: 'Select reason…' },
                { value: 'review', label: 'Annual review required' },
                { value: 'compliance', label: 'Compliance breach reported' },
                { value: 'docs', label: 'Documents expired or invalid' },
              ]}
            />
            <Input
              label="Suspension End Date (optional)"
              type="date"
              placeholder=""
              value=""
              onChange={() => {}}
            />
            <Textarea
              label="Additional Notes"
              value=""
              onChange={() => {}}
              placeholder="Internal notes…"
              rows={2}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => setShowSuspend(false)} variant="outline" style={{ flex: 1 }}>
                Cancel
              </Btn>
              <Btn
                onClick={doSuspend}
                style={{ background: T.amber, borderColor: T.amber, flex: 2 }}
              >
                Confirm Suspension
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      {/* Revoke modal */}
      {showRevoke && (
        <Modal title="Revoke Credential" onClose={() => setShowRevoke(false)}>
          <div style={{ display: 'grid', gap: 14 }}>
            <Alert
              type="error"
              message="⚠ IRREVERSIBLE: Revoking a credential permanently removes the company's access. They must reapply. This action is recorded on the blockchain."
            />
            <SelectField
              label="Revocation Reason"
              value=""
              onChange={() => {}}
              options={[
                { value: '', label: 'Select reason…' },
                { value: 'fraud', label: 'Fraudulent documents or misrepresentation' },
                { value: 'breach', label: 'Serious compliance breach' },
                { value: 'inactive', label: 'Company no longer operating' },
              ]}
            />
            <Textarea
              label="Administrator Notes"
              value=""
              onChange={() => {}}
              placeholder="Add notes for the audit record…"
              rows={2}
            />
            <label
              style={{ display: 'flex', gap: 10, cursor: 'pointer', fontSize: 13, color: T.text2 }}
            >
              <input
                type="checkbox"
                checked={revokeConfirm}
                onChange={(e) => setRevokeConfirm(e.target.checked)}
                style={{ accentColor: T.red }}
              />
              I confirm this revocation is permanent and I have the authority to take this action.
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => setShowRevoke(false)} variant="outline" style={{ flex: 1 }}>
                Cancel
              </Btn>
              <Btn
                onClick={doRevoke}
                variant="danger"
                disabled={!revokeConfirm}
                style={{ flex: 2 }}
              >
                Permanently Revoke
              </Btn>
            </div>
          </div>
        </Modal>
      )}

      <TxModal
        state={txState}
        title="Processing on blockchain…"
        message="Action confirmed."
        onClose={() => setTx(null)}
      />
    </div>
  );
}
