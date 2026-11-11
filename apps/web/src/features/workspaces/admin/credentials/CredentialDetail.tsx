import { BrowserProvider, id } from 'ethers';
import { useState } from 'react';

import { targetChainId } from '../../../../config/chain';
import {
  prepareCredentialLifecycle,
  sendPreparedTransaction,
  type ChainCredential,
} from '../../../blockchain/blockchain.api';
import { Alert, Badge, Btn, Card, Modal, MONO, T, Textarea } from '../../shared/ui';

export function CredDetail({
  cred,
  onBack,
  onChanged,
}: {
  cred: ChainCredential;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [action, setAction] = useState<'reactivate' | 'revoke' | 'suspend' | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const execute = async () => {
    if (reason.length > 4000) {
      setError('Reason must be 4000 characters or fewer.');
      return;
    }
    if (action === 'revoke' && !confirmed) {
      setError('Confirm that revocation is permanent.');
      return;
    }
    if (!action || !window.ethereum || (action !== 'reactivate' && !reason.trim())) return;
    setBusy(true);
    setError('');
    try {
      const prepared = await prepareCredentialLifecycle({
        action,
        credentialId: cred.credentialId,
        reasonHash: action === 'reactivate' ? undefined : id(reason.trim()),
      });
      if (BigInt(prepared.chainId) !== targetChainId)
        throw new Error('The API transaction targets a different chain.');
      const signer = await new BrowserProvider(window.ethereum).getSigner();
      const transaction = await sendPreparedTransaction(signer, prepared);
      if (!(await transaction.wait())) throw new Error('The transaction was not confirmed.');
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Credential action failed.');
    } finally {
      setBusy(false);
    }
  };
  const rows = [
    ['Company registration', cred.companyRegistrationNumber],
    ['Role', cred.role],
    ['Subject wallet', cred.subject],
    ['Issuer wallet', cred.issuer],
    ['Credential ID', cred.credentialId],
    ['Credential hash', cred.credentialHash],
    ['Encrypted IPFS CID', cred.encryptedCredentialCid],
    ['Application ID', cred.applicationId],
    ['Issued', new Date(cred.issuedAt * 1_000).toLocaleString()],
    ['Expires', new Date(cred.expiresAt * 1_000).toLocaleString()],
    ['Last on-chain update', new Date(cred.updatedAt * 1_000).toLocaleString()],
  ];
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
        <Btn variant="ghost" size="sm" onClick={onBack}>
          Back
        </Btn>
        <h2 style={{ margin: 0, color: T.navy }}>{cred.companyName}</h2>
        <Badge
          label={cred.status}
          variant={
            cred.status === 'active'
              ? 'active'
              : cred.status === 'suspended'
                ? 'suspended'
                : 'rejected'
          }
        />
      </div>
      {error && <Alert type="error" message={error} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 18 }}>
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Authoritative credential record</div>
          {rows.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: 'grid',
                gridTemplateColumns: '170px minmax(0,1fr)',
                gap: 12,
                borderBottom: `1px solid ${T.border}`,
                padding: '10px 0',
              }}
            >
              <span style={{ color: T.text2, fontSize: 12 }}>{label}</span>
              <code style={{ fontFamily: MONO, fontSize: 11, overflowWrap: 'anywhere' }}>
                {value}
              </code>
            </div>
          ))}
        </Card>
        <Card>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Lifecycle actions</div>
          <div style={{ display: 'grid', gap: 8 }}>
            {cred.status === 'active' && (
              <Btn
                variant="outline"
                style={{ color: T.amber }}
                onClick={() => setAction('suspend')}
              >
                Suspend credential
              </Btn>
            )}
            {cred.status === 'suspended' && (
              <Btn onClick={() => setAction('reactivate')}>Reactivate credential</Btn>
            )}
            {!['revoked', 'expired'].includes(cred.status) && (
              <Btn variant="danger" onClick={() => setAction('revoke')}>
                Permanently revoke
              </Btn>
            )}
            <Btn variant="outline" onClick={() => navigator.clipboard.writeText(cred.credentialId)}>
              Copy credential ID
            </Btn>
            <Btn variant="outline" onClick={() => downloadSummary(cred)}>
              Download safe summary
            </Btn>
          </div>
          <p style={{ color: T.text3, fontSize: 11, marginTop: 14 }}>
            Every lifecycle change requires the authorized Admin wallet and a MetaMask transaction.
            The encrypted credential is not exposed here.
          </p>
        </Card>
      </div>
      {action && (
        <Modal
          title={`${action[0].toUpperCase()}${action.slice(1)} credential`}
          onClose={() => {
            setAction(null);
            setConfirmed(false);
            setReason('');
          }}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <Alert
              type={action === 'revoke' ? 'error' : action === 'suspend' ? 'warning' : 'info'}
              message={
                action === 'revoke'
                  ? 'Revocation is permanent. This credential can never be reactivated.'
                  : action === 'suspend'
                    ? 'Suspension immediately blocks credential authorization and can later be reversed by an administrator.'
                    : 'Reactivation restores authorization only while the credential and stakeholder remain otherwise valid.'
              }
            />
            {action !== 'reactivate' && (
              <Textarea
                label="Reason"
                value={reason}
                onChange={setReason}
                rows={3}
                placeholder="The reason is hashed before being written on-chain."
              />
            )}
            {action === 'revoke' && (
              <label style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />{' '}
                I understand that revocation is permanent.
              </label>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="outline" onClick={() => setAction(null)}>
                Cancel
              </Btn>
              <Btn
                variant={action === 'revoke' ? 'danger' : 'primary'}
                disabled={
                  busy ||
                  (action !== 'reactivate' && !reason.trim()) ||
                  (action === 'revoke' && !confirmed)
                }
                onClick={() => void execute()}
              >
                {busy ? 'Waiting for confirmation...' : `Confirm ${action}`}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function downloadSummary(credential: ChainCredential) {
  const { encryptedCredentialCid: _cid, ...safe } = credential;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `credential-summary-${credential.credentialId.slice(-12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
