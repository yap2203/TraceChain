import { BrowserProvider, id } from 'ethers';
import { useState } from 'react';

import { targetChainId } from '../../../../config/chain';
import { issueCompanyRoleCredential } from '../../../auth/auth.api';
import { prepareApplicationRejection, sendPreparedTransaction } from '../../../blockchain/blockchain.api';
import { Alert, Badge, Btn, Card, Input, Modal, T, Textarea } from '../../shared/ui';
import type { ChainApplication } from './types';

export function AppDetail({ app, onBack, onChanged }: { app: ChainApplication; onBack: () => void; onChanged: () => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [expirationDate, setExpirationDate] = useState(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reject = async () => {
    if (!window.ethereum || !reason.trim()) return;
    setBusy(true); setError('');
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const prepared = await prepareApplicationRejection({ applicationId: app.id, reasonHash: id(reason.trim()) });
      if (BigInt(prepared.chainId) !== targetChainId) throw new Error('The API transaction targets a different chain.');
      const transaction = await sendPreparedTransaction(signer, prepared);
      await transaction.wait();
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Transaction failed.'); }
    finally { setBusy(false); }
  };

  const approve = async () => {
    if (!window.ethereum || !companyId.trim() || !companyName.trim() || !expirationDate) return;
    setBusy(true); setError('');
    try {
      const issued = await issueCompanyRoleCredential({
        applicationId: app.id,
        companyId: companyId.trim(),
        companyName: companyName.trim(),
        expirationDate: new Date(`${expirationDate}T23:59:59.000Z`).toISOString(),
      });
      const transactions = [
        issued.credentialRegistrationTransaction,
        issued.approvalTransaction,
      ];
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      for (const prepared of transactions) {
        if (BigInt(prepared.chainId) !== targetChainId) throw new Error('The API transaction targets a different chain.');
        const transaction = await sendPreparedTransaction(signer, prepared);
        if (!(await transaction.wait())) throw new Error('A transaction was not confirmed.');
      }
      downloadCredential(issued.credential, issued.credentialId);
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Credential issuance failed.'); }
    finally { setBusy(false); }
  };

  const rows = [
    ['Application ID', app.id], ['Applicant wallet', app.applicant], ['Requested role', app.requestedRole],
    ['Status', app.status], ['Submitted', new Date(app.submittedAt * 1000).toLocaleString()],
    ['Updated', new Date(app.updatedAt * 1000).toLocaleString()], ['Profile hash', app.profileHash],
    ['Encrypted profile reference', app.encryptedProfileCid], ['Previous application', app.previousApplicationId],
  ];

  return <div>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}><Btn onClick={onBack} variant="ghost" size="sm">Back</Btn><h2 style={{ fontSize: 18, fontWeight: 700, color: T.navy, margin: 0 }}>On-chain application</h2><Badge label={app.status} variant={app.status === 'approved' ? 'verified' : app.status === 'rejected' ? 'rejected' : 'pending'} /></div>
    <Card><div style={{ fontWeight: 700, marginBottom: 12 }}>Authoritative local-chain record</div>{rows.map(([label, value]) => <div key={label} style={{ display: 'grid', gridTemplateColumns: '190px 1fr', gap: 12, padding: '10px 0', borderBottom: `1px solid ${T.border}` }}><span style={{ color: T.text2, fontSize: 12 }}>{label}</span><code style={{ color: T.text, fontSize: 11, overflowWrap: 'anywhere' }}>{value}</code></div>)}</Card>
    <div style={{ marginTop: 14 }}><Alert type="info" message="Plaintext company information and documents are not stored on Ethereum. The encrypted content reference must be resolved through the authorized content service." /></div>
    {error && <div style={{ marginTop: 12, color: T.red, fontSize: 12 }}>{error}</div>}
    {app.status === 'pending' && <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><Btn onClick={() => setApproving(true)}>Issue credential & approve</Btn><Btn onClick={() => setRejecting(true)} variant="danger">Reject on-chain</Btn></div>}
    {approving && <Modal title="Issue Company Role Credential" onClose={() => setApproving(false)} width={500}><div style={{ display: 'grid', gap: 14 }}><Alert type="info" message={`The credential will be issued to ${app.applicant} with the requested ${app.requestedRole} role. MetaMask will request two transactions.`} /><Input label="Verified company ID" value={companyId} onChange={setCompanyId} required /><Input label="Verified company name" value={companyName} onChange={setCompanyName} required /><Input label="Credential expiration" value={expirationDate} onChange={setExpirationDate} type="date" required /><div style={{ display: 'flex', gap: 8, marginTop: 4 }}><Btn onClick={() => setApproving(false)} variant="outline">Cancel</Btn><Btn disabled={!companyId.trim() || !companyName.trim() || !expirationDate || busy} onClick={() => void approve()}>{busy ? 'Issuing & confirmingâ€¦' : 'Issue and approve'}</Btn></div></div></Modal>}
    {rejecting && <Modal title="Reject on-chain application" onClose={() => setRejecting(false)} width={440}><Textarea label="Reason" value={reason} onChange={setReason} placeholder="Reason is hashed before it is written on-chain." rows={3} /><div style={{ display: 'flex', gap: 8, marginTop: 14 }}><Btn onClick={() => setRejecting(false)} variant="outline">Cancel</Btn><Btn disabled={!reason.trim() || busy} onClick={() => void reject()} variant="danger">{busy ? 'Confirming…' : 'Confirm rejection'}</Btn></div></Modal>}
  </div>;
}

function downloadCredential(credential: Record<string, unknown>, credentialId: string) {
  const blob = new Blob([JSON.stringify(credential, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `company-role-credential-${credentialId.slice(-12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
