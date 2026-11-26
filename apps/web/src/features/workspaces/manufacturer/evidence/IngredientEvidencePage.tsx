import { BackNavigation } from '../../../../components/ui/BackNavigation';
import {
  CURRENT_INGREDIENT_REQUEST_CLAIMS as INGREDIENT_REQUEST_CLAIMS,
  INGREDIENT_EVIDENCE_CLAIMS,
  type IngredientRequestPolicy,
} from '@tracechain/shared';
import { IngredientRequestPolicyFields } from '../../../production-flow/IngredientRequestPolicyFields';
import { EvidenceClaimSelector } from '../../../production-flow/EvidenceClaimSelector';
import { IngredientClaimValue } from '../../../production-flow/IngredientClaimValue';
import { getSharedCertificationDocument } from '../../../production-flow/production-flow.api';
import { reportError } from '../../../../components/ui/feedback';
import { useEffect, useState } from 'react';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { FileCheck } from 'lucide-react';
import { PaginatedTable } from '../../../../components/ui/PaginatedTable';
import {
  EvidenceDetailLayout,
  EvidenceHowItWorks,
  EvidenceNextStep,
  ingredientEvidenceStatus,
  DeadlineCell,
  EvidenceStatusSelect,
  ingredientRequestGroup,
  matchesStatusFilter,
  type EvidenceStatusFilter,
} from '../../../orders/EvidenceParts';
import { catalogueItem, loadCatalogue, useOverviewSource } from '../../shared/overview-data';

import {
  getEvidenceDetails,
  listEvidenceRequests,
  listProductionIngredients,
  prepareEvidenceAcceptance,
  prepareEvidenceClose,
  prepareEvidenceRequest,
  reviewEvidence,
  verifyEvidence,
  type EvidenceReview,
  type EvidenceDetails,
  type ProductionEvidenceRequest,
  type ProductionIngredient,
} from '../../../production-flow/production-flow.api';
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { Alert, Badge, Btn, EmptyState, Input, TechnicalDetails } from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';
import { textError, futureDateError } from '../../../validation/form-validation';

const selectableClaims = INGREDIENT_REQUEST_CLAIMS;

