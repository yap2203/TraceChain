import {
  CURRENT_INGREDIENT_REQUEST_CLAIMS as INGREDIENT_REQUEST_CLAIMS,
  type IngredientRequestPolicy,
} from '@tracechain/shared';
import { IngredientRequestPolicyFields } from '../../../production-flow/IngredientRequestPolicyFields';
import { reportError } from '../../../../components/ui/feedback';
import { IngredientClaimValue } from '../../../production-flow/IngredientClaimValue';
import { getSharedCertificationDocument } from '../../../production-flow/production-flow.api';
import { useEffect, useState } from 'react';
import { LoadingIndicator } from '../../../../components/ui/LoadingIndicator';
import { FileCheck2, RefreshCw } from 'lucide-react';

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
import { sendEvidenceRequestMessage } from '../../../production-flow/evidence-didcomm';
import { CatalogueImage, CompanyAvatar } from '../../../orders/CatalogueMedia';
import { getOrders, type OrderRecord } from '../../../orders/orders.api';
import {
  completePreparedWorkflow,
  WorkflowRefreshPendingError,
} from '../../../production-flow/production-flow.transaction';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  StatusTabs,
  T,
  TechnicalDetails,
} from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';
import { textError, futureDateError } from '../../../validation/form-validation';

const claimOptions = INGREDIENT_REQUEST_CLAIMS;
const statuses = [
  'Unknown',
  'Awaiting response',
  'Evidence received',
  'Satisfactory',
  'Declined',
  'Rejected',
  'Cancelled',
];

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
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'pending' | 'presented' | 'verified' | 'unavailable'
  >('all');
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
  const load = async () => {
    const [available, current, orders] = await Promise.all([
      listRetailerEvidenceOptions(),
      listEvidenceRequests(),
      getOrders(),
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
  const visibleRequests = requests.filter(
    (request) => statusFilter === 'all' || evidenceGroup(request) === statusFilter,
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
      await sendEvidenceRequestMessage(await getEvidenceDetails(completed.requestId));
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
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {!embedded && (
        <SectionTitle
          title="Ingredient evidence"
          sub="Request selective evidence from the original Supplier of an ingredient linked to a received product."
          action={
            <Btn variant="outline" icon={<RefreshCw size={16} />} onClick={() => void load()}>
              Refresh
            </Btn>
          }
        />
      )}
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
      <Card className="evidence-request-composer">
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ fontSize: 12, color: T.text2 }}>
            Product and linked ingredient
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 6, padding: 10 }}
            >
              <option value="">Select an authorized product ingredient</option>
              {options.map((option) => (
                <option
                  key={`${option.productBatchId}:${option.ingredientBatchId}`}
                  value={`${option.productBatchId}:${option.ingredientBatchId}`}
                >
                  {option.productName ?? `Product ${shortChainId(option.productBatchId)}`} ·{' '}
                  {option.ingredientName ?? `Ingredient ${shortChainId(option.ingredientBatchId)}`}{' '}
                  · {option.supplierName ?? shortChainId(option.supplier)}
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <div className="evidence-request-summary">
              <CatalogueImage
                path={catalogueProduct(catalogue, chosen.productBatchId)?.imagePath}
                category={catalogueProduct(catalogue, chosen.productBatchId)?.category ?? 'Product'}
                alt={`${chosen.productName ?? 'Product'} image`}
              />
              <div>
                <strong>{chosen.productName ?? 'Registered product'}</strong>
                <span>{chosen.productBatchReference ?? shortChainId(chosen.productBatchId)}</span>
                <span>
                  Linked ingredient:{' '}
                  {chosen.ingredientName ?? shortChainId(chosen.ingredientBatchId)}
                </span>
                <span className="workspace-company-cell">
                  <CompanyAvatar name={chosen.supplierName ?? 'Original Supplier'} size="sm" />
                  {chosen.supplierName ?? 'Original Supplier'}
                </span>
              </div>
            </div>
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
          <fieldset style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
            <legend>Requested claims</legend>
            {claimOptions.map(([name, label]) => (
              <label
                key={name}
                className="my-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]"
              >
                <span>{label}</span>
                <select
                  aria-label={`${label} requirement`}
                  value={choices[name] ?? 'none'}
                  onChange={(event) =>
                    setChoices((current) => ({
                      ...current,
                      [name]: event.target.value as 'none' | 'optional' | 'required',
                    }))
                  }
                >
                  <option value="none">Not requested</option>
                  <option value="optional">Optional</option>
                  <option value="required">Required</option>
                </select>
              </label>
            ))}
          </fieldset>
          <Input label="Reason" value={reason} onChange={setReason} required />
          <Input label="Response deadline" type="date" value={dueAt} onChange={setDueAt} required />
          <Btn
            disabled={!chosen || !dueAt || !reason.trim() || Boolean(busy)}
            onClick={() => void requestEvidence()}
          >
            {busy === 'request' ? 'Confirming…' : 'Request evidence with MetaMask'}
          </Btn>
        </div>
      </Card>
      <StatusTabs
        label="Filter ingredient evidence requests"
        value={statusFilter}
        onChange={setStatusFilter}
        variant="connected"
        tabs={[
          { value: 'all', label: 'All', count: requests.length },
          {
            value: 'pending',
            label: 'Pending',
            count: requests.filter((row) => evidenceGroup(row) === 'pending').length,
          },
          {
            value: 'presented',
            label: 'Presented',
            count: requests.filter((row) => evidenceGroup(row) === 'presented').length,
          },
          {
            value: 'verified',
            label: 'Verified',
            count: requests.filter((row) => evidenceGroup(row) === 'verified').length,
          },
          {
            value: 'unavailable',
            label: 'Rejected / unavailable',
            count: requests.filter((row) => evidenceGroup(row) === 'unavailable').length,
          },
        ]}
      />
      {requests.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 size={28} />}
          title="No Retailer evidence requests"
          sub="Requests for linked ingredients will appear here."
        />
      ) : !visibleRequests.length ? (
        <EmptyState
          icon={<FileCheck2 size={28} />}
          title="No requests match this status"
          sub="Choose another status to see your other ingredient evidence requests."
        />
      ) : (
        <div className="evidence-request-list">
          {visibleRequests.map((request) => {
            const context = options.find(
              (option) =>
                option.ingredientBatchId.toLowerCase() ===
                  request.ingredientBatchId.toLowerCase() &&
                (!request.productBatchId ||
                  option.productBatchId.toLowerCase() === request.productBatchId.toLowerCase()),
            );
            const product = request.productBatchId
              ? catalogueProduct(catalogue, request.productBatchId)
              : undefined;
            return (
              <article className="evidence-request-card" key={request.requestId}>
                <CatalogueImage
                  path={product?.imagePath}
                  category={product?.category ?? 'Product'}
                  alt={`${context?.productName ?? product?.name ?? 'Product'} image`}
                />
                <div className="evidence-request-card__content">
                  <div className="evidence-request-card__heading">
                    <div>
                      <h3>{context?.productName ?? product?.name ?? 'Registered product'}</h3>
                      <p>
                        {context?.productBatchReference ??
                          product?.batchReference ??
                          'Product reference unavailable'}
                      </p>
                    </div>
                    <Badge
                      label={statuses[request.status] ?? 'Unknown'}
                      variant={
                        request.status === 3
                          ? 'active'
                          : request.status === 2
                            ? 'verified'
                            : 'pending'
                      }
                    />
                  </div>
                  <dl className="workspace-record-facts">
                    <div>
                      <dt>Linked ingredient</dt>
                      <dd>{context?.ingredientName ?? shortChainId(request.ingredientBatchId)}</dd>
                    </div>
                    <div>
                      <dt>Original Supplier</dt>
                      <dd>{request.supplierName ?? shortChainId(request.supplier)}</dd>
                    </div>
                    <div>
                      <dt>Response deadline</dt>
                      <dd>{chainDate(request.dueAt)}</dd>
                    </div>
                    <div>
                      <dt>Next action</dt>
                      <dd>{evidenceNextAction(request)}</dd>
                    </div>
                  </dl>
                  <div className="evidence-request-card__actions">
                    {request.status >= 2 && (
                      <Btn
                        size="xs"
                        variant="outline"
                        onClick={() => void openReview(request.requestId)}
                      >
                        View evidence
                      </Btn>
                    )}
                  </div>
                  <TechnicalDetails
                    fields={[
                      { label: 'Request ID', value: request.requestId },
                      {
                        label: 'Product batch ID',
                        value: request.productBatchId ?? 'Not recorded',
                      },
                      { label: 'Ingredient batch ID', value: request.ingredientBatchId },
                    ]}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
      {review && (
        <Card>
          <h3 style={{ marginTop: 0 }}>Retailer evidence review</h3>
          <Badge
            label={review.verification.state === 'PASSED' ? 'Verification passed' : 'Unverified'}
            variant={review.verification.state === 'PASSED' ? 'verified' : 'pending'}
          />
          <Alert
            type="warning"
            message="Supplier declarations are not independent laboratory or certification-body proof. Verification and the Retailer decision remain separate."
          />
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <Btn onClick={() => void verify()} disabled={Boolean(busy)}>
              Verify evidence
            </Btn>
            <Btn
              onClick={() => void decide(true)}
              disabled={review.verification.state !== 'PASSED' || Boolean(busy)}
            >
              Evidence satisfactory
            </Btn>
            <Input label="Rejection reason" value={rejectReason} onChange={setRejectReason} />
            <div className="action-row">
              <Btn
                variant="outline"
                onClick={() => void decide(false)}
                disabled={!rejectReason.trim() || Boolean(busy)}
              >
                Reject evidence
              </Btn>
            </div>
            <Btn variant="ghost" onClick={() => setReview(undefined)}>
              Close
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
function message(cause: unknown) {
  return reportError(cause, 'The evidence workflow failed.');
}

function catalogueProduct(catalogue: OrderRecord[], batchId: string) {
  return catalogue.find((item) =>
    item.batches?.some((id: string) => id.toLowerCase() === batchId.toLowerCase()),
  );
}

function evidenceGroup(request: ProductionEvidenceRequest) {
  if (request.status === 2 && request.verification?.state !== 'PASSED') return 'presented';
  if (request.status === 3 || request.verification?.state === 'PASSED') return 'verified';
  if ([4, 5, 6].includes(request.status)) return 'unavailable';
  return 'pending';
}

function evidenceNextAction(request: ProductionEvidenceRequest) {
  if (request.status === 2 && request.verification?.state !== 'PASSED')
    return 'Verify the Supplier presentation, then record a separate decision.';
  if (request.status === 3) return 'Evidence was accepted; no further action is required.';
  if ([4, 5, 6].includes(request.status)) return 'This request is no longer actionable.';
  return 'Waiting for the original Supplier to present the requested evidence.';
}
