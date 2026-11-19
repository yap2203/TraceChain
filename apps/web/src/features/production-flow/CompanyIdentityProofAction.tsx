import { COMPANY_ALWAYS_CLAIMS, toggleCompanyDisclosure } from '@tracechain/shared';
import { reportError } from '../../components/ui/feedback';
import { useEffect, useState } from 'react';

import {
  createCompanyIdentityPresentation,
  createSelectiveCompanyIdentityPresentation,
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
import { Alert, Btn, TechnicalDetails } from '../workspaces/shared/ui';
import { PresentationSigningSettingsLink } from '../didcomm/HolderSigningKeyPanel';
import type { WorkspaceRole } from '../workspaces/workspace-navigation';

export function CompanyIdentityProofAction({
  requestId,
  role,
}: {
  requestId: string;
  role: WorkspaceRole;
}) {
  const [status, setStatus] = useState<CompanyIdentityProofStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
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
      const value = await getCompanyIdentityProofMaterial(requestId);
      setMaterial(value);
      setSelected(value.requiredClaims ?? []);
    } catch (cause) {
      setError(reportError(cause, 'Identity preview failed.'));
    } finally {
      setBusy(false);
    }
  };
  const present = async () => {
    setBusy(true);
    setError('');
    try {
      if (!material) throw new Error('Preview the requested claims before approving.');
      const holder = getActiveMessagingAgent();
      if (!holder || holder.did !== material.holderDid)
        throw new Error(
          'Restore the wallet-bound holder presentation signing-key backup before presenting identity.',
        );
      const presentation = material.sdJwt
        ? await createSelectiveCompanyIdentityPresentation(holder, material.sdJwt, {
            audience: material.audience,
            nonce: material.challenge,
            claims: selected,
          })
        : await createCompanyIdentityPresentation(holder, material);
      await sendCompanyIdentityPresentationMessage(requestId, presentation);
      setStatus(await presentCompanyIdentityProof(requestId, presentation));
    } catch (cause) {
      setError(reportError(cause, 'Identity presentation failed.'));
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
      setError(reportError(cause, 'Identity request rejection failed.'));
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
          <PresentationSigningSettingsLink role={role} />
          <div>
            <b>{material.presenterRole}</b> · {material.credentialHash}
          </div>
          <dl>
            {Object.entries(material.claims ?? material.credential?.credentialSubject ?? {}).map(
              ([name, value]) => (
                <div key={name}>
                  <dt>{name} — Always included</dt>
                  <dd>{String(value)}</dd>
                </div>
              ),
            )}
          </dl>
          <div style={{ fontSize: 12 }}>
            Purpose: {material.purpose}
            <br />
            Expires: {new Date(material.expiresAt * 1000).toLocaleString()}
          </div>
          {material.binding && (
            <TechnicalDetails
              fields={Object.entries(material.binding).map(([label, value]) => ({ label, value }))}
            />
          )}
          <div className="action-row">
            <Btn size="sm" variant="outline" disabled={busy} onClick={() => void decline()}>
              Decline
            </Btn>
            <Btn
              size="sm"
              disabled={busy || !!material.requiredClaims?.some((key) => !material.claims?.[key])}
              onClick={() => void present()}
            >
              {busy ? 'Signing…' : 'Approve and present'}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
