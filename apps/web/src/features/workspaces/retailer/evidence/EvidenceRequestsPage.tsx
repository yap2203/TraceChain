import { useEffect, useState } from 'react';
import { FileCheck2 } from 'lucide-react';

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
import { completePreparedWorkflow } from '../../../production-flow/production-flow.transaction';
import { CompanyIdentityProofAction } from '../../../production-flow/CompanyIdentityProofAction';
import {
  Alert,
  Badge,
  Btn,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  T,
  Table,
  TD,
  TR,
} from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';

const claimOptions = [
  ['countryOfOrigin', 'Country of origin'],
  ['exactSourceFacility', 'Exact source facility'],
  ['productionDate', 'Production date'],
  ['expiryDate', 'Expiry date'],
  ['allergenDeclaration', 'Allergen declaration'],
  ['certificationDetails', 'Certification details'],
  ['qualityTestSummary', 'Quality test summary'],
  ['internalQualityRemarks', 'Internal quality remarks'],
] as const;
const statuses = [
  'Unknown',
  'Awaiting response',
  'Evidence received',
  'Satisfactory',
  'Declined',
  'Rejected',
  'Cancelled',
];

export function RetailerEvidenceRequests() {
  const [options, setOptions] = useState<RetailerEvidenceOption[]>([]);
  const [requests, setRequests] = useState<ProductionEvidenceRequest[]>([]);
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('Retail product ingredient traceability review');
  const [dueAt, setDueAt] = useState('');
  const [choices, setChoices] = useState<Record<string, 'none' | 'optional' | 'required'>>({
    countryOfOrigin: 'required',
    expiryDate: 'required',
  });
  const [review, setReview] = useState<EvidenceReview>();
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => {
    const [available, current] = await Promise.all([
      listRetailerEvidenceOptions(),
      listEvidenceRequests(),
    ]);
    setOptions(available.options);
    setRequests(current.requests);
  };
  useEffect(() => {
    void load().catch((cause) => setError(message(cause)));
  }, []);
  const chosen = options.find(
    (item) => `${item.productBatchId}:${item.ingredientBatchId}` === selected,
  );
  const requestEvidence = async () => {
    if (!chosen) return;
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
      setError(message(cause));
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
      setError(message(cause));
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <SectionTitle
        title="Evidence Requests"
        sub="Request selective evidence from the original Supplier of an ingredient linked to a product received by this Retailer"
      />
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      <Card>
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
                  Product {shortChainId(option.productBatchId)} · Ingredient{' '}
                  {shortChainId(option.ingredientBatchId)} ·{' '}
                  {option.supplierName ?? shortChainId(option.supplier)}
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <Alert
              type="info"
              message={`Recipient: ${chosen.supplierName ?? shortChainId(chosen.supplier)}, the authoritative original Supplier. The Manufacturer is not redistributing this credential.`}
            />
          )}
          <fieldset style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
            <legend>Requested claims</legend>
            {claimOptions.map(([name, label]) => (
              <label
                key={name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 150px',
                  gap: 10,
                  margin: '7px 0',
                }}
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
      {requests.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 size={42} />}
          title="No Retailer evidence requests"
          sub="Requests for linked ingredients will appear here."
        />
      ) : (
        <Card padding="0">
          <Table headers={['Supplier', 'Ingredient', 'Due', 'Status', '']}>
            {requests.map((request) => (
              <TR key={request.requestId}>
                <TD>{request.supplierName ?? shortChainId(request.supplier)}</TD>
                <TD mono>{shortChainId(request.ingredientBatchId)}</TD>
                <TD muted>{chainDate(request.dueAt)}</TD>
                <TD>
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
                </TD>
                <TD>
                  <CompanyIdentityProofAction requestId={request.requestId} />
                  {request.status >= 2 && (
                    <Btn
                      size="xs"
                      variant="outline"
                      onClick={() => void openReview(request.requestId)}
                    >
                      View evidence
                    </Btn>
                  )}
                </TD>
              </TR>
            ))}
          </Table>
        </Card>
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
                <b>{key}</b>: {Array.isArray(value) ? value.join(', ') : String(value)}
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
            <Btn
              variant="outline"
              onClick={() => void decide(false)}
              disabled={!rejectReason.trim() || Boolean(busy)}
            >
              Reject evidence
            </Btn>
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
  return cause instanceof Error ? cause.message : 'The evidence workflow failed.';
}
