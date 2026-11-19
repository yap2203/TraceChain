import {
  INGREDIENT_ALWAYS_CLAIMS,
  expandIngredientRequestedClaims,
  toggleIngredientDisclosure,
  ingredientDisclosureErrors,
} from '@tracechain/shared';
import { ingredientClaimLabel } from '@tracechain/shared';
import { IngredientClaimValue } from '../../../production-flow/IngredientClaimValue';
import { getCertificationDocument } from '../batches/ingredient-batch.api';
import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { reportError } from '../../../../components/ui/feedback';
import { useEffect, useState } from 'react';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';

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
  type CompanyIdentityProofStatus,
  type EvidenceDetails,
  type ProductionEvidenceRequest,
} from '../../../production-flow/production-flow.api';
import { sendEvidencePresentationMessage } from '../../../production-flow/evidence-didcomm';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { Alert, Badge, Btn, Card, T, TechnicalDetails } from '../../shared/ui';
import { chainDate } from '../../shared/operational-format';
import { textError } from '../../../validation/form-validation';
import { PresentationSigningSettingsLink } from '../../../didcomm/HolderSigningKeyPanel';

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
  const [previewCredential, setPreviewCredential] = useState('');
  const [previewExpiresAt, setPreviewExpiresAt] = useState<number>();
  const [identityProof, setIdentityProof] = useState<CompanyIdentityProofStatus>();
  const [holderDid, setHolderDid] = useState('');
  useEffect(() => {
    setPreview(undefined);
    setPreviewCredential('');
    setPreviewExpiresAt(undefined);
    setApproved(false);
    setOptionalClaims([]);
    void getEvidenceDetails(request.requestId)
      .then(setDetails)
      .catch((cause) => setError(reportError(cause, 'Could not load the private request.')));
  }, [request.requestId]);
  useEffect(() => {
    void getCompanyIdentityProofStatus(request.requestId)
      .then(setIdentityProof)
      .catch(() => undefined);
  }, [request.requestId]);
  const respond = async () => {
    setBusy(true);
    setError('');
    try {
      if (details?.credentialFormat === 'JWT_VC') {
        if (!preview)
          throw new Error('Preview all legacy credential claims before approving full disclosure.');
        await completePreparedWorkflow(() => prepareEvidenceResponse(request.requestId));
        await sendEvidencePresentationMessage(await getEvidenceDetails(request.requestId));
        onBack();
        return;
      }
      const signing = await prepareEvidenceResponse(request.requestId);
      if (!preview || signing.holderSigning?.credential !== previewCredential)
        throw new Error(
          'Preview the actual current credential values before approving this presentation.',
        );
      if (signing.state !== 'HOLDER_SIGNATURE_REQUIRED' || !signing.holderSigning)
        throw new Error('The API did not return holder-controlled signing material.');
      setHolderDid(signing.holderSigning.holderDid);
      const holder = getActiveMessagingAgent();
      if (!holder)
        throw new Error('Restore the holder presentation signing key before responding.');
      if (holder.did !== signing.holderSigning.holderDid)
        throw new Error(
          'The active presentation key is not bound to this credential. Restore the correct signing-key backup.',
        );
      const required = signing.holderSigning.requiredClaims;
      const selected = [
        ...new Set([
          ...required.filter(
            (claim) =>
              ![
                'certifications',
                'certificationDocuments',
                'qualityTests',
                'qualityDocuments',
              ].includes(claim),
          ),
          ...optionalClaims,
        ]),
      ];
      if (selected.includes('productionDate') && preview?.productionDateMeaning)
        selected.push('productionDateMeaning');
      if (
        required.includes('certifications') &&
        !selected.some((key) => key.startsWith('certification_'))
      )
        throw new Error('Select at least one complete certification entry.');
      if (
        required.includes('certificationDocuments') &&
        !selected.some((key) => key.startsWith('certificationDocuments_'))
      )
        throw new Error('Select at least one certification document and its entry.');
      if (details?.policy) {
        const disclosed = Object.fromEntries(
          Object.entries(preview ?? {}).filter(
            ([key]) =>
              selected.includes(key) ||
              key === 'policyVersion' ||
              (INGREDIENT_ALWAYS_CLAIMS as readonly string[]).includes(key),
          ),
        );
        const failures = ingredientDisclosureErrors(
          disclosed,
          details.policy,
          required,
          String(preview?.batchReference ?? ''),
        );
        if (failures.length) throw new Error(failures[0]);
      }
      const presentation = await createSelectiveIngredientPresentation(
        holder,
        signing.holderSigning.credential,
        {
          audience: signing.holderSigning.audience,
          claims: selected,
          nonce: signing.holderSigning.nonce,
          context: signing.holderSigning.context
            ? {
                ...signing.holderSigning.context,
                expiresAt: Math.min(
                  previewExpiresAt ?? signing.holderSigning.context.expiresAt,
                  signing.holderSigning.context.expiresAt,
                ),
              }
            : undefined,
        },
      );
      await completePreparedWorkflow(() =>
        prepareEvidenceResponse(request.requestId, presentation),
      );
      await sendEvidencePresentationMessage(await getEvidenceDetails(request.requestId));
      onBack();
    } catch (cause) {
      setError(reportError(cause, 'The evidence response failed.'));
    } finally {
      setBusy(false);
    }
  };
  const loadPreview = async () => {
    setBusy(true);
    setError('');
    try {
      if (details?.credentialFormat === 'JWT_VC') {
        setPreview(details.legacyClaims ?? {});
        return;
      }
      const signing = await prepareEvidenceResponse(request.requestId);
      if (signing.state !== 'HOLDER_SIGNATURE_REQUIRED' || !signing.holderSigning)
        throw new Error('Selective-disclosure signing material is unavailable.');
      setHolderDid(signing.holderSigning.holderDid);
      setPreviewCredential(signing.holderSigning.credential);
      setPreviewExpiresAt(signing.holderSigning.context?.expiresAt);
      setPreview(await readSelectiveIngredientClaims(signing.holderSigning.credential));
    } catch (cause) {
      setError(reportError(cause, 'Could not preview the credential claims.'));
    } finally {
      setBusy(false);
    }
  };
  const decline = async () => {
    const invalid = textError(declineReason, 'Decline reason', 500);
    if (invalid) {
      setError(invalid);
      return;
    }
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
      setError(reportError(cause, 'The decline transaction failed.'));
    } finally {
      setBusy(false);
    }
  };
  if (!details && !error) return <LoadingIndicator page label="Loading evidence request…" />;
  return (
    <div style={{ maxWidth: 720 }}>
      <BackNavigation onClick={onBack}>Back</BackNavigation>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0, color: T.navy }}>Respond to Evidence Request</h2>
        <Badge label="Awaiting response" variant="pending" />
      </div>
      {error && <Alert type="error" message={error} />}
      <Card>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <b>Requesting company</b> ·{' '}
            {request.requesterName ?? request.manufacturerName ?? 'Company name unavailable'}
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
            message={
              details?.credentialFormat === 'JWT_VC'
                ? 'Legacy full disclosure: this issuer-signed presentation shares the complete Ingredient Credential, including all its fields and document references. This legacy format cannot selectively hide claims.'
                : 'Only the always-disclosed identity claims, required claims and optional claims you select below will be included. Other SD-JWT claims remain hidden.'
            }
          />
          {details?.requiredClaims.length ? (
            <p>
              <strong>Required by this request:</strong>{' '}
              {details.requiredClaims.map(ingredientClaimLabel).join(', ')}. Missing requirements
              block verification and acceptance; you may decline.
            </p>
          ) : null}
          <Alert
            type="info"
            message={
              details?.credentialFormat === 'JWT_VC'
                ? 'Legacy presentations use the existing issuer-signing flow. The entire credential is shared; this is not selective disclosure.'
                : 'Your browser creates the key-bound presentation with the participant-controlled key. The API never receives that private key and stores only the resulting presentation.'
            }
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href={
                '/supplier/information-requests/sent?context=ingredient&referenceId=' +
                encodeURIComponent(request.requestId)
              }
            >
              Manage Company Identity Proof in Information requests
            </a>
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
                    <div>
                      Issuer:{' '}
                      {identityProof.credential.issuerName ?? identityProof.credential.issuer}
                    </div>
                    <div>Credential status: {identityProof.credential.credentialStatus}</div>
                    <div>
                      Expires:{' '}
                      {chainDate(Date.parse(identityProof.credential.expirationDate) / 1000)}
                    </div>
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
          {holderDid && <PresentationSigningSettingsLink role="supplier" />}
          {previewExpiresAt && (
            <p>
              Presentation expires: {chainDate(previewExpiresAt)}. Verify it before this time; the
              request deadline and credential expiry are separate.
            </p>
          )}
          {details?.credentialFormat === 'JWT_VC' &&
            preview &&
            Object.entries(preview).map(([name, value]) => (
              <IngredientClaimValue
                key={name}
                name={name}
                value={value}
                loadDocument={(documentId) => getCertificationDocument(details.batchId, documentId)}
              />
            ))}
          {preview && details?.credentialFormat !== 'JWT_VC' && (
            <section>
              <h3>Always included</h3>
              {INGREDIENT_ALWAYS_CLAIMS.filter((key) => preview[key] !== undefined).map((key) => (
                <IngredientClaimValue key={key} name={key} value={preview[key]} />
              ))}
            </section>
          )}
          {details?.credentialFormat !== 'JWT_VC' &&
            expandIngredientRequestedClaims(details?.claims ?? [], preview ?? {})
              .filter((claim) => claim !== 'productionDateMeaning')
              .map((claim) => {
                const required = details?.requiredClaims.includes(claim) ?? false;
                return (
                  <div key={claim}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
                      <input
                        type="checkbox"
                        checked={required || optionalClaims.includes(claim)}
                        disabled={required || busy}
                        onChange={(event) =>
                          setOptionalClaims((current) =>
                            toggleIngredientDisclosure(
                              current,
                              claim,
                              event.target.checked,
                              preview ?? {},
                            ),
                          )
                        }
                      />
                      <span>
                        <b>
                          {claim.startsWith('certificationDocuments_')
                            ? `Supporting document: ${((preview?.[claim] as { documents?: { fileName: string }[] })?.documents ?? []).map((file) => file.fileName).join(', ')}`
                            : claim.startsWith('certification_')
                              ? `Supplier-provided certification: ${(preview?.[claim] as { name?: string })?.name ?? 'Unavailable'} ? ${(preview?.[claim] as { reference?: string })?.reference ?? 'Unavailable'}`
                              : ingredientClaimLabel(claim)}
                        </b>{' '}
                        · {required ? 'Required by this request' : 'Optional'}
                      </span>
                    </label>
                    {preview && (
                      <IngredientClaimValue
                        name={claim}
                        value={preview[claim]}
                        loadDocument={(documentId) =>
                          getCertificationDocument(
                            details?.batchId ?? request.ingredientBatchId,
                            documentId,
                          )
                        }
                      />
                    )}
                    {claim === 'productionDate' && Boolean(preview?.productionDateMeaning) && (
                      <p>
                        Date meaning shared with this date: {String(preview?.productionDateMeaning)}
                        .
                      </p>
                    )}
                  </div>
                );
              })}
          {(details?.claims.includes('certifications') ||
            details?.claims.includes('certificationDocuments')) && (
            <p>
              Preview the available entries, select the certifications to share, and separately
              select any documents. Required certification requests need at least one complete
              entry. Selecting a document also shares its certification scope and provenance.
            </p>
          )}
          {preview && details?.credentialFormat !== 'JWT_VC' && (
            <details>
              <summary>Available information remaining undisclosed</summary>
              <ul>
                {Object.keys(preview)
                  .filter(
                    (key) =>
                      ![
                        'iss',
                        'vct',
                        'cnf',
                        'exp',
                        'iat',
                        'sub',
                        'credentialId',
                        'policyVersion',
                        ...INGREDIENT_ALWAYS_CLAIMS,
                      ].includes(key) &&
                      !optionalClaims.includes(key) &&
                      !(
                        key === 'productionDateMeaning' &&
                        (optionalClaims.includes('productionDate') ||
                          details?.requiredClaims.includes('productionDate'))
                      ) &&
                      !details?.requiredClaims.includes(key),
                  )
                  .map((key) => (
                    <li key={key}>{ingredientClaimLabel(key)}</li>
                  ))}
              </ul>
            </details>
          )}
          <label style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
            />{' '}
            {details?.credentialFormat === 'JWT_VC'
              ? 'I reviewed and authorize full disclosure of all displayed credential claims and document references to this exact recipient.'
              : 'I reviewed this disclosure and authorize sharing only these selected claims for this exact request and recipient.'}
          </label>
          <Btn disabled={busy || !approved || !details} onClick={() => void respond()}>
            {busy
              ? 'Signing and confirming...'
              : details?.credentialFormat === 'JWT_VC'
                ? 'Share full legacy credential and confirm'
                : 'Sign selective presentation and confirm'}
          </Btn>
          <input
            aria-label="Decline reason"
            maxLength={500}
            placeholder="Reason for declining"
            value={declineReason}
            onChange={(event) => setDeclineReason(event.target.value)}
          />
          <div className="action-row">
            <Btn
              variant="ghost"
              disabled={busy || !declineReason.trim()}
              onClick={() => void decline()}
            >
              Decline request
            </Btn>
          </div>
          <TechnicalDetails
            fields={[
              { label: 'Request ID', value: request.requestId },
              { label: 'Requesting company wallet', value: request.requester },
              { label: 'Ingredient batch ID', value: request.ingredientBatchId },
              ...(preview
                ? [
                    { label: 'Issuer DID', value: String(preview.iss ?? 'Unavailable') },
                    {
                      label: 'Credential reference',
                      value: String(preview.credentialId ?? 'Unavailable'),
                    },
                    {
                      label: 'Credential expiry',
                      value:
                        typeof preview.exp === 'number' ? chainDate(preview.exp) : 'Unavailable',
                    },
                    { label: 'Holder signing DID', value: holderDid || 'Unavailable' },
                  ]
                : []),
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
