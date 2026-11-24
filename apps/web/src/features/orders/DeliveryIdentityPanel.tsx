import { signCompanyPresentation } from '../production-flow/company-presentation';
import {
  COMPANY_ALWAYS_CLAIMS,
  COMPANY_EVIDENCE_CLAIMS,
  toggleCompanyDisclosure,
} from '@tracechain/shared';
import { reportError } from '../../components/ui/feedback';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { deliveryIdentity, type OrderRecord, type OrdersState } from './orders.api';
import {
  Alert,
  Badge,
  Btn,
  ClaimRow,
  Modal,
  TechnicalDetails,
} from '../workspaces/shared/ui';
import type { BadgeVariant } from '../workspaces/shared/ui/Badge';
import { PresentationSigningSettingsLink } from '../didcomm/HolderSigningKeyPanel';
import { submitProductionTransaction } from '../production-flow/production-flow.transaction';
import { EvidenceRequestModal } from './EvidenceRequestModal';
import { normalizeCompanyRequestFields } from '../production-flow/CompanyRequestFields';
import {
  classifyEvidenceClaims,
  evidenceClaimLists,
  type ClaimClassification,
} from '../production-flow/EvidenceClaimSelector';

export function DeliveryIdentityPanel({
  order,
  data,
  onChanged,
  requestedBy,
  hideRefresh = false,
  requestOnly = false,
  onRequestClose,
  requestContextLabel = 'custody offer',
}: {
  order: OrderRecord;
  data: OrdersState;
  onChanged: () => Promise<void>;
  requestedBy?: string;
  hideRefresh?: boolean;
  requestOnly?: boolean;
  onRequestClose?: () => void;
  requestContextLabel?: string;
}) {
  const sellerLabel = order.productDelivery ? 'Manufacturer' : 'Supplier';
  const supplier = data.actor.toLowerCase() === order.seller.toLowerCase();
  const [status, setStatus] = useState<any>(),
    [material, setMaterial] = useState<any>();
  const [purpose, setPurpose] = useState(
    'Verify seller company identity before collecting or dispatching these goods',
  );
  const [requestFields, setRequestFields] = useState<Record<string, ClaimClassification>>(() =>
    classifyEvidenceClaims(
      COMPANY_EVIDENCE_CLAIMS.map((claim) => claim.id),
      COMPANY_ALWAYS_CLAIMS,
      [],
    ),
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(requestOnly);
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const pending = useRef(false);
  const refresh = async () =>
    setStatus(await deliveryIdentity(order.orderId, { action: 'status' }));
  useEffect(() => {
    let active = true;
    void deliveryIdentity(order.orderId, { action: 'status' })
      .then((result) => {
        if (active) {
          setStatus(result);
          if (result.purpose) setPurpose(result.purpose);
          if (result.requiredClaims || result.optionalClaims)
            setRequestFields(
              classifyEvidenceClaims(
                COMPANY_EVIDENCE_CLAIMS.map((claim) => claim.id),
                result.requiredClaims ?? COMPANY_ALWAYS_CLAIMS,
                result.optionalClaims ?? [],
              ),
            );
        }
      })
      .catch((cause) => {
        if (!active) return;
        if (/not found|not requested|request company identity first/i.test(cause.message))
          setStatus({ status: 'NOT_REQUESTED' });
        else setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [order.orderId, order.delivery.identityChallenge, order.delivery.identityCredentialHash]);
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
      await onChanged();
    } catch (cause) {
      setError(reportError(cause, 'Company proof could not be processed.'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const submit = async (result: any) => {
    if (result.transaction) await submitProductionTransaction(result.transaction, data.actor);
  };
  const rawStatus = status?.status ?? 'NOT_REQUESTED';
  const completed = ['PRESENTED', 'SHARED', 'VERIFIED'].includes(rawStatus);
  const failed = ['DECLINED', 'REJECTED', 'EXPIRED', 'UNAVAILABLE'].includes(rawStatus);
  const recipient =
    requestedBy ?? companyName(data, order.delivery.distributor) ?? 'Counterparty company';
  const evidenceHolder = companyName(data, order.seller) ?? sellerLabel;
  const requesterCompany = companyName(data, data.actor) ?? requestedBy ?? 'Your company';
  const requesterRole = companyRole(data, data.actor) ?? String(data.role ?? '');
  const holderRole = companyRole(data, order.seller) ?? sellerLabel;
  const requestClaims = evidenceClaimLists(requestFields);
  const claimValues: Record<string, unknown> = material
    ? (material.claims ?? material.credential?.credentialSubject ?? {})
    : {};
  const claimNames = Object.keys(claimValues);
  const requiredClaims: string[] = material
    ? material.format === 'COMPANY_IDENTITY_SD_JWT'
      ? [...new Set<string>(material.requiredClaims ?? [])]
      : claimNames
    : [];
  const optionalClaims = claimNames.filter((claim) => !requiredClaims.includes(claim));
  const selectedClaims = claimNames.filter((claim) => selected.includes(claim));
  const requiredAvailable = requiredClaims.every(
    (claim) => claim in claimValues && claimValueAvailable(claimValues[claim]),
  );
  const expiresAt = Number(material?.expiresAt ?? status?.expiresAt ?? 0);
  const requestedRequired = Array.isArray(status?.requiredClaims)
    ? status.requiredClaims.length
    : undefined;
  const requestedOptional = Array.isArray(status?.optionalClaims)
    ? status.optionalClaims.length
    : undefined;
  const expired = rawStatus === 'EXPIRED' || (expiresAt > 0 && expiresAt <= Date.now() / 1000);
  const expiryBadge = rawStatus === 'EXPIRED' ? undefined : expiryStatus(expiresAt, expired);
  const declineRequest = () =>
    run(async () => {
      await submit(await deliveryIdentity(order.orderId, { action: 'decline' }));
      setMaterial(undefined);
      setReviewOpen(false);
    });
  const loadMaterial = () =>
    run(async () => {
      const value = await deliveryIdentity(order.orderId, { action: 'material' });
      const names = Object.keys(value.claims ?? value.credential?.credentialSubject ?? {});
      setMaterial(value);
      setSelected(
        value.format === 'COMPANY_IDENTITY_SD_JWT'
          ? [...new Set<string>(value.requiredClaims ?? [])]
          : names,
      );
    });
  const signAndShare = () =>
    run(async () => {
      const presentation = await signCompanyPresentation(material, selectedClaims);
      await submit(await deliveryIdentity(order.orderId, { action: 'present', presentation }));

      setReviewOpen(false);
      setMaterial(undefined);
      setNotice('Company proof sent securely to the assigned Distributor.');
    });
  const closeRequest = () => {
    setRequestOpen(false);
    onRequestClose?.();
  };
  const requestDialog = requestOpen && (
    <EvidenceRequestModal
      evidenceType="Company identity"
      requester={requesterCompany}
      requesterRole={formatRole(requesterRole)}
      recipient={evidenceHolder}
      recipientRole={formatRole(holderRole)}
      reference={order.orderId}
      catalogue={COMPANY_EVIDENCE_CLAIMS}
      required={requestClaims.required}
      optional={requestClaims.optional}
      purpose={purpose}
      deadline={deadline}
      contextDeadline={Number(order.expiresAt)}
      contextDeadlineLabel={requestContextLabel}
      busy={busy}
      onClose={closeRequest}
      onChange={(value) => {
        setRequestFields(
          classifyEvidenceClaims(
            COMPANY_EVIDENCE_CLAIMS.map((claim) => claim.id),
            [...COMPANY_ALWAYS_CLAIMS, ...value.required],
            value.optional,
          ),
        );
        setPurpose(value.purpose);
        setDeadline(value.deadline);
      }}
      onSubmit={() => void run(async () => {
        const expiresAt = Math.floor(Date.parse(deadline) / 1000);
        const payload = normalizeCompanyRequestFields(
          requestClaims.required,
          requestClaims.optional,
        );
        await submit(await deliveryIdentity(order.orderId, {
          action: 'request',
          purpose: purpose.trim(),
          expiresAt,
          required: true,
          requiredClaims: payload.required,
          optionalClaims: payload.optional,
        }));
        closeRequest();
        setNotice(`${sellerLabel} evidence requested through encrypted IPFS references.`);
      })}
    />
  );
  if (requestOnly) {
    if (error)
      return (
        <Modal title="Request company evidence" onClose={closeRequest} width={520}>
          <Alert type="error" message={error} />
        </Modal>
      );
    if (!status)
      return (
        <Modal title="Request company evidence" onClose={closeRequest} width={520}>
          <p role="status">Checking the current evidence-request status…</p>
        </Modal>
      );
    if (rawStatus !== 'NOT_REQUESTED')
      return (
        <Modal title="Company evidence" onClose={closeRequest} width={520}>
          <div className="grid gap-[14px]">
            <Badge label={proofStatusLabel(rawStatus)} variant={proofStatusVariant(rawStatus)} />
            <p>{proofStatusExplanation(rawStatus)}</p>
            <div className="action-row justify-end">
              <Btn variant="outline" onClick={closeRequest}>Close</Btn>
            </div>
          </div>
        </Modal>
      );
    return requestDialog;
  }
  return (
    <section className="company-evidence-card" aria-label={`${sellerLabel} company evidence`}>
      <header className="company-evidence-card__heading">
        <div>
          <span>Evidence type</span>
          <h3>{sellerLabel} company evidence</h3>
        </div>
        <div className="company-evidence-card__badges">
          <Badge label={proofStatusLabel(rawStatus)} variant={proofStatusVariant(rawStatus)} />
          {expiryBadge && <Badge label={expiryBadge.label} variant={expiryBadge.variant} />}
        </div>
      </header>
      <dl className="company-evidence-card__facts">
        <div><dt>{supplier ? 'Requested by' : 'Recipient company'}</dt><dd>{supplier ? recipient : evidenceHolder}</dd></div>
        <div><dt>Recipient role</dt><dd>{holderRole}</dd></div>
        <div><dt>Related custody reference</dt><dd>{shortEvidenceReference(order.orderId)}</dd></div>
        <div>
          <dt>Evidence type</dt>
          <dd>Company identity</dd>
        </div>
        <div>
          <dt>{rawStatus === 'NOT_REQUESTED' ? 'Suggested purpose' : 'Purpose'}</dt>
          <dd>{material?.purpose ?? status?.purpose ?? purpose}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{proofStatusLabel(rawStatus)}</dd>
        </div>
        {rawStatus !== 'NOT_REQUESTED' && requestedRequired !== undefined && (
          <div>
            <dt>Requested fields</dt>
            <dd>
              {requestedRequired + (requestedOptional ?? 0)} fields · {requestedRequired} required
              {requestedOptional !== undefined ? ` · ${requestedOptional} optional` : ''}
            </dd>
          </div>
        )}
        {rawStatus !== 'NOT_REQUESTED' && <div><dt>Deadline</dt><dd>{expiresAt ? formatEvidenceDate(expiresAt) : 'Not recorded'}</dd></div>}
        {status?.verifiedAt && <div><dt>Verified</dt><dd>{formatEvidenceDate(status.verifiedAt)}</dd></div>}
      </dl>
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {rawStatus === 'NOT_REQUESTED' ? (
        <p className="company-evidence-card__empty-copy">
          Request verified company information from the supplier before collecting or dispatching this stock.
        </p>
      ) : <div className="company-evidence-card__next">
        <div>
          <span>What this means</span>
          <p>{proofStatusExplanation(rawStatus)}</p>
        </div>
        <div>
          <span>Next required action</span>
          <strong>{proofNextAction(rawStatus, supplier)}</strong>
        </div>
      </div>}
      {!supplier && rawStatus === 'NOT_REQUESTED' && (
        <div className="company-evidence-card__request-form">
          <div className="company-evidence-card__actions action-row">
            <Btn
              disabled={
                busy ||
                !purpose.trim() ||
                ['PRESENTED', 'VERIFIED'].includes(status?.status) ||
                (status?.status === 'REQUESTED' &&
                  !!order.delivery.identityChallenge &&
                  !/^0x0+$/.test(order.delivery.identityChallenge))
              }
              onClick={() => setRequestOpen(true)}
            >
              Create evidence request
            </Btn>
            {['PRESENTED', 'VERIFIED'].includes(status?.status) && (
              <Btn
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await deliveryIdentity(order.orderId, { action: 'verify' });
                    await submit(result);
                    setStatus(result);
                    setNotice(`Proof checked: ${result.checks?.join(', ') ?? 'Verified'}`);
                  })
                }
              >
                Verify {sellerLabel} proof & record result
              </Btn>
            )}
          </div>
          {requestDialog}
        </div>
      )}
      {!supplier && rawStatus === 'NOT_REQUESTED' && (
        <p className="company-evidence-separation-note">
          Evidence sharing does not accept the custody offer or move stock.
        </p>
      )}
      {supplier && status?.status === 'REQUESTED' && !material && (
        <div className="company-evidence-card__footer">
          <div>
            <Btn variant="outline" disabled={busy} onClick={() => void declineRequest()}>
              Decline request
            </Btn>
            <Btn
              size="sm"
              variant="outline"
              icon={<RefreshCw size={14} />}
              disabled={busy}
              onClick={() => void run(refresh)}
            >
              Refresh status
            </Btn>
          </div>
          <Btn disabled={busy || expired} onClick={() => void loadMaterial()}>
            Review request
          </Btn>
        </div>
      )}
      {supplier && material && (
        <div className="company-evidence-card__material">
          <Alert
            type="warning"
            message={
              material.format === 'COMPANY_IDENTITY_SD_JWT'
                ? 'Review the claims and choose optional fields to share. The proof is bound to this Distributor, request, purpose, challenge and expiry.'
                : 'Full disclosure: this presentation includes your entire signed Company Role Credential. Individual fields cannot be hidden in this format.'
            }
          />
          <section className="company-evidence-claims" aria-labelledby="required-claims-title">
            <div className="company-evidence-claims__heading">
              <div>
                <h4 id="required-claims-title">Required information</h4>
                <p>Required by the requesting company</p>
              </div>
              <strong>{requiredClaims.length}</strong>
            </div>
            <div className="company-evidence-claims__list">
              {requiredClaims.map((claim) => (
                <ClaimRow
                  key={claim}
                  label={friendlyClaim(claim)}
                  value={displayClaimValue(claim, claimValues[claim])}
                  requirement={
                    (COMPANY_ALWAYS_CLAIMS as readonly string[]).includes(claim)
                      ? 'always'
                      : 'required'
                  }
                  included
                  locked
                  technical={technicalClaim(claim)}
                />
              ))}
            </div>
          </section>
          <section className="company-evidence-claims" aria-labelledby="optional-claims-title">
            <div className="company-evidence-claims__heading">
              <div>
                <h4 id="optional-claims-title">Optional information</h4>
                <p>Choose the additional company information you want to share.</p>
              </div>
              {optionalClaims.length > 0 && material.format === 'COMPANY_IDENTITY_SD_JWT' && (
                <label className="company-evidence-share-all">
                  <span>Share all optional fields</span>
                  <button
                    type="button"
                    role="switch"
                    aria-label="Share all optional fields"
                    aria-checked={optionalClaims.every((claim) => selected.includes(claim))}
                    className="evidence-claim-switch"
                    onClick={() =>
                      setSelected((current) => {
                        const allSelected = optionalClaims.every((claim) =>
                          current.includes(claim),
                        );
                        return allSelected
                          ? current.filter((claim) => !optionalClaims.includes(claim))
                          : [...new Set([...current, ...optionalClaims])];
                      })
                    }
                  >
                    <span aria-hidden="true" />
                  </button>
                </label>
              )}
            </div>
            <div className="company-evidence-claims__list">
              {optionalClaims.map((claim) => (
                <ClaimRow
                  key={claim}
                  label={friendlyClaim(claim)}
                  value={displayClaimValue(claim, claimValues[claim])}
                  requirement="optional"
                  included={selected.includes(claim)}
                  locked={material.format !== 'COMPANY_IDENTITY_SD_JWT'}
                  technical={technicalClaim(claim)}
                  onToggle={() =>
                    setSelected((current) =>
                      toggleCompanyDisclosure(current, claim, !current.includes(claim)),
                    )
                  }
                />
              ))}
              {!optionalClaims.length && (
                <p className="company-evidence-claims__empty">
                  No optional company fields are available for this request.
                </p>
              )}
            </div>
          </section>
          <div className="company-evidence-preview">
            <strong>
              {selectedClaims.length} of {claimNames.length} fields will be shared
            </strong>
            <p>
              You are sharing {selectedClaims.length} company claims with {recipient}.
            </p>
            <ul>
              {selectedClaims.map((claim) => (
                <li key={claim}>{friendlyClaim(claim)}</li>
              ))}
            </ul>
            <small>The proof is only valid for this request and expires at the stated time.</small>
          </div>
          {!material.walletContext && <PresentationSigningSettingsLink
            role={order.productDelivery ? 'manufacturer' : 'supplier'}
          />}
          {material.walletContext && <p>Approve the exact selected claims with a MetaMask signature, then confirm the transaction publishing the encrypted response reference. This is separate from login and delivery approval.</p>}
          {material.binding && (
            <TechnicalDetails
              fields={Object.entries(material.binding).map(([label, value]) => ({
                label,
                value: String(value),
              }))}
            />
          )}
          {!requiredAvailable && (
            <Alert
              type="error"
              message="A required signed company field is unavailable. An older credential without registration country needs an authorized replacement; unsigned profile data cannot supply this claim. You may decline this request."
            />
          )}
          <div className="company-evidence-card__footer is-sticky">
            <div>
              <Btn variant="outline" disabled={busy} onClick={() => void declineRequest()}>
                Decline request
              </Btn>
              <Btn
                size="sm"
                variant="outline"
                icon={<RefreshCw size={14} />}
                disabled={busy}
                onClick={() => void run(refresh)}
              >
                Refresh status
              </Btn>
            </div>
            <Btn
              disabled={busy || expired || !requiredAvailable}
              onClick={() => setReviewOpen(true)}
            >
              Review and sign proof
            </Btn>
          </div>
        </div>
      )}
      {!hideRefresh && rawStatus !== 'NOT_REQUESTED' && !(supplier && status?.status === 'REQUESTED') && (
        <div className="company-evidence-card__secondary-actions">
          <Btn
            size="sm"
            variant="outline"
            icon={<RefreshCw size={14} />}
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            Refresh status
          </Btn>
        </div>
      )}
      {(completed || status?.credential || status?.checks) && (
        <details className="company-evidence-card__shared">
          <summary>View shared evidence</summary>
          {status?.checks?.length ? <p>Verification checks: {status.checks.join(', ')}</p> : null}
          {rawStatus === 'VERIFIED' && (
            <p>
              Verification records the checks at that time, not business acceptance. Protected
              actions check current company authorization again.
            </p>
          )}
          {!status?.credential && (
            <p>
              {completed
                ? 'The evidence presentation is recorded for this request.'
                : 'No readable shared claims are available.'}
            </p>
          )}
          <dl>
            {Object.entries(status?.credential ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt>{friendlyClaim(key)}</dt>
                <dd className="break-words">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {failed && status?.checks?.length ? (
        <p className="company-evidence-card__result">Result: {status.checks.join(', ')}</p>
      ) : null}
      <TechnicalDetails
        fields={[
          { label: 'Reference ID', value: order.orderId },
          { label: 'Raw proof status', value: rawStatus },
          ...(order.delivery.identityCredentialHash
            ? [
                {
                  label: 'Identity credential hash',
                  value: order.delivery.identityCredentialHash,
                },
              ]
            : []),
          ...(order.delivery.identityChallenge
            ? [{ label: 'Identity challenge', value: order.delivery.identityChallenge }]
            : []),
          ...Object.entries(claimValues)
            .filter(([claim]) => technicalClaim(claim))
            .map(([claim, value]) => ({
              label: `Full ${friendlyClaim(claim)}`,
              value: displayClaimValue(claim, value),
            })),
        ]}
      />
      {reviewOpen && material && (
        <Modal title="Review company evidence" onClose={() => setReviewOpen(false)} width={620}>
          <div className="company-evidence-review">
            <dl>
              <div>
                <dt>Recipient</dt>
                <dd>{recipient}</dd>
              </div>
              <div>
                <dt>Purpose</dt>
                <dd>{material.purpose}</dd>
              </div>
              <div>
                <dt>Expiry</dt>
                <dd>{formatEvidenceDate(material.expiresAt)}</dd>
              </div>
            </dl>
            <div>
              <h4>Claims being shared</h4>
              <ul>
                {selectedClaims.map((claim) => (
                  <li key={claim}>{friendlyClaim(claim)}</li>
                ))}
              </ul>
            </div>
            <Alert
              type="info"
              message="The proof is bound to this recipient, request, challenge and expiry. Signing does not accept the custody offer or move stock."
            />
            <div className="company-evidence-review__actions action-row">
              <Btn variant="outline" disabled={busy} onClick={() => setReviewOpen(false)}>
                Cancel
              </Btn>
              <Btn
                disabled={busy || expired || !requiredAvailable}
                onClick={() => void signAndShare()}
              >
                Sign and share
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function proofStatusLabel(status?: string) {
  return (
    {
      NOT_REQUESTED: 'Not requested',
      REQUESTED: 'Awaiting response',
      PENDING: 'Awaiting response',
      PRESENTED: 'Evidence shared',
      SHARED: 'Evidence shared',
      VERIFIED: 'Verified',
      DECLINED: 'Verification failed',
      REJECTED: 'Verification failed',
      EXPIRED: 'Expired',
      UNAVAILABLE: 'Unavailable',
    }[status ?? 'NOT_REQUESTED'] ?? 'Status unavailable'
  );
}

export function proofStatusVariant(status?: string): BadgeVariant {
  if (status === 'VERIFIED') return 'verified';
  if (['DECLINED', 'REJECTED'].includes(status ?? '')) return 'rejected';
  if (['EXPIRED', 'UNAVAILABLE'].includes(status ?? '')) return 'expired';
  if (['PRESENTED', 'SHARED'].includes(status ?? '')) return 'shared';
  if (['REQUESTED', 'PENDING'].includes(status ?? '')) return 'pending';
  return 'default';
}

function proofStatusExplanation(status: string) {
  if (status === 'NOT_REQUESTED')
    return 'No company evidence has been requested for this custody offer.';
  if (['REQUESTED', 'PENDING'].includes(status))
    return 'The requesting company is waiting for the requested company evidence.';
  if (['PRESENTED', 'SHARED'].includes(status))
    return 'Company evidence was shared and remains separate from the custody decision.';
  if (status === 'VERIFIED') return 'The shared company evidence passed verification.';
  if (['DECLINED', 'REJECTED'].includes(status))
    return 'The evidence request or verification did not complete successfully.';
  if (['EXPIRED', 'UNAVAILABLE'].includes(status))
    return 'This company evidence request is no longer available for action.';
  return 'The current evidence state could not be determined.';
}

function proofNextAction(status: string, supplier: boolean) {
  if (status === 'NOT_REQUESTED')
    return supplier ? 'No action required' : 'Create an evidence request';
  if (['REQUESTED', 'PENDING'].includes(status))
    return supplier ? 'Review and share the requested evidence' : 'Wait for the company response';
  if (['PRESENTED', 'SHARED'].includes(status))
    return supplier ? 'No action required' : 'Verify the shared evidence';
  return 'No action required';
}

function friendlyClaim(claim: string) {
  return (
    {
      companyId: 'Company ID',
      companyName: 'Company name',
      companyRegistrationNumber: 'Registration number',
      registrationCountry: 'Registration country',
      walletAddress: 'Wallet address',
      applicationReference: 'Application reference',
      role: 'Company role',
      id: 'Decentralized identity',
    }[claim] ??
    claim.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
  );
}

function displayClaimValue(claim: string, value: unknown) {
  if (!claimValueAvailable(value)) return 'Unavailable';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (claim === 'role')
    return text
      .toLocaleLowerCase()
      .split('_')
      .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
      .join(' ');
  return text;
}

function claimValueAvailable(value: unknown) {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function technicalClaim(claim: string) {
  return ['companyId', 'walletAddress', 'applicationReference', 'id'].includes(claim);
}

function expiryStatus(expiresAt: number, expired: boolean) {
  if (!expiresAt) return undefined;
  if (expired) return { label: 'Expired', variant: 'expired' as const };
  if (expiresAt - Date.now() / 1000 <= 24 * 60 * 60)
    return { label: 'Expiring soon', variant: 'pending' as const };
  return undefined;
}

function companyName(data: OrdersState, wallet?: string) {
  if (!wallet) return undefined;
  return data.companies?.find((company) => company.wallet.toLowerCase() === wallet.toLowerCase())
    ?.companyName;
}

function companyRole(data: OrdersState, wallet?: string) {
  if (!wallet) return undefined;
  return data.companies?.find((company) => company.wallet.toLowerCase() === wallet.toLowerCase())
    ?.role;
}

function formatRole(value?: string) {
  if (!value) return 'Registered company';
  return value.toLocaleLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function shortEvidenceReference(value: string) {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function formatEvidenceDate(value: string | number) {
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}
