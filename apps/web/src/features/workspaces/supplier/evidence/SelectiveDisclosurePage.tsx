import { BackNavigation } from '../../../../components/ui/BackNavigation';
import { ClipboardList, Leaf } from 'lucide-react';
import {
  EvidenceOutcome,
  EvidenceSummaryCard,
  RequestSummary,
  evidenceDateFields,
} from '../../../orders/EvidenceIdentity';
import {
  createWalletPresentation,
  createFullWalletPresentation,
} from '../../../production-flow/wallet-presentation';
import {
  INGREDIENT_ALWAYS_CLAIMS,
  expandIngredientRequestedClaims,
  toggleIngredientDisclosure,
  ingredientDisclosureErrors,
  isRetiredIngredientClaim,
  visibleIngredientClaims,
} from '@tracechain/shared';
import { ingredientClaimLabel } from '@tracechain/shared';
import { IngredientClaimValue } from '../../../production-flow/IngredientClaimValue';
import {
  getCertificationDocument,
  getIngredientBatches,
  type RegisteredIngredientBatch,
} from '../batches/ingredient-batch.api';
import { reportError } from '../../../../components/ui/feedback';
import {
  EvidenceDetailLayout,
  EvidenceHowItWorks,
  ingredientEvidenceStatus,
} from '../../../orders/EvidenceParts';
import { proofStatusLabel, proofStatusVariant } from '../../../orders/DeliveryIdentityPanel';
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
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { Alert, Badge, Btn, Input, TechnicalDetails } from '../../shared/ui';
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
  const [declining, setDeclining] = useState(false);
  const [batchInfo, setBatchInfo] = useState<RegisteredIngredientBatch>();
  useEffect(() => {
    // Display only: name the batch instead of showing its on-chain ID.
    void getIngredientBatches()
      .then(({ batches }) =>
        setBatchInfo(
          batches.find(
            (batch) => batch.batchId.toLowerCase() === request.ingredientBatchId.toLowerCase(),
          ),
        ),
      )
      .catch(() => undefined);
  }, [request.ingredientBatchId]);
  const visibleRequestedClaims = (details?.claims ?? []).filter(
    (claim) => !isRetiredIngredientClaim(claim),
  );
  const visibleRequiredClaims = (details?.requiredClaims ?? []).filter(
    (claim) => !isRetiredIngredientClaim(claim),
  );
  const hasRetiredRequiredClaim = (details?.requiredClaims ?? []).some(isRetiredIngredientClaim);
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
        const signing = await prepareEvidenceResponse(request.requestId);
        if (signing.holderSigning?.walletContext) {
          const presentation = await createFullWalletPresentation(
            signing.holderSigning.credential,
            signing.holderSigning.walletContext,
          );
          await completePreparedWorkflow(() =>
            prepareEvidenceResponse(request.requestId, presentation),
          );
        } else await completePreparedWorkflow(() => prepareEvidenceResponse(request.requestId));
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
      const walletContext = signing.holderSigning.walletContext;
      const walletBound = preview?.vct === 'urn:tracechain:credential:ingredient:sd-jwt:v3';
      const holder = walletBound ? undefined : getActiveMessagingAgent();
      if (!walletBound && !holder)
        throw new Error('Restore the holder presentation signing key before responding.');
      if (!walletBound && holder!.did !== signing.holderSigning.holderDid)
        throw new Error(
          'The active presentation key is not bound to this credential. Restore the correct signing-key backup.',
        );
      // The holder decides; withheld required fields are reported to the requester, not blocked.
      const selected = [...new Set(optionalClaims)];
      const presentation = walletBound
        ? await createWalletPresentation(signing.holderSigning.credential, selected, walletContext!)
        : await createSelectiveIngredientPresentation(holder!, signing.holderSigning.credential, {
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
          });
      await completePreparedWorkflow(() =>
        prepareEvidenceResponse(request.requestId, presentation),
      );
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
        setPreview(visibleIngredientClaims(details.legacyClaims ?? {}));
        return;
      }
      const signing = await prepareEvidenceResponse(request.requestId);
      if (signing.state !== 'HOLDER_SIGNATURE_REQUIRED' || !signing.holderSigning)
        throw new Error('Selective-disclosure signing material is unavailable.');
      setHolderDid(signing.holderSigning.holderDid);
      setPreviewCredential(signing.holderSigning.credential);
      setPreviewExpiresAt(signing.holderSigning.context?.expiresAt);
      const claims = visibleIngredientClaims(
        await readSelectiveIngredientClaims(signing.holderSigning.credential),
      );
      setPreview(claims);
      // Required fields start selected; the holder can still untick any of them.
      setOptionalClaims(
        signing.holderSigning.requiredClaims.filter(
          (claim) => claim in claims && !isRetiredIngredientClaim(claim),
        ),
      );
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
  const legacy = details?.credentialFormat === 'JWT_VC';
  const requester = request.requesterName ?? request.manufacturerName ?? 'The requesting company';
  const ingredient = batchInfo?.ingredientName ?? (preview?.ingredientName as string | undefined);
  const batchReference =
    batchInfo?.batchReference ?? (preview?.batchReference as string | undefined);
  const requestedRows =
    !legacy && preview
      ? expandIngredientRequestedClaims(visibleRequestedClaims, preview).filter(
          (claim) => !isRetiredIngredientClaim(claim),
        )
      : [];
  const unmet =
    !legacy && preview && details ? disclosureGaps(details, preview, optionalClaims) : [];
  const status = ingredientEvidenceStatus(request.status, request.dueAt);
  const open = request.status === 1 && request.dueAt * 1000 > Date.now();
  const requesterRole = request.requesterRole
    ? request.requesterRole.charAt(0) + request.requesterRole.slice(1).toLowerCase()
    : undefined;
  const requestSummary = (
    <RequestSummary
      requester={{ name: requester, role: requesterRole, wallet: request.requester }}
      provider={{ name: 'Your company', role: 'Supplier', you: true }}
      facts={[
        {
          label: 'Request for',
          value: (
            <>
              {ingredient ?? 'Ingredient batch'}
              {batchReference && <small>Batch {batchReference}</small>}
            </>
          ),
        },
        {
          label: 'Requester identity',
          value: (
            <span className="evidence-identity-status">
              <Badge
                label={proofStatusLabel(identityProof?.status ?? 'NOT_REQUESTED')}
                variant={proofStatusVariant(identityProof?.status ?? 'NOT_REQUESTED')}
              />
              <a
                href={
                  '/supplier/information-requests/sent?context=ingredient&referenceId=' +
                  encodeURIComponent(request.requestId)
                }
              >
                {identityProof?.status === 'VERIFIED' ? 'View identity' : 'Check identity'}
              </a>
            </span>
          ),
        },
        ...evidenceDateFields({
          dueAt: request.dueAt,
          open,
          proofValidUntil: previewExpiresAt
            ? new Date(previewExpiresAt * 1000).toISOString()
            : undefined,
          credentialExpires:
            typeof preview?.exp === 'number'
              ? new Date(preview.exp * 1000).toISOString()
              : undefined,
        }),
      ]}
      purpose={details?.reason}
      requested={visibleRequestedClaims.map((claim) => ({
        claim,
        label: ingredientClaimLabel(claim),
        required: visibleRequiredClaims.includes(claim),
        state: 'requested' as const,
      }))}
    />
  );
  const outcome = !open
    ? {
        tone: 'closed' as const,
        title: `Request ${status.label.toLowerCase()}`,
        message: CLOSED_MESSAGE[request.status] ?? 'This request is closed.',
      }
    : !preview
      ? {
          tone: 'action' as const,
          title: 'Your response is needed',
          message: 'Check the values that will be shared, then choose what to share.',
        }
      : {
          tone: 'action' as const,
          title: 'Choose what to share',
          message:
            'Required fields start selected; you decide. Sign and share when ready, or decline.',
        };
  return (
    <div className="information-requests-page is-detail">
      <BackNavigation onClick={onBack}>Ingredient evidence</BackNavigation>
      {error && <Alert type="error" message={error} />}

      <EvidenceDetailLayout
        asideTitle="Request summary"
        asideIcon={ClipboardList}
        aside={requestSummary}
      >
        <EvidenceSummaryCard
          icon={Leaf}
          title={ingredient ?? 'Your ingredient'}
          subtitle={`Requested by ${requester}${requesterRole ? ` · ${requesterRole}` : ''}`}
          context="Ingredient evidence request"
          badges={<Badge label={status.label} variant={status.variant} />}
        >
          <EvidenceOutcome
            {...outcome}
            action={
              open &&
              !preview && (
                <Btn disabled={busy || !details} onClick={() => void loadPreview()}>
                  {busy ? 'Loading…' : 'Review values to share'}
                </Btn>
              )
            }
          />
        </EvidenceSummaryCard>
        {open && (
          <>
            {hasRetiredRequiredClaim && (
              <Alert
                type="warning"
                message="This older request asks for information TraceChain no longer shares. Decline it and ask the requester for a new request."
              />
            )}
            {legacy && (
              <Alert
                type="warning"
                message="This older credential format shares every field. Individual fields cannot be hidden."
              />
            )}

            {preview && (
              <section
                className="evidence-card evidence-fields evidence-share-card"
                aria-labelledby="ingredient-fields-title"
              >
                <header>
                  <h4 id="ingredient-fields-title">
                    {legacy ? 'Values to share' : 'Fields to share'}
                  </h4>
                  {previewExpiresAt && (
                    <strong>Proof valid until {chainDate(previewExpiresAt)}</strong>
                  )}
                </header>
                <div className="ingredient-share-list">
                  {legacy &&
                    Object.entries(preview).map(([name, value]) => (
                      <div key={name} className="ingredient-share-row">
                        <IngredientClaimValue
                          name={name}
                          value={value}
                          loadDocument={(documentId) =>
                            getCertificationDocument(details!.batchId, documentId)
                          }
                        />
                      </div>
                    ))}
                  {requestedRows.map((claim) => {
                    const required = details?.requiredClaims.includes(claim) ?? false;
                    const included = optionalClaims.includes(claim);
                    return (
                      <div
                        key={claim}
                        className={`ingredient-share-row${included ? ' is-included' : ''}`}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={included}
                            disabled={busy}
                            onChange={(event) =>
                              setOptionalClaims((current) =>
                                toggleIngredientDisclosure(
                                  current,
                                  claim,
                                  event.target.checked,
                                  preview,
                                ),
                              )
                            }
                          />
                          <strong>{shareLabel(claim, preview)}</strong>
                          <span className={required ? 'is-required' : undefined}>
                            {required ? 'Required' : 'Optional'}
                          </span>
                        </label>
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
                      </div>
                    );
                  })}
                </div>
                {!legacy && (
                  <details className="evidence-how-it-works">
                    <summary>Always included and kept private</summary>
                    <p>
                      Always included:{' '}
                      {INGREDIENT_ALWAYS_CLAIMS.filter((key) => preview[key] !== undefined)
                        .map(ingredientClaimLabel)
                        .join(', ') || 'none'}
                      .
                    </p>
                    <p>
                      Kept private:{' '}
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
                            !isRetiredIngredientClaim(key),
                        )
                        .map(ingredientClaimLabel)
                        .join(', ') || 'nothing else'}
                      .
                    </p>
                  </details>
                )}
                {unmet.length > 0 && (
                  <Alert
                    type="warning"
                    message={`You are not sharing ${unmet.length === 1 ? 'one required item' : `${unmet.length} required items`}. You can still share; ${requester} will see the response as incomplete and may reject it. ${unmet.join(' ')}`}
                  />
                )}
                {holderDid && preview.vct !== 'urn:tracechain:credential:ingredient:sd-jwt:v3' && (
                  <PresentationSigningSettingsLink role="supplier" />
                )}
                <label className="ingredient-share-consent">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(event) => setApproved(event.target.checked)}
                  />
                  {legacy
                    ? 'I reviewed and authorize full disclosure of all displayed credential claims and document references to this exact recipient.'
                    : 'I reviewed this disclosure and authorize sharing only these selected claims for this exact request and recipient.'}
                </label>
              </section>
            )}

            {declining && (
              <div className="evidence-request-form">
                <Input
                  label="Reason for declining"
                  value={declineReason}
                  onChange={setDeclineReason}
                  maxLength={500}
                  placeholder="Tell the requester why you are declining"
                />
              </div>
            )}
            <div className="evidence-actions">
              {declining ? (
                <>
                  <Btn variant="outline" disabled={busy} onClick={() => setDeclining(false)}>
                    Cancel
                  </Btn>
                  <Btn
                    variant="danger"
                    disabled={busy || !declineReason.trim()}
                    onClick={() => void decline()}
                  >
                    Decline request
                  </Btn>
                </>
              ) : (
                <>
                  <Btn variant="outline" disabled={busy} onClick={() => setDeclining(true)}>
                    Decline…
                  </Btn>
                  {preview && (
                    <Btn
                      disabled={busy || !approved || !details || hasRetiredRequiredClaim}
                      onClick={() => void respond()}
                    >
                      {busy ? 'Signing…' : legacy ? 'Share full credential' : 'Sign and share'}
                    </Btn>
                  )}
                </>
              )}
            </div>
          </>
        )}

        <EvidenceHowItWorks>
          <p>
            Only the fields you select, plus the basic batch identity, are shared. Everything else
            in your ingredient credential stays hidden. Certification requests need at least one
            complete certification; choosing a document also shares the certification it belongs to.
          </p>
          <p>
            MetaMask asks for one signature to approve the selection, then one transaction records
            the encrypted response reference. A verified requester identity does not by itself
            approve sharing. Sharing does not approve any order.
          </p>
        </EvidenceHowItWorks>
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
                    value: typeof preview.exp === 'number' ? chainDate(preview.exp) : 'Unavailable',
                  },
                  { label: 'Holder signing DID', value: holderDid || 'Unavailable' },
                ]
              : []),
          ]}
        />
      </EvidenceDetailLayout>
    </div>
  );
}

