import { signCompanyPresentation } from './company-presentation';
import { submitProductionTransaction } from './production-flow.transaction';
import { COMPANY_ALWAYS_CLAIMS, toggleCompanyDisclosure } from '@tracechain/shared';
import { reportError } from '../../components/ui/feedback';
import { useEffect, useState } from 'react';

import {
  getCompanyIdentityProofMaterial,
  getCompanyIdentityProofStatus,
  declineCompanyIdentityProof,
  presentCompanyIdentityProof,
  type CompanyIdentityProofStatus,
  type CompanyIdentityProofMaterial,
} from './production-flow.api';
import { Alert, Btn, TechnicalDetails } from '../workspaces/shared/ui';
import { PresentationSigningSettingsLink } from '../didcomm/HolderSigningKeyPanel';
import { EvidenceFieldList, EvidenceHowItWorks, EvidenceNextStep } from '../orders/EvidenceParts';
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
      const presentation = await signCompanyPresentation(material, selected);
      const result = await presentCompanyIdentityProof(requestId, presentation);
      if (result.transaction && result.actorWallet)
        await submitProductionTransaction(result.transaction, result.actorWallet);
      setStatus(await getCompanyIdentityProofStatus(requestId));
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
      const result = await declineCompanyIdentityProof(requestId);
      if (result.transaction && result.actorWallet)
        await submitProductionTransaction(result.transaction, result.actorWallet);
      setStatus(await getCompanyIdentityProofStatus(requestId));
      setMaterial(undefined);
    } catch (cause) {
      setError(reportError(cause, 'Identity request rejection failed.'));
    } finally {
      setBusy(false);
    }
  };
  const values = (material?.claims ?? material?.credential?.credentialSubject ?? {}) as Record<
    string,
    unknown
  >;
  const required = [
    ...new Set([...(material?.requiredClaims ?? []), ...COMPANY_ALWAYS_CLAIMS]),
  ].filter((claim) => claim in values);
  const missingRequired = !!material?.requiredClaims?.some((key) => !material.claims?.[key]);
  const pending = status.status === 'REQUESTED';
  return (
    <div className="evidence-panel">
      {error && <Alert type="error" message={error} />}
      {!material && (
        <EvidenceNextStep
          tone={
            status.status === 'VERIFIED' || status.status === 'PRESENTED'
              ? 'done'
              : pending
                ? 'default'
                : 'closed'
          }
          message={
            pending
              ? 'Choose which details to share, then sign with MetaMask.'
              : status.status === 'PRESENTED'
                ? 'Shared. Waiting for the requesting company to verify.'
                : status.status === 'VERIFIED'
                  ? 'Accepted. Nothing else to do.'
                  : 'This request has closed. No action is possible.'
          }
          action={
            pending && (
              <Btn disabled={busy} onClick={() => void preview()}>
                {busy ? 'Loading…' : 'Review request'}
              </Btn>
            )
          }
        />
      )}
      {material && pending && (
        <>
          <p className="evidence-panel__facts">
            <span>
              Purpose <strong>{material.purpose}</strong>
            </span>
            <span>
              Valid until <strong>{new Date(material.expiresAt * 1000).toLocaleString()}</strong>
            </span>
          </p>
          <EvidenceFieldList
            values={values}
            required={required}
            selected={selected}
            selectable
            onToggle={(claim) =>
              setSelected(toggleCompanyDisclosure(selected, claim, !selected.includes(claim)))
            }
          />
          {!material.walletContext && <PresentationSigningSettingsLink role={role} />}
          {missingRequired && (
            <Alert
              type="error"
              message="A required field is missing from your company credential. Ask the administrator for a replacement credential, or decline this request."
            />
          )}
          <div className="company-evidence-card__footer">
            <Btn variant="outline" disabled={busy} onClick={() => void decline()}>
              Decline
            </Btn>
            <Btn disabled={busy || missingRequired} onClick={() => void present()}>
              {busy ? 'Signing…' : 'Sign and share'}
            </Btn>
          </div>
          <EvidenceHowItWorks>
            <p>
              MetaMask asks for one signature to approve the selected fields, then one transaction
              that records the encrypted response.
              {material.bindingTransaction
                ? ' The first time, it also records your wallet’s link to the company credential.'
                : ''}{' '}
              Sharing does not approve any order or move stock.
            </p>
          </EvidenceHowItWorks>
          {material.binding && (
            <TechnicalDetails
              fields={[
                ...(material.credentialHash
                  ? [{ label: 'Credential hash', value: material.credentialHash }]
                  : []),
                ...Object.entries(material.binding).map(([label, value]) => ({ label, value })),
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
