import { useEffect, useState } from 'react';

import {
  createCompanyIdentityPresentation,
  getActiveMessagingAgent,
} from '../didcomm/didcomm-agent';
import {
  getCompanyIdentityProofMaterial,
  getCompanyIdentityProofStatus,
  declineCompanyIdentityProof,
  presentCompanyIdentityProof,
  type CompanyIdentityProofStatus,
  type CompanyIdentityProofMaterial,
} from './production-flow.api';
import {
  sendCompanyIdentityDeclineMessage,
  sendCompanyIdentityPresentationMessage,
} from './evidence-didcomm';
import { Alert, Btn } from '../workspaces/shared/ui';
import { HolderSigningKeyPanel } from '../didcomm/HolderSigningKeyPanel';

export function CompanyIdentityProofAction({ requestId }: { requestId: string }) {
  const [status, setStatus] = useState<CompanyIdentityProofStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [material, setMaterial] = useState<CompanyIdentityProofMaterial>();
  useEffect(() => {
    void getCompanyIdentityProofStatus(requestId)
      .then(setStatus)
      .catch(() => undefined);
  }, [requestId]);
  if (!status || status.status === 'NOT_REQUESTED') return null;
  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      setMaterial(await getCompanyIdentityProofMaterial(requestId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity preview failed.');
    } finally {
      setBusy(false);
    }
  };
  const present = async () => {
    setBusy(true);
    setError('');
    try {
      const material = await getCompanyIdentityProofMaterial(requestId);
      const holder = getActiveMessagingAgent();
      if (!holder || holder.did !== material.holderDid)
        throw new Error(
          'Restore the wallet-bound holder presentation signing-key backup before presenting identity.',
        );
      const presentation = await createCompanyIdentityPresentation(holder, material);
      await sendCompanyIdentityPresentationMessage(requestId, presentation);
      setStatus(await presentCompanyIdentityProof(requestId, presentation));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity presentation failed.');
    } finally {
      setBusy(false);
    }
  };
  const decline = async () => {
    setBusy(true);
    setError('');
    try {
      await sendCompanyIdentityDeclineMessage(requestId);
      setStatus(await declineCompanyIdentityProof(requestId));
      setMaterial(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity request rejection failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Alert
        type={status.status === 'VERIFIED' ? 'success' : 'info'}
        message={`Company identity proof: ${status.status}. This remains separate from ingredient-evidence authorization.`}
      />
      {error && <Alert type="error" message={error} />}
      {status.status === 'REQUESTED' && !material && (
        <Btn size="sm" disabled={busy} onClick={() => void preview()}>
          {busy ? 'Loading…' : 'Preview Company Role presentation'}
        </Btn>
      )}
      {material && status.status === 'REQUESTED' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <HolderSigningKeyPanel expectedDid={material.holderDid} />
          <div>
            <b>{material.presenterRole}</b> · {material.credentialHash}
          </div>
          <div style={{ fontSize: 12 }}>
            Purpose: {material.purpose}
            <br />
            Expires: {new Date(material.expiresAt * 1000).toLocaleString()}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" disabled={busy} onClick={() => void present()}>
              {busy ? 'Signing…' : 'Approve and present'}
            </Btn>
            <Btn size="sm" variant="outline" disabled={busy} onClick={() => void decline()}>
              Decline
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
