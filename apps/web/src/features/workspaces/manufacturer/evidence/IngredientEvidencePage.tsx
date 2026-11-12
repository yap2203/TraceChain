import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FileCheck } from 'lucide-react';

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
  StatCard,
  T,
  Table,
  TD,
  TR,
} from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';
import { textError, futureDateError } from '../../../validation/form-validation';

const statuses = [
  'Unknown',
  'Awaiting response',
  'Evidence received',
  'Accepted',
  'Declined',
  'Rejected',
  'Cancelled',
];

const selectableClaims = [
  ['countryOfOrigin', 'Country of origin'],
  ['exactSourceFacility', 'Exact source facility'],
  ['productionDate', 'Production date'],
  ['expiryDate', 'Expiry date'],
  ['allergenDeclaration', 'Allergen declaration'],
  ['certificationDetails', 'Certification details'],
  ['qualityTestSummary', 'Quality test summary'],
  ['internalQualityRemarks', 'Internal quality remarks'],
] as const;

export function IngredientEvidence({
  onNav: _onNav,
  hideComposer = false,
  requestId,
}: {
  onNav: (target: string) => void;
  hideComposer?: boolean;
  requestId?: string;
}) {
  const [ingredients, setIngredients] = useState<ProductionIngredient[]>([]);
  const [requests, setRequests] = useState<ProductionEvidenceRequest[]>([]);
  const [batchId, setBatchId] = useState('');
  const [reason, setReason] = useState('Product ingredient traceability verification');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [verified, setVerified] = useState<Record<string, string>>({});
  const [review, setReview] = useState<EvidenceReview>();
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
          if (active)
            setError(cause instanceof Error ? cause.message : 'Request details are unavailable.');
        });
    return () => {
      active = false;
    };
  }, [hideComposer, requestId]);
  const [rejectReason, setRejectReason] = useState('');
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
    void load().catch((cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not load evidence records.'),
    );
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
          dueAt: new Date(`${dueAt}T23:59:59`).toISOString(),
          operationId,
          reason,
        }),
      );
      if (!completed.requestId) throw new Error('The confirmed request ID is unavailable.');
      try {
        await sendEvidenceRequestMessage(await getEvidenceDetails(completed.requestId));
        setNotice('The request is confirmed on chain and its encrypted DIDComm message was sent.');
      } catch (deliveryError) {
        setNotice('The request is confirmed on chain.');
        setError(
          deliveryError instanceof Error
            ? deliveryError.message
            : 'Encrypted DIDComm delivery is pending.',
        );
      }
      setBatchId('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request failed.');
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
      setError(cause instanceof Error ? cause.message : 'Evidence acceptance failed.');
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
      setError(cause instanceof Error ? cause.message : 'Evidence verification failed.');
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
      setError(cause instanceof Error ? cause.message : 'Could not load received evidence.');
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
      setError(cause instanceof Error ? cause.message : 'Evidence rejection failed.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <SectionTitle
        title={hideComposer ? 'Ingredient evidence request' : 'Ingredient Evidence'}
        sub="Real EvidenceRegistry requests and challenge-bound Supplier presentations"
      />
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {hideComposer && details && (
        <Card>
          <h3>Requested information</h3>
          <p>Ingredient batch: {details.batchId}</p>
          <p>Reason: {details.reason}</p>
          <p>Necessary claims: {details.requiredClaims.join(', ') || 'None'}</p>
          <p>
            Optional claims:{' '}
            {details.claims.filter((claim) => !details.requiredClaims.includes(claim)).join(', ') ||
              'None'}
          </p>
        </Card>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 14 }}>
        <StatCard
          label="Awaiting Supplier"
          value={requests.filter((item) => item.status === 1).length}
          color={T.amber}
          icon={<Clock size={20} />}
        />
        <StatCard
          label="Ready for Review"
          value={requests.filter((item) => item.status === 2).length}
          color={T.teal}
          icon={<FileCheck size={20} />}
        />
        <StatCard
          label="Accepted"
          value={requests.filter((item) => item.status === 3).length}
          color={T.green}
          icon={<CheckCircle2 size={20} />}
        />
      </div>
      {!hideComposer && (
        <Card>
          <div style={{ fontWeight: 700, color: T.navy, marginBottom: 12 }}>
            Request evidence for an active Supplier batch
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ fontSize: 12, color: T.text2 }}>
              Ingredient batch
              <select
                value={batchId}
                onChange={(event) => setBatchId(event.target.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 6,
                  padding: 10,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                }}
              >
                <option value="">Select a real on-chain batch</option>
                {ingredients
                  .filter((item) => !item.accepted)
                  .map((item) => (
                    <option key={item.batchId} value={item.batchId}>
                      {item.supplierName ?? 'Verified Supplier'} · {shortChainId(item.batchId)} ·{' '}
                      {item.availableQuantity} available
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
            <fieldset style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12 }}>
              <legend style={{ color: T.navy, fontWeight: 700 }}>Requested claims</legend>
              <div style={{ fontSize: 12, color: T.text2, marginBottom: 10 }}>
                Batch identity, ingredient name, Supplier wallet and credential ID are always
                shared. Choose whether each additional claim is required or optional for the
                Supplier.
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {selectableClaims.map(([name, label]) => (
                  <label
                    key={name}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 12 }}
                  >
                    <span>{label}</span>
                    <select
                      aria-label={`${label} requirement`}
                      value={claimChoices[name] ?? 'none'}
                      onChange={(event) =>
                        setClaimChoices((current) => ({
                          ...current,
                          [name]: event.target.value as 'required' | 'optional' | 'none',
                        }))
                      }
                    >
                      <option value="none">Not requested</option>
                      <option value="optional">Optional</option>
                      <option value="required">Required</option>
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
            <Alert
              type="info"
              message="The request details and random challenge are encrypted before upload. Only their hashes and encrypted content reference are recorded on chain."
            />
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
        </Card>
      )}
      {requests.length === 0 ? (
        <EmptyState
          icon={<FileCheck size={42} />}
          title="No real evidence requests"
          sub="Select an active Supplier ingredient batch to begin."
        />
      ) : (
        <Card padding="0">
          <Table headers={['Supplier', 'Due', 'Status', '']}>
            {requests.map((request) => (
              <TR key={request.requestId}>
                <TD>{request.supplierName ?? 'Verified Supplier'}</TD>
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
                  <CompanyIdentityProofAction requestId={request.requestId} role="manufacturer" />
                  {request.status >= 2 && (
                    <Btn
                      size="xs"
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => void view(request.requestId)}
                    >
                      {busy === `view:${request.requestId}` ? 'Loading…' : 'View evidence'}
                    </Btn>
                  )}
                  {request.status === 2 && (
                    <Btn
                      size="xs"
                      disabled={Boolean(busy)}
                      onClick={() => void verify(request.requestId)}
                    >
                      {busy === request.requestId ? 'Verifying…' : 'Verify evidence'}
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'start',
              marginBottom: 14,
            }}
          >
            <div>
              <h3 style={{ margin: 0, color: T.navy }}>Received ingredient evidence</h3>
              <div style={{ color: T.text2, fontSize: 13, marginTop: 4 }}>
                {review.supplierName ?? 'Verified Supplier'} · {shortChainId(review.batchId)}
              </div>
            </div>
            <Badge
              label={review.verification.state === 'PASSED' ? 'Verification passed' : 'Unverified'}
              variant={review.verification.state === 'PASSED' ? 'verified' : 'pending'}
            />
          </div>
          <Alert
            type="warning"
            message={
              review.verification.state === 'PASSED'
                ? `${review.disclosure === 'SELECTIVE_SD_JWT' ? 'Selective disclosure' : 'Full disclosure'}: the displayed claims passed the cryptographic, holder-binding, challenge, and on-chain checks.`
                : `${review.disclosure === 'SELECTIVE_SD_JWT' ? 'Selective disclosure' : 'Full disclosure'}: these visible claim values remain unverified until you select Verify evidence.`
            }
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
              gap: 12,
              marginTop: 14,
            }}
          >
            {[
              ['Supplier', review.supplierName ?? review.supplier],
              ...Object.entries(review.sharedClaims).map(([label, value]) => [
                label,
                Array.isArray(value) ? value.join(', ') : String(value ?? 'Unavailable'),
              ]),
              ['Presentation expiry', new Date(review.presentationExpiry).toLocaleString()],
              [
                'Credential expiry',
                review.credentialExpiry === 'Unavailable'
                  ? 'Unavailable'
                  : new Date(review.credentialExpiry).toLocaleString(),
              ],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: 10, background: T.surface2, borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: T.text2 }}>{label}</div>
                <div style={{ marginTop: 4, overflowWrap: 'anywhere' }}>{value}</div>
              </div>
            ))}
          </div>
          {review.verification.verifiedAt && (
            <div style={{ marginTop: 12, fontSize: 12, color: T.text2 }}>
              Last verified: {new Date(review.verification.verifiedAt).toLocaleString()}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
            <Btn disabled={Boolean(busy)} onClick={() => void verify(review.requestId)}>
              Verify evidence
            </Btn>
            <Btn
              disabled={
                review.status !== 2 || review.verification.state !== 'PASSED' || Boolean(busy)
              }
              onClick={() => void accept(review.requestId)}
            >
              Accept evidence
            </Btn>
            <Input
              label="Rejection reason"
              maxLength={500}
              value={rejectReason}
              onChange={setRejectReason}
              placeholder="Required to reject"
            />
            <Btn
              variant="outline"
              disabled={review.status !== 2 || !rejectReason.trim() || Boolean(busy)}
              onClick={() => void reject()}
            >
              Reject evidence
            </Btn>
            <Btn variant="ghost" onClick={() => setReview(undefined)}>
              Close review
            </Btn>
          </div>
        </Card>
      )}
    </div>
  );
}
