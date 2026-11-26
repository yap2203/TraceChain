import { BackNavigation } from '../../../../components/ui/BackNavigation';
import {
  CURRENT_INGREDIENT_REQUEST_CLAIMS as INGREDIENT_REQUEST_CLAIMS,
  INGREDIENT_EVIDENCE_CLAIMS,
  type IngredientRequestPolicy,
} from '@tracechain/shared';
import { IngredientRequestPolicyFields } from '../../../production-flow/IngredientRequestPolicyFields';
import { EvidenceClaimSelector } from '../../../production-flow/EvidenceClaimSelector';
import { reportError } from '../../../../components/ui/feedback';
import { IngredientClaimValue } from '../../../production-flow/IngredientClaimValue';
import { getSharedCertificationDocument } from '../../../production-flow/production-flow.api';
import { useEffect, useState } from 'react';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { FileCheck2, Plus, RefreshCw } from 'lucide-react';
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
  type EvidenceGroup,
  type EvidenceStatusFilter,
} from '../../../orders/EvidenceParts';

import {
  getEvidenceDetails,
  listEvidenceRequests,
  listRetailerEvidenceOptions,
  prepareEvidenceAcceptance,
  prepareEvidenceClose,
  prepareEvidenceRequest,
  reviewEvidence,
  verifyEvidence,
  type EvidenceReview,
  type ProductionEvidenceRequest,
  type RetailerEvidenceOption,
} from '../../../production-flow/production-flow.api';
import { getOrders, type OrderRecord } from '../../../orders/orders.api';
import {
  completePreparedWorkflow,
  WorkflowRefreshPendingError,
} from '../../../production-flow/production-flow.transaction';
import {
  Alert,
  Badge,
  Btn,
  EmptyState,
  Input,
  SectionTitle,
  TechnicalDetails,
} from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';
import { textError, futureDateError } from '../../../validation/form-validation';

const claimOptions = INGREDIENT_REQUEST_CLAIMS;

