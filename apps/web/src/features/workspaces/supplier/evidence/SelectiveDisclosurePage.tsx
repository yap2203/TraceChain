import { useEffect, useState } from 'react';

import {
  createSelectiveIngredientPresentation,
  getActiveMessagingAgent,
  readSelectiveIngredientClaims,
} from '../../../didcomm/didcomm-agent';

import {
  getEvidenceDetails,
  getCompanyIdentityProofStatus,
  prepareEvidenceClose,
  prepareEvidenceResponse,
  requestCompanyIdentityProof,
  verifyCompanyIdentityProof,
  type CompanyIdentityProofStatus,
  type EvidenceDetails,
  type ProductionEvidenceRequest,
} from '../../../production-flow/production-flow.api';
import {
  sendCompanyIdentityRequestMessage,
  sendEvidencePresentationMessage,
} from '../../../production-flow/evidence-didcomm';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { Alert, Badge, Btn, Card, T, TechnicalDetails } from '../../shared/ui';
import { chainDate } from '../../shared/operational-format';

export function SelectiveDisclosure({
  request,
  onBack,
}: {
  request: ProductionEvidenceRequest;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState<EvidenceDetails>();
  const [approved, setApproved] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [optionalClaims, setOptionalClaims] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown>>();
  const [identityProof, setIdentityProof] = useState<CompanyIdentityProofStatus>();
  useEffect(() => {
    void getEvidenceDetails(request.requestId)
      .then(setDetails)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : 'Could not load the private request.'),
      );
  }, [request.requestId]);
  useEffect(() => {
    void getCompanyIdentityProofStatus(request.requestId)
      .then(setIdentityProof)
      .catch(() => undefined);
  }, [request.requestId]);
  const requestIdentity = async () => {
    setBusy(true);
    setError('');
    try {
      setIdentityProof(await requestCompanyIdentityProof(request.requestId));
      await sendCompanyIdentityRequestMessage(await getEvidenceDetails(request.requestId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity-proof request failed.');
    } finally {
      setBusy(false);
    }
  };
  const verifyIdentity = async () => {
    setBusy(true);
    setError('');
    try {
      setIdentityProof(await verifyCompanyIdentityProof(request.requestId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity proof did not verify.');
    } finally {
      setBusy(false);
    }
  };
  const respond = async () => {
    setBusy(true);
    setError('');
    try {
      const signing = await prepareEvidenceResponse(request.requestId);
      if (signing.state !== 'HOLDER_SIGNATURE_REQUIRED' || !signing.holderSigning)
        throw new Error('The API did not return holder-controlled signing material.');
      const holder = getActiveMessagingAgent();
      if (!holder)
        throw new Error('Create or restore your participant messaging key before responding.');
      if (holder.did !== signing.holderSigning.holderDid)
        throw new Error(
          'The active participant key is not the key bound to this credential. Restore the correct recovery kit.',
        );
      const selected = [...new Set([...signing.holderSigning.requiredClaims, ...optionalClaims])];
      const presentation = await createSelectiveIngredientPresentation(
        holder,
        signing.holderSigning.credential,
        {
          audience: signing.holderSigning.audience,
          claims: selected,
          nonce: signing.holderSigning.nonce,
        },
      );
      await completePreparedWorkflow(() =>
        prepareEvidenceResponse(request.requestId, presentation),
      );
      await sendEvidencePresentationMessage(await getEvidenceDetails(request.requestId));
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The evidence response failed.');
    } finally {
      setBusy(false);
    }
  };
  const loadPreview = async () => {
    setBusy(true);
    setError('');
    try {
      const signing = await prepareEvidenceResponse(request.requestId);
      if (signing.state !== 'HOLDER_SIGNATURE_REQUIRED' || !signing.holderSigning)
        throw new Error('Selective-disclosure signing material is unavailable.');
      setPreview(await readSelectiveIngredientClaims(signing.holderSigning.credential));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not preview the credential claims.');
    } finally {
      setBusy(false);
    }
  };
  const decline = async () => {
    setBusy(true);
    setError('');
    try {
      await completePreparedWorkflow(() =>
        prepareEvidenceClose(request.requestId, {
          reason: declineReason,
          status: 'DECLINED',
        }),
      );
      onBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The decline transaction failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Btn variant="ghost" size="sm" onClick={onBack}>
          Back
        </Btn>
        <h2 style={{ margin: 0, color: T.navy }}>Respond to Evidence Request</h2>
        <Badge label="Awaiting response" variant="pending" />
      </div>
      {error && <Alert type="error" message={error} />}
      <Card>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <b>Manufacturer</b> · {request.manufacturerName ?? 'Verified Manufacturer'}
          </div>
          <div>
            <b>Deadline</b> · {chainDate(request.dueAt)}
          </div>
          <div>
            <b>Ingredient batch</b> · {details?.batchId ?? request.ingredientBatchId}
          </div>
          <div>
            <b>Purpose</b> · {details?.reason ?? 'Loading…'}
          </div>
          <div>
            <b>Requested information</b> · {details?.claims.join(', ') || 'Loading…'}
          </div>
          <Alert
            type="warning"
            message="Only the always-disclosed identity claims, required claims, and optional claims you select below will be included. Other SD-JWT claims remain hidden."
          />
          <Alert
            type="info"
            message="Your browser creates the key-bound presentation with the participant-controlled key. The API never receives that private key and stores only the resulting presentation."
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn variant="outline" disabled={busy} onClick={() => void requestIdentity()}>
              Request Company Identity Proof
            </Btn>
            {identityProof?.status === 'PRESENTED' && (
              <Btn variant="outline" disabled={busy} onClick={() => void verifyIdentity()}>
                Verify Company Identity Proof
              </Btn>
            )}
          </div>
          {identityProof && (
            <div style={{ display: 'grid', gap: 8 }}>
              <Alert
                type={identityProof.status === 'VERIFIED' ? 'success' : 'info'}
                message={`Requester identity proof: ${identityProof.status}. A valid identity proof does not automatically authorize ingredient disclosure.`}
              />
              {identityProof.credential && (
                <Card>
                  <b>Verified requester Company Role Credential</b>
                  <div style={{ display: 'grid', gap: 4, marginTop: 8, fontSize: 13 }}>
                    <div>Company: {identityProof.credential.subject.companyName}</div>
                    <div>Role: {identityProof.credential.subject.role}</div>
                    <div>Wallet: {identityProof.credential.subject.walletAddress}</div>
                    <div>Issuer: {identityProof.credential.issuerName ?? identityProof.credential.issuer}</div>
                    <div>Credential status: {identityProof.credential.credentialStatus}</div>
                    <div>Expires: {chainDate(Date.parse(identityProof.credential.expirationDate) / 1000)}</div>
                  </div>
                  {identityProof.checks && (
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      Checks passed: {identityProof.checks.join(', ')}
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}
          <Btn variant="outline" disabled={busy || !details} onClick={() => void loadPreview()}>
            Preview available claim values
          </Btn>
          {details?.claims.map((claim) => {
            const required = details.requiredClaims.includes(claim);
            return (
              <label key={claim} style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
                <input
                  type="checkbox"
                  checked={required || optionalClaims.includes(claim)}
                  disabled={required || busy}
                  onChange={(event) =>
                    setOptionalClaims((current) =>
                      event.target.checked
                        ? [...new Set([...current, claim])]
                        : current.filter((item) => item !== claim),
                    )
                  }
                />
                <span>
                  <b>{claim}</b> · {required ? 'Required by Manufacturer' : 'Optional'}
                  {preview && (
                    <span style={{ display: 'block', color: T.text2, overflowWrap: 'anywhere' }}>
                      {preview[claim] === undefined
                        ? 'Unavailable in this credential'
                        : Array.isArray(preview[claim])
                          ? preview[claim].join(', ')
                          : String(preview[claim])}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
          <label style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />{' '}
            I reviewed this disclosure and authorize sharing only these selected claims for this
            exact request and recipient.
          </label>
          <Btn disabled={busy || !approved || !details} onClick={() => void respond()}>
            {busy ? 'Signing and confirming…' : 'Sign selective presentation and confirm'}
          </Btn>
          <input
            aria-label="Decline reason"
            placeholder="Reason for declining"
            value={declineReason}
            onChange={(event) => setDeclineReason(event.target.value)}
          />
          <Btn
            variant="ghost"
            disabled={busy || !declineReason.trim()}
            onClick={() => void decline()}
          >
            Decline request
          </Btn>
          <TechnicalDetails
            fields={[
              { label: 'Request ID', value: request.requestId },
              { label: 'Manufacturer wallet', value: request.requester },
              { label: 'Ingredient batch ID', value: request.ingredientBatchId },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