export function IngredientEvidence({
  onNav: _onNav,
  hideComposer = false,
  requestId,
  initialBatchId,
}: {
  onNav: (target: string) => void;
  hideComposer?: boolean;
  requestId?: string;
  initialBatchId?: string;
}) {
  const [ingredients, setIngredients] = useState<ProductionIngredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ProductionEvidenceRequest[]>([]);
  const [batchId, setBatchId] = useState(initialBatchId ?? '');
  const [reason, setReason] = useState('Product ingredient traceability verification');
  const [dueAt, setDueAt] = useState('');
  const [policy, setPolicy] = useState<IngredientRequestPolicy>({
    policyVersion: 2,
    template: 'custom',
  });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [verified, setVerified] = useState<Record<string, string>>({});
  const [review, setReview] = useState<EvidenceReview>();
  const [statusFilter, setStatusFilter] = useState<EvidenceStatusFilter>('all');
  const [details, setDetails] =
    useState<Pick<EvidenceDetails, 'batchId' | 'reason' | 'claims' | 'requiredClaims'>>();
  useEffect(() => {
    let active = true;
    setDetails(undefined);
    if (hideComposer && requestId)
      void getEvidenceDetails(requestId)
        .then((result) => {
          if (active)
            setDetails({
              batchId: result.batchId,
              reason: result.reason,
              claims: result.claims,
              requiredClaims: result.requiredClaims,
            });
        })
        .catch((cause) => {
          if (active) setError(reportError(cause, 'Request details are unavailable.'));
        });
    return () => {
      active = false;
    };
  }, [hideComposer, requestId]);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  // Display only: ingredient names for batch IDs.
  const catalogue = useOverviewSource(loadCatalogue, 'Ingredient names could not be loaded.');
  const [claimChoices, setClaimChoices] = useState<
    Record<string, 'required' | 'optional' | 'none'>
  >({
    countryOfOrigin: 'required',
    productionDate: 'optional',
    expiryDate: 'required',
  });

  const load = async () => {
    const [ingredientResult, requestResult] = await Promise.all([
      hideComposer ? Promise.resolve({ batches: [] }) : listProductionIngredients(),
      listEvidenceRequests(),
    ]);
    setIngredients(ingredientResult.batches);
    setRequests(
      requestId
        ? requestResult.requests.filter((request) => request.requestId === requestId)
        : requestResult.requests,
    );
  };
  useEffect(() => {
    void load()
      .catch((cause) => setError(reportError(cause, 'Could not load evidence records.')))
      .finally(() => setLoading(false));
  }, [hideComposer, requestId]);

  const requestEvidence = async () => {
    const validationError = !ingredients.some((item) => item.batchId === batchId && !item.accepted)
      ? 'Select an available ingredient batch.'
      : textError(reason, 'Reason', 500) ||
        futureDateError(dueAt, 'Response deadline') ||
        (!selectableClaims.some(([name]) =>
          ['required', 'optional'].includes(claimChoices[name] ?? 'none'),
        )
          ? 'Select at least one requested claim.'
          : '');
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy('request');
    setError('');
    setNotice('');
    try {
      const operationId = crypto.randomUUID();
      const claims = selectableClaims
        .map(([name]) => name)
        .filter((name) => (claimChoices[name] ?? 'none') !== 'none');
      const requiredClaims = claims.filter((name) => claimChoices[name] === 'required');
      const completed = await completePreparedWorkflow(() =>
        prepareEvidenceRequest({
          batchId,
          claims,
          requiredClaims,
          policy,
          dueAt: new Date(`${dueAt}T23:59:59`).toISOString(),
          operationId,
          reason,
        }),
      );
      if (!completed.requestId) throw new Error('The confirmed request ID is unavailable.');
      try {
        setNotice('The request is confirmed on chain and its encrypted DIDComm message was sent.');
      } catch (deliveryError) {
        setNotice('The request is confirmed on chain.');
        setError(reportError(deliveryError, 'Encrypted DIDComm delivery is pending.'));
      }
      setBatchId('');
      await load();
    } catch (cause) {
      setError(reportError(cause, 'The request failed.'));
    } finally {
      setBusy('');
    }
  };

  const accept = async (requestId: string) => {
    setBusy(requestId);
    setError('');
    setNotice('');
    try {
      await completePreparedWorkflow(() => prepareEvidenceAcceptance(requestId));
      setNotice('The cryptographically verified evidence is accepted for this Manufacturer.');
      await load();
    } catch (cause) {
      setError(reportError(cause, 'Evidence acceptance failed.'));
    } finally {
      setBusy('');
    }
  };

  const verify = async (requestId: string) => {
    setBusy(requestId);
    setError('');
    setNotice('');
    try {
      const result = await verifyEvidence(requestId);
      setVerified((current) => ({ ...current, [requestId]: result.verifiedAt }));
      setReview(await reviewEvidence(requestId));
      setNotice(
        'The presentation and credential checks passed. Review the result before separately accepting it.',
      );
    } catch (cause) {
      setError(reportError(cause, 'Evidence verification failed.'));
    } finally {
      setBusy('');
    }
  };

  const view = async (requestId: string) => {
    setBusy(`view:${requestId}`);
    setError('');
    try {
      setReview(await reviewEvidence(requestId));
    } catch (cause) {
      setError(reportError(cause, 'Could not load received evidence.'));
    } finally {
      setBusy('');
    }
  };

  const reject = async () => {
    if (!review) return;
    const invalid = textError(rejectReason, 'Rejection reason', 500);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(`reject:${review.requestId}`);
    setError('');
    try {
      await completePreparedWorkflow(() =>
        prepareEvidenceClose(review.requestId, { reason: rejectReason, status: 'REJECTED' }),
      );
      setNotice('The received evidence was rejected on chain.');
      setReview(undefined);
      setRejectReason('');
      await load();
    } catch (cause) {
      setError(reportError(cause, 'Evidence rejection failed.'));
    } finally {
      setBusy('');
    }
  };

  if (loading) return <LoadingIndicator page label="Loading ingredient evidence requests…" />;
  const nameFor = (id?: string) => (id ? catalogueItem(catalogue.data, id) : undefined);
  const banners = (
    <>
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
    </>
  );

  if (review) {
    const item = nameFor(review.batchId);
    const ingredient =
      (review.sharedClaims.ingredientName as string | undefined) ?? item?.name ?? 'Ingredient';
    const passed = review.verification.state === 'PASSED';
    const status = ingredientEvidenceStatus(review.status);
    return (
      <div className="information-requests-page is-detail">
        <BackNavigation onClick={() => setReview(undefined)}>Ingredient evidence</BackNavigation>
        <header className="evidence-detail-header">
          <div>
            <h2>
              Evidence from {review.supplierName ?? 'the Supplier'} on {ingredient}
            </h2>
            <p>
              {review.disclosure === 'SELECTIVE_SD_JWT'
                ? 'Selective disclosure'
                : 'Full disclosure: the whole ingredient credential was shared'}
            </p>
          </div>
          <div className="evidence-detail-header__status">
            <Badge label={status.label} variant={status.variant} />
            <Badge
              label={passed ? 'Verification passed' : 'Unverified'}
              variant={passed ? 'verified' : 'pending'}
            />
          </div>
        </header>
        {banners}
        <EvidenceDetailLayout
          asideTitle="Proof details"
          aside={
            <section className="evidence-request-details" aria-label="Proof details">
              <dl>
                <div>
                  <dt>Supplier</dt>
                  <dd>{review.supplierName ?? review.supplier}</dd>
                </div>
                <div>
                  <dt>Proof valid until</dt>
                  <dd>{new Date(review.presentationExpiry).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Credential expires</dt>
                  <dd>
                    {review.credentialExpiry === 'Unavailable'
                      ? 'Unavailable'
                      : new Date(review.credentialExpiry).toLocaleString()}
                  </dd>
                </div>
                {review.verification.verifiedAt && (
                  <div>
                    <dt>Last verified</dt>
                    <dd>{new Date(review.verification.verifiedAt).toLocaleString()}</dd>
                  </div>
                )}
              </dl>
            </section>
          }
        >
          <EvidenceNextStep
            tone={review.status === 3 ? 'done' : review.status === 2 ? 'default' : 'closed'}
            message={
              review.status === 3
                ? 'You accepted this evidence. Nothing else to do.'
                : review.status !== 2
                  ? 'This request is closed.'
                  : passed
                    ? 'Verification passed. Accept the evidence, or reject it with a reason.'
                    : 'Verify the shared values before you accept them.'
            }
            action={
              review.status === 2 && (
                <>
                  {passed ? (
                    <Btn
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => setRejecting(true)}
                    >
                      Reject…
                    </Btn>
                  ) : null}
                  <Btn
                    variant={passed ? 'outline' : 'primary'}
                    disabled={Boolean(busy)}
                    onClick={() => void verify(review.requestId)}
                  >
                    {busy === review.requestId ? 'Verifying…' : 'Verify evidence'}
                  </Btn>
                  <Btn
                    disabled={!passed || Boolean(busy)}
                    onClick={() => void accept(review.requestId)}
                  >
                    Accept evidence
                  </Btn>
                </>
              )
            }
          />
          {rejecting && review.status === 2 && (
            <div className="evidence-request-form">
              <Input
                label="Rejection reason"
                maxLength={500}
                value={rejectReason}
                onChange={setRejectReason}
                placeholder="Tell the Supplier why the evidence is rejected"
              />
              <div className="evidence-actions">
                <Btn variant="outline" onClick={() => setRejecting(false)}>
                  Cancel
                </Btn>
                <Btn
                  variant="danger"
                  disabled={!rejectReason.trim() || Boolean(busy)}
                  onClick={() => void reject()}
                >
                  Reject evidence
                </Btn>
              </div>
            </div>
          )}
          <section className="evidence-panel__shared" aria-label="Shared values">
            <h4>Shared values</h4>
            <div className="ingredient-review-grid">
              {Object.entries(review.sharedClaims).map(([label, value]) => (
                <div key={label}>
                  <IngredientClaimValue
                    name={label}
                    value={value}
                    loadDocument={(id) => getSharedCertificationDocument(review.requestId, id)}
                  />
                </div>
              ))}
            </div>
          </section>
          <EvidenceHowItWorks>
            <p>
              Verifying checks the Supplier&apos;s signature, that the proof belongs to this request
              and recipient, and the credential&apos;s current on-chain status. Accepting is a
              separate on-chain step, so you can verify first and decide later.
            </p>
          </EvidenceHowItWorks>
          <TechnicalDetails
            fields={[
              { label: 'Request ID', value: review.requestId },
              { label: 'Ingredient batch ID', value: review.batchId },
              { label: 'Credential ID', value: review.credentialId },
              { label: 'Supplier wallet', value: review.supplier },
            ]}
          />
        </EvidenceDetailLayout>
      </div>
    );
  }

  const ordered = requests
    .filter((request) => matchesStatusFilter(statusFilter, ingredientRequestGroup(request, 'sent')))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.dueAt - a.dueAt);
  return (
    <div className="information-requests-page">
      {banners}
      {hideComposer && details && (
        <section className="evidence-request-details" aria-label="Request details">
          <dl>
            <div>
              <dt>Ingredient</dt>
              <dd>{nameFor(details.batchId)?.name ?? shortChainId(details.batchId)}</dd>
            </div>
            <div className="is-wide">
              <dt>Purpose</dt>
              <dd>Reason: {details.reason}</dd>
            </div>
            <div className="is-wide">
              <dt>Fields requested</dt>
              <dd>
                <span>Necessary claims: {details.requiredClaims.join(', ') || 'None'}</span>
                <span>
                  Optional claims:{' '}
                  {details.claims
                    .filter((claim) => !details.requiredClaims.includes(claim))
                    .join(', ') || 'None'}
                </span>
              </dd>
            </div>
          </dl>
        </section>
      )}
      {!hideComposer && (
        <section className="evidence-request-details" aria-label="Request ingredient evidence">
          <h3 className="evidence-section-title">Request ingredient evidence</h3>
          <div className="evidence-request-form">
            <label className="evidence-select-field">
              Ingredient batch
              <select value={batchId} onChange={(event) => setBatchId(event.target.value)}>
                <option value="">Select a Supplier batch</option>
                {ingredients
                  .filter((item) => !item.accepted)
                  .map((item) => (
                    <option key={item.batchId} value={item.batchId}>
                      {nameFor(item.batchId)?.name ?? shortChainId(item.batchId)} ·{' '}
                      {item.supplierName ?? 'Verified Supplier'} · {item.availableQuantity}{' '}
                      {item.unit} available
                    </option>
                  ))}
              </select>
            </label>
            <Input label="Reason" maxLength={500} value={reason} onChange={setReason} required />
            <Input
              label="Response deadline"
              type="date"
              error={dueAt ? futureDateError(dueAt, 'Response deadline') : undefined}
              value={dueAt}
              onChange={setDueAt}
              required
            />
            <IngredientRequestPolicyFields
              policy={policy}
              onChange={setPolicy}
              onRequirements={(required) =>
                setClaimChoices((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    INGREDIENT_REQUEST_CLAIMS.map(([key]) => [
                      key,
                      required.includes(key) ? ('required' as const) : ('none' as const),
                    ]),
                  ),
                }))
              }
            />
            <EvidenceClaimSelector
              catalogue={INGREDIENT_EVIDENCE_CLAIMS.filter((claim) =>
                selectableClaims.some(([id]) => id === claim.id),
              )}
              required={selectableClaims
                .map(([id]) => id)
                .filter((id) => claimChoices[id] === 'required')}
              optional={selectableClaims
                .map(([id]) => id)
                .filter((id) => claimChoices[id] === 'optional')}
              onChange={(required, optional) =>
                setClaimChoices(
                  Object.fromEntries(
                    selectableClaims.map(([id]) => [
                      id,
                      required.includes(id)
                        ? 'required'
                        : optional.includes(id)
                          ? 'optional'
                          : 'none',
                    ]),
                  ),
                )
              }
            />
            <div className="evidence-actions">
              <EvidenceHowItWorks>
                <p>
                  The request details and a one-time challenge are encrypted before upload. Only
                  their hashes and the encrypted reference are recorded on chain.
                </p>
              </EvidenceHowItWorks>
              <Btn
                disabled={
                  !batchId ||
                  !reason.trim() ||
                  !dueAt ||
                  !Object.values(claimChoices).some((value) => value !== 'none') ||
                  Boolean(busy)
                }
                onClick={() => void requestEvidence()}
              >
                {busy === 'request' ? 'Confirming…' : 'Request evidence with MetaMask'}
              </Btn>
            </div>
          </div>
        </section>
      )}
      {requests.length > 0 && (
        <div className="evidence-toolbar">
          <EvidenceStatusSelect
            value={statusFilter}
            onChange={setStatusFilter}
            actionCount={
              requests.filter((request) => ingredientRequestGroup(request, 'sent') === 'action')
                .length
            }
          />
        </div>
      )}
      {ordered.length === 0 ? (
        <EmptyState
          icon={<FileCheck size={30} />}
          title={
            requests.length ? 'No requests match this filter' : 'No ingredient evidence requests'
          }
          sub="Open a Supplier ingredient and choose Request evidence to ask for its certifications or origin."
        />
      ) : (
        <div className="evidence-table-card">
          <PaginatedTable>
            <table className="evidence-table" aria-label="Ingredient evidence requests">
              <thead>
                <tr>
                  <th scope="col">Requested from</th>
                  <th scope="col">Ingredient</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((request) => {
                  const status = ingredientEvidenceStatus(request.status, request.dueAt);
                  const item = nameFor(request.ingredientBatchId);
                  return (
                    <tr
                      key={request.requestId}
                      className={request.status === 2 ? 'is-actionable' : undefined}
                    >
                      <td>
                        <strong>{request.supplierName ?? 'Verified Supplier'}</strong>
                      </td>
                      <td>
                        <span className="evidence-table__stack">
                          <strong>{item?.name ?? 'Ingredient batch'}</strong>
                          <small>
                            {item?.batchReference
                              ? `Batch ${item.batchReference}`
                              : request.ingredientBatchId
                                ? shortChainId(request.ingredientBatchId)
                                : ''}
                          </small>
                        </span>
                      </td>
                      <DeadlineCell
                        dueAt={request.dueAt}
                        closed={ingredientRequestGroup(request, 'sent') === 'closed'}
                      />
                      <td>
                        <Badge label={status.label} variant={status.variant} />
                      </td>
                      <td className="evidence-table__action">
                        {request.status >= 2 ? (
                          <Btn
                            size="xs"
                            variant={request.status === 2 ? 'primary' : 'outline'}
                            disabled={Boolean(busy)}
                            onClick={() => void view(request.requestId)}
                          >
                            {busy === `view:${request.requestId}` ? 'Loading…' : 'View evidence'}
                          </Btn>
                        ) : (
                          <small>Waiting for Supplier</small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PaginatedTable>
        </div>
      )}
    </div>
  );
}
