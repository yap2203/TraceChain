import { BrowserProvider, id } from 'ethers';
import { useState } from 'react';

import { stakeholderRegistry } from '../../../../config/contracts';
import { Alert, Badge, Btn, Card, Modal, T, Textarea } from '../../shared/ui';
import type { ChainApplication } from './types';

export function AppDetail({ app, onBack, onChanged }: { app: ChainApplication; onBack: () => void; onChanged: () => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reject = async () => {
    if (!window.ethereum || !reason.trim()) return;
    setBusy(true); setError('');
    try {
      const signer = await new BrowserProvider(window.ethereum).getSigner();
      const transaction = await stakeholderRegistry(signer).rejectApplication(app.id, id(reason.trim()));
      await transaction.wait();
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Transaction failed.'); }
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
    {app.status === 'pending' && <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><Btn disabled>Approve unavailable until SSI issuance is connected</Btn><Btn onClick={() => setRejecting(true)} variant="danger">Reject on-chain</Btn></div>}
    {rejecting && <Modal title="Reject on-chain application" onClose={() => setRejecting(false)} width={440}><Textarea label="Reason" value={reason} onChange={setReason} placeholder="Reason is hashed before it is written on-chain." rows={3} /><div style={{ display: 'flex', gap: 8, marginTop: 14 }}><Btn onClick={() => setRejecting(false)} variant="outline">Cancel</Btn><Btn disabled={!reason.trim() || busy} onClick={() => void reject()} variant="danger">{busy ? 'Confirming…' : 'Confirm rejection'}</Btn></div></Modal>}
  </div>;
}