/** Why a closed request has nothing left to do. */
const CLOSED_MESSAGE: Record<number, string> = {
  1: 'The deadline passed before a response was sent. You can no longer respond.',
  2: 'You shared evidence for this request. The requester is reviewing it.',
  3: 'The requester accepted the evidence you shared.',
  4: 'You declined this request.',
  5: 'The requester rejected the evidence you shared.',
  6: 'The requester cancelled this request.',
};

function shareLabel(claim: string, preview: Record<string, unknown>) {
  if (claim.startsWith('certificationDocuments_'))
    return `Supporting document: ${((preview[claim] as { documents?: { fileName: string }[] })?.documents ?? []).map((file) => file.fileName).join(', ')}`;
  if (claim.startsWith('certification_')) {
    const entry = preview[claim] as { name?: string; reference?: string } | undefined;
    return `Supplier-provided certification: ${entry?.name ?? 'Unavailable'} · ${entry?.reference ?? 'Unavailable'}`;
  }
  return ingredientClaimLabel(claim);
}

/** Requirements the current selection leaves unmet, in the same words the requester will see. */
function disclosureGaps(
  details: EvidenceDetails,
  preview: Record<string, unknown>,
  selected: string[],
) {
  const required = details.requiredClaims.filter((claim) => !isRetiredIngredientClaim(claim));
  const disclosed = Object.fromEntries(
    Object.entries(preview).filter(
      ([key]) =>
        selected.includes(key) ||
        key === 'policyVersion' ||
        (INGREDIENT_ALWAYS_CLAIMS as readonly string[]).includes(key),
    ),
  );
  if (details.policy)
    return ingredientDisclosureErrors(
      disclosed,
      details.policy,
      required,
      String(preview.batchReference ?? ''),
    );
  const prefix: Record<string, string> = {
    certifications: 'certification_',
    certificationDocuments: 'certificationDocuments_',
    qualityTests: 'qualityTest_',
    qualityDocuments: 'qualityDocuments_',
  };
  return required
    .filter((claim) =>
      prefix[claim]
        ? !Object.keys(disclosed).some((key) => key.startsWith(prefix[claim]!))
        : disclosed[claim] == null,
    )
    .map((claim) => `${ingredientClaimLabel(claim)} is required.`);
}