export function RetailerEvidenceRequests({
  embedded = false,
  initialProductBatchId,
  initialIngredientBatchId,
}: {
  embedded?: boolean;
  initialProductBatchId?: string;
  initialIngredientBatchId?: string;
} = {}) {
  const [options, setOptions] = useState<RetailerEvidenceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ProductionEvidenceRequest[]>([]);
  const [catalogue, setCatalogue] = useState<OrderRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<EvidenceStatusFilter>('all');
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('Retail product ingredient traceability review');
  const [dueAt, setDueAt] = useState('');
  const [policy, setPolicy] = useState<IngredientRequestPolicy>({
    policyVersion: 2,
    template: 'custom',
  });
  const [choices, setChoices] = useState<Record<string, 'none' | 'optional' | 'required'>>({
    countryOfOrigin: 'required',
    expiryDate: 'required',
  });
  const [review, setReview] = useState<EvidenceReview>();
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refreshPending, setRefreshPending] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  // Arriving from a product link opens the request form straight away.
  const [composing, setComposing] = useState(Boolean(initialIngredientBatchId));
  const load = async () => {
    const [available, current, orders] = await Promise.all([
      listRetailerEvidenceOptions(),
      listEvidenceRequests(),
      getOrders('catalogue'),
    ]);
    setOptions(available.options);
    if (initialProductBatchId && initialIngredientBatchId) {
      const index = available.options.findIndex(
        (option) =>
          option.productBatchId.toLowerCase() === initialProductBatchId.toLowerCase() &&
          option.ingredientBatchId.toLowerCase() === initialIngredientBatchId.toLowerCase(),
      );
      if (index >= 0)
        setSelected(
          `${available.options[index].productBatchId}:${available.options[index].ingredientBatchId}`,
        );
    }
    setRequests(current.requests);
    setCatalogue(orders.catalogue);
  };
  useEffect(() => {
    void load()
      .catch((cause) => setError(message(cause)))
      .finally(() => setLoading(false));
  }, []);
  const chosen = options.find(
    (item) => `${item.productBatchId}:${item.ingredientBatchId}` === selected,
  );
  const visibleRequests = requests.filter((request) =>
    matchesStatusFilter(statusFilter, retailerGroup(request)),
  );
  const requestEvidence = async () => {
    if (!chosen) return;
    const validationError =
      textError(reason, 'Reason', 500) ||
      futureDateError(dueAt, 'Response deadline') ||
      (!claimOptions.some(([name]) => ['required', 'optional'].includes(choices[name] ?? 'none'))
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
      const claims = claimOptions
        .map(([name]) => name)
        .filter((name) => (choices[name] ?? 'none') !== 'none');
      const completed = await completePreparedWorkflow(() =>
        prepareEvidenceRequest({
          batchId: chosen.ingredientBatchId,
          claims,
          requiredClaims: claims.filter((name) => choices[name] === 'required'),
          policy,
          dueAt: new Date(`${dueAt}T23:59:59`).toISOString(),
          operationId: crypto.randomUUID(),
          productBatchId: chosen.productBatchId,
          reason,
        }),
      );
      if (!completed.requestId) throw new Error('The confirmed request ID is unavailable.');
      setNotice('Request confirmed on chain and encrypted for the original Supplier.');
      setSelected('');
      await load();
    } catch (cause) {
      if (cause instanceof WorkflowRefreshPendingError) {
        setNotice(cause.message);
        setRefreshPending(true);
      } else setError(message(cause));
    } finally {
      setBusy('');
    }
  };
  const openReview = async (requestId: string) => {
    setBusy(requestId);
    setError('');
    try {
      setReview(await reviewEvidence(requestId));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy('');
    }
  };
  const verify = async () => {
    if (!review) return;
    setBusy('verify');
    try {
      await verifyEvidence(review.requestId);
      setReview(await reviewEvidence(review.requestId));
      setNotice('Verification passed. Record a separate review decision.');
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy('');
    }
  };
  const decide = async (accepted: boolean) => {
    if (!review) return;
    if (!accepted) {
      const invalid = textError(rejectReason, 'Rejection reason', 500);
      if (invalid) {
        setError(invalid);
        return;
      }
    }
    setBusy('decision');
    try {
      if (accepted)
        await completePreparedWorkflow(() => prepareEvidenceAcceptance(review.requestId));
      else
        await completePreparedWorkflow(() =>
          prepareEvidenceClose(review.requestId, { reason: rejectReason, status: 'REJECTED' }),
        );
      setNotice(
        accepted
          ? 'Recorded as satisfactory without granting manufacturing or custody rights.'
          : 'Evidence rejected.',
      );
      setReview(undefined);
      await load();
    } catch (cause) {
      if (cause instanceof WorkflowRefreshPendingError) {
        setNotice(cause.message);
        setRefreshPending(true);
        setReview(undefined);
      } else setError(message(cause));
    } finally {
      setBusy('');
    }
  };

  if (loading) return <LoadingIndicator page label="Loading ingredient evidence requests…" />;
  const contextFor = (request: { ingredientBatchId: string; productBatchId?: string }) =>
    options.find(
      (option) =>
        option.ingredientBatchId.toLowerCase() === request.ingredientBatchId.toLowerCase() &&
        (!request.productBatchId ||
          option.productBatchId.toLowerCase() === request.productBatchId.toLowerCase()),
    );
  const banners = (
    <>
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {refreshPending && (
        <Btn
          size="sm"
          variant="secondary"
          onClick={() => {
            setBusy('refresh');
            setError('');
            void load()
              .then(() => {
                setRefreshPending(false);
                setNotice('The confirmed blockchain record has been refreshed.');
              })
              .catch((cause) => setError(message(cause)))
              .finally(() => setBusy(''));
          }}
        >
          {busy === 'refresh' ? 'Refreshing…' : 'Refresh records'}
        </Btn>
      )}
    </>
  );

  if (review) {
    const passed = review.verification.state === 'PASSED';
    const source = requests.find((request) => request.requestId === review.requestId);
    const context = source ? contextFor(source) : undefined;
    const status = retailerStatus(review.status);
    return (
      <div className="information-requests-page is-detail">
        <BackNavigation onClick={() => setReview(undefined)}>Ingredient evidence</BackNavigation>
        <header className="evidence-detail-header">
          <div>
            <h2>
              Evidence from {review.supplierName ?? 'the Supplier'} on{' '}
              {context?.ingredientName ?? 'the ingredient'}
            </h2>
            <p>
              {context?.productName
                ? `Used in ${context.productName}`
                : 'Linked to a received product'}
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
          aside={
            <section className="evidence-request-details" aria-label="Request details">
              <dl>
                <div>
                  <dt>Supplier</dt>
                  <dd>{review.supplierName ?? review.supplier}</dd>
                </div>
                <div>
                  <dt>Product</dt>
                  <dd>{context?.productName ?? 'Registered product'}</dd>
                </div>
                <div>
                  <dt>Ingredient</dt>
                  <dd>{context?.ingredientName ?? 'Linked ingredient'}</dd>
                </div>
                <div>
                  <dt>Proof valid until</dt>
                  <dd>{new Date(review.presentationExpiry).toLocaleString()}</dd>
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
                ? 'You recorded this evidence as satisfactory. Nothing else to do.'
                : review.status !== 2
                  ? 'This request is closed.'
                  : passed
                    ? 'Verification passed. Record whether the evidence is satisfactory.'
                    : 'Verify the shared values before you record a decision.'
            }
            action={
              review.status === 2 && (
                <>
                  {passed && (
                    <Btn
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => setRejecting(true)}
                    >
                      Reject…
                    </Btn>
                  )}
                  <Btn
                    variant={passed ? 'outline' : 'primary'}
                    onClick={() => void verify()}
                    disabled={Boolean(busy)}
                  >
                    {busy === 'verify' ? 'Verifying…' : 'Verify evidence'}
                  </Btn>
                  <Btn onClick={() => void decide(true)} disabled={!passed || Boolean(busy)}>
                    Evidence satisfactory
                  </Btn>
                </>
              )
            }
          />
          {rejecting && review.status === 2 && (
            <div className="evidence-request-form">
              <Input
                label="Rejection reason"
                value={rejectReason}
                onChange={setRejectReason}
                placeholder="Tell the Supplier why the evidence is not satisfactory"
              />
              <div className="evidence-actions">
                <Btn variant="outline" onClick={() => setRejecting(false)}>
                  Cancel
                </Btn>
                <Btn
                  variant="danger"
                  onClick={() => void decide(false)}
                  disabled={!rejectReason.trim() || Boolean(busy)}
                >
                  Reject evidence
                </Btn>
              </div>
            </div>
          )}
          <section className="evidence-panel__shared" aria-label="Shared values">
            <h4>Shared values</h4>
            <div className="ingredient-review-grid">
              {Object.entries(review.sharedClaims).map(([key, value]) => (
                <div key={key}>
                  <IngredientClaimValue
                    name={key}
                    value={value}
                    loadDocument={(id) => getSharedCertificationDocument(review.requestId, id)}
                  />
                </div>
              ))}
            </div>
          </section>
          <EvidenceHowItWorks>
            <p>
              These are the Supplier&apos;s own declarations, not independent laboratory or
              certification-body proof. Verifying checks the signature, the request binding and the
              credential&apos;s on-chain status; your decision is recorded separately and does not
              grant any manufacturing or custody rights.
            </p>
          </EvidenceHowItWorks>
          <TechnicalDetails
            fields={[
              { label: 'Request ID', value: review.requestId },
              { label: 'Ingredient batch ID', value: review.batchId },
              { label: 'Credential ID', value: review.credentialId },
            ]}
          />
        </EvidenceDetailLayout>
      </div>
    );
  }

  const ordered = [...visibleRequests].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.dueAt - a.dueAt,
  );
  return (
    <div className="information-requests-page">
      {!embedded && (
        <SectionTitle
          title="Ingredient evidence"
          sub="Ask the original Supplier for evidence about an ingredient in a product you received."
          action={
            <Btn variant="outline" icon={<RefreshCw size={16} />} onClick={() => void load()}>
              Refresh
            </Btn>
          }
        />
      )}
      {banners}
      <div className="evidence-toolbar">
        <EvidenceStatusSelect
          value={statusFilter}
          onChange={setStatusFilter}
          actionCount={requests.filter((request) => retailerGroup(request) === 'action').length}
        />
        <Btn
          variant={composing ? 'outline' : 'primary'}
          icon={<Plus size={16} />}
          onClick={() => setComposing((open) => !open)}
        >
          {composing ? 'Close request form' : 'New evidence request'}
        </Btn>
      </div>
      {composing && (
        <section
          className="evidence-request-details evidence-request-composer"
          aria-label="New evidence request"
        >
          <h3 className="evidence-section-title">New evidence request</h3>
          <div className="evidence-request-form">
            <label className="evidence-select-field">
              Product and linked ingredient
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                <option value="">Select a product ingredient</option>
                {options.map((option) => (
                  <option
                    key={`${option.productBatchId}:${option.ingredientBatchId}`}
                    value={`${option.productBatchId}:${option.ingredientBatchId}`}
                  >
                    {option.productName ?? `Product ${shortChainId(option.productBatchId)}`} ·{' '}
                    {option.ingredientName ??
                      `Ingredient ${shortChainId(option.ingredientBatchId)}`}{' '}
                    · {option.supplierName ?? shortChainId(option.supplier)}
                  </option>
                ))}
              </select>
            </label>
            {chosen && (
              <p className="evidence-panel__facts">
                <span>
                  Product <strong>{chosen.productName ?? 'Registered product'}</strong>
                </span>
                <span>
                  Ingredient{' '}
                  <strong>{chosen.ingredientName ?? shortChainId(chosen.ingredientBatchId)}</strong>
                </span>
                <span>
                  Supplier <strong>{chosen.supplierName ?? 'Original Supplier'}</strong>
                </span>
              </p>
            )}
            <IngredientRequestPolicyFields
              policy={policy}
              onChange={setPolicy}
              onRequirements={(required) =>
                setChoices((current) => ({
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
                claimOptions.some(([id]) => id === claim.id),
              )}
              required={claimOptions.map(([id]) => id).filter((id) => choices[id] === 'required')}
              optional={claimOptions.map(([id]) => id).filter((id) => choices[id] === 'optional')}
              onChange={(required, optional) =>
                setChoices(
                  Object.fromEntries(
                    claimOptions.map(([id]) => [
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
            <Input label="Reason" value={reason} onChange={setReason} required />
            <Input
              label="Response deadline"
              type="date"
              value={dueAt}
              onChange={setDueAt}
              required
            />
            <div className="evidence-actions">
              <span />
              <Btn
                disabled={!chosen || !dueAt || !reason.trim() || Boolean(busy)}
                onClick={() => void requestEvidence()}
              >
                {busy === 'request' ? 'Confirming…' : 'Request evidence with MetaMask'}
              </Btn>
            </div>
          </div>
        </section>
      )}
      {requests.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 size={28} />}
          title="No ingredient evidence requests yet"
          sub="Choose New evidence request to ask a Supplier about an ingredient in a product you received."
        />
      ) : !ordered.length ? (
        <EmptyState
          icon={<FileCheck2 size={28} />}
          title="No requests match this status"
          sub="Choose another status to see your other requests."
        />
      ) : (
        <div className="evidence-table-card">
          <PaginatedTable>
            <table className="evidence-table" aria-label="Ingredient evidence requests">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Ingredient</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">Deadline</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((request) => {
                  const context = contextFor(request);
                  const product = request.productBatchId
                    ? catalogueProduct(catalogue, request.productBatchId)
                    : undefined;
                  const status = retailerStatus(request.status, request.dueAt);
                  const ready = evidenceGroup(request) === 'presented';
                  return (
                    <tr key={request.requestId} className={ready ? 'is-actionable' : undefined}>
                      <td>
                        <span className="evidence-table__stack">
                          <strong>
                            {context?.productName ?? product?.name ?? 'Registered product'}
                          </strong>
                          <small>
                            {context?.productBatchReference ?? product?.batchReference ?? ''}
                          </small>
                        </span>
                      </td>
                      <td>{context?.ingredientName ?? shortChainId(request.ingredientBatchId)}</td>
                      <td>{request.supplierName ?? shortChainId(request.supplier)}</td>
                      <DeadlineCell
                        dueAt={request.dueAt}
                        closed={retailerGroup(request) === 'closed'}
                      />
                      <td>
                        <Badge label={status.label} variant={status.variant} />
                      </td>
                      <td className="evidence-table__action">
                        {request.status >= 2 ? (
                          <Btn
                            size="xs"
                            variant={ready ? 'primary' : 'outline'}
                            disabled={Boolean(busy)}
                            onClick={() => void openReview(request.requestId)}
                          >
                            {busy === request.requestId
                              ? 'Loading…'
                              : ready
                                ? 'Review evidence'
                                : 'View evidence'}
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
function message(cause: unknown) {
  return reportError(cause, 'The evidence workflow failed.');
}

/** Retailers record a "Satisfactory" decision rather than a Manufacturer acceptance. */
function retailerStatus(status: number, dueAt?: number) {
  const base = ingredientEvidenceStatus(status, dueAt);
  return status === 3 ? { ...base, label: 'Satisfactory' } : base;
}

function catalogueProduct(catalogue: OrderRecord[], batchId: string) {
  return catalogue.find((item) =>
    item.batches?.some((id: string) => id.toLowerCase() === batchId.toLowerCase()),
  );
}

/** Ready-to-review evidence is the Retailer's action; verified evidence waits on no one. */
function retailerGroup(request: ProductionEvidenceRequest): EvidenceGroup {
  if (evidenceGroup(request) === 'presented') return 'action';
  const group = ingredientRequestGroup(request, 'sent');
  return group === 'action' ? 'open' : group;
}

function evidenceGroup(request: ProductionEvidenceRequest) {
  if (request.status === 2 && request.verification?.state !== 'PASSED') return 'presented';
  if (request.status === 3 || request.verification?.state === 'PASSED') return 'verified';
  if ([4, 5, 6].includes(request.status)) return 'unavailable';
  return 'pending';
}
