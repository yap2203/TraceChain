import { signCompanyPresentation } from '../production-flow/company-presentation';
import {
  COMPANY_ALWAYS_CLAIMS,
  COMPANY_EVIDENCE_CLAIMS,
  toggleCompanyDisclosure,
} from '@tracechain/shared';
import { reportError } from '../../components/ui/feedback';
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { deliveryIdentity, type OrderRecord, type OrdersState } from './orders.api';
import { Alert, Badge, Btn, Modal, TechnicalDetails } from '../workspaces/shared/ui';
import {
  EvidenceDecision,
  EvidenceVerificationSummary,
  evidenceVerificationFailure,
  EvidenceFieldList,
  EvidenceHowItWorks,
  EvidenceNextStep,
  SharedClaims,
  claimValueAvailable,
  friendlyClaim,
} from './EvidenceParts';
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
  showHeading = true,
}: {
  /** False when the surrounding page already shows the title and status. */
  showHeading?: boolean;
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
    // Which action is running, so only its button shows the spinner.
    [action, setAction] = useState(''),
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
  const run = async (operation: () => Promise<void>, key = '') => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setAction(key);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
      await onChanged();
    } catch (cause) {
      setError(reportError(cause, 'Company proof could not be processed.'));
      if (key === 'verify' || key === 'accept')
        setStatus((current: any) =>
          current ? { ...current, verification: evidenceVerificationFailure(cause) } : current,
        );
    } finally {
      pending.current = false;
      setBusy(false);
      setAction('');
    }
  };
  const submit = async (result: any) => {
    if (result.transaction) await submitProductionTransaction(result.transaction, data.actor);
  };
  const rawStatus = status?.status ?? 'NOT_REQUESTED';
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
    }, 'decline');
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
    }, 'review');
  const signAndShare = () =>
    run(async () => {
      const presentation = await signCompanyPresentation(material, selectedClaims);
      await submit(await deliveryIdentity(order.orderId, { action: 'present', presentation }));

      setReviewOpen(false);
      setMaterial(undefined);
      setNotice('Company proof sent securely to the assigned Distributor.');
    }, 'share');
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
      onSubmit={() =>
        void run(async () => {
          const expiresAt = Math.floor(Date.parse(deadline) / 1000);
          const payload = normalizeCompanyRequestFields(
            requestClaims.required,
            requestClaims.optional,
          );
          await submit(
            await deliveryIdentity(order.orderId, {
              action: 'request',
              purpose: purpose.trim(),
              expiresAt,
              required: true,
              requiredClaims: payload.required,
              optionalClaims: payload.optional,
            }),
          );
          closeRequest();
          setNotice(`${sellerLabel} evidence requested through encrypted IPFS references.`);
        }, 'request')
      }
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
              <Btn variant="outline" onClick={closeRequest}>
                Close
              </Btn>
            </div>
          </div>
        </Modal>
      );
    return requestDialog;
  }
  const verify = () =>
    run(async () => {
      const result = await deliveryIdentity(order.orderId, { action: 'verify' });
      await submit(result);
      setStatus(result);
    }, 'accept');
  const reject = (reason: string) =>
    run(async () => {
      await submit(await deliveryIdentity(order.orderId, { action: 'reject', reason }));
      setNotice('Company evidence rejected.');
    }, 'reject');
  const toggleClaim = (claim: string) =>
    setSelected((current) => toggleCompanyDisclosure(current, claim, !current.includes(claim)));
  const toggleAllOptional = () =>
    setSelected((current) =>
      optionalClaims.every((claim) => current.includes(claim))
        ? current.filter((claim) => !optionalClaims.includes(claim))
        : [...new Set([...current, ...optionalClaims])],
    );
  const next = nextStep({
    status: rawStatus,
    holder: supplier,
    holderName: evidenceHolder,
    recipient,
    verifiedAt: status?.verifiedAt,
    expired,
  });
  const nextAction =
    // An expired, unverified request can be replaced by a new one.
    !supplier && (rawStatus === 'NOT_REQUESTED' || (expired && rawStatus !== 'VERIFIED')) ? (
      <Btn
        loading={action === 'request'}
        disabled={busy || !purpose.trim()}
        onClick={() => setRequestOpen(true)}
      >
        {rawStatus === 'NOT_REQUESTED' ? 'Create evidence request' : 'Request again'}
      </Btn>
    ) : supplier && rawStatus === 'REQUESTED' && !material ? (
      <>
        <Btn
          variant="outline"
          loading={action === 'decline'}
          disabled={busy}
          onClick={() => void declineRequest()}
        >
          {action === 'decline' ? 'Declining…' : 'Decline'}
        </Btn>
        <Btn
          loading={action === 'review'}
          disabled={busy || expired}
          onClick={() => void loadMaterial()}
        >
          {action === 'review' ? 'Loading…' : 'Review request'}
        </Btn>
      </>
    ) : undefined;
  // Until the real status arrives, the default 'not requested' would show a wrong next step.
  if (!status && !error) return <LoadingIndicator label="Loading request…" />;
  if (!status)
    return (
      <div className="evidence-panel">
        <Alert type="error" message={error || 'Evidence status is unavailable.'} />
        <Btn variant="outline" disabled={busy} onClick={() => void run(refresh, 'refresh')}>
          Retry evidence status
        </Btn>
      </div>
    );
  return (
    <section
      className="company-evidence-card evidence-panel"
      aria-label={`${sellerLabel} company evidence`}
    >
      {showHeading && (
        <header className="evidence-panel__heading">
          <h3>{sellerLabel} company evidence</h3>
          <Badge label={proofStatusLabel(rawStatus)} variant={proofStatusVariant(rawStatus)} />
          {expiryBadge && <Badge label={expiryBadge.label} variant={expiryBadge.variant} />}
          {!hideRefresh && rawStatus !== 'NOT_REQUESTED' && (
            <button
              type="button"
              className="evidence-panel__refresh"
              aria-label="Refresh status"
              title="Refresh status"
              disabled={busy}
              aria-busy={action === 'refresh' || undefined}
              onClick={() => void run(refresh, 'refresh')}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          )}
        </header>
      )}
      {rawStatus !== 'NOT_REQUESTED' && (
        <p className="evidence-panel__facts">
          <span>
            {supplier ? 'Requested by' : 'Requested from'}{' '}
            <strong>{supplier ? recipient : evidenceHolder}</strong>
          </span>
          {requestedRequired !== undefined && (
            <span>
              <strong>{requestedRequired}</strong> required
              {requestedOptional ? ` + ${requestedOptional} optional` : ''} fields
            </span>
          )}
          {expiresAt > 0 && (
            <span>
              {expired ? 'Closed' : 'Due'} <strong>{formatEvidenceDate(expiresAt)}</strong>
            </span>
          )}
        </p>
      )}
      {error && <Alert type="error" message={error} />}
      {notice && <Alert type="success" message={notice} />}
      {status?.credential && (
        <SharedClaims
          values={status.credential}
          missing={status.missingClaims}
          undisclosed={status.undisclosedClaims}
        />
      )}
      {!supplier && status?.verification && (
        <EvidenceVerificationSummary verification={status.verification} />
      )}
      {!material && (
        <EvidenceNextStep
          title={next.title}
          message={next.message}
          tone={next.tone}
          action={nextAction}
        >
          {/* Technical verification and the business decision remain separate. */}
          {!supplier && ['PRESENTED', 'SHARED'].includes(rawStatus) && !expired && (
            <EvidenceDecision
              verification={status?.verification}
              onVerify={() => void run(async () => {}, 'verify')}
              busy={busy ? action || 'busy' : ''}
              recipient={evidenceHolder}
              onAccept={() => void verify()}
              onReject={(reason) => void reject(reason)}
            />
          )}
        </EvidenceNextStep>
      )}
      {requestDialog}
      {supplier && material && (
        <div className="company-evidence-card__material">
          {material.format !== 'COMPANY_IDENTITY_SD_JWT' && (
            <Alert
              type="warning"
              message="This credential format shares every field. Individual fields cannot be hidden."
            />
          )}
          <EvidenceFieldList
            values={claimValues}
            required={requiredClaims}
            selected={selected}
            selectable={material.format === 'COMPANY_IDENTITY_SD_JWT'}
            onToggle={toggleClaim}
            onToggleAll={toggleAllOptional}
          />
          {!material.walletContext && (
            <PresentationSigningSettingsLink
              role={order.productDelivery ? 'manufacturer' : 'supplier'}
            />
          )}
          {!requiredAvailable && (
            <Alert
              type="error"
              message="A required field is missing from your company credential. Ask the administrator for a replacement credential, or decline this request."
            />
          )}
          <div className="company-evidence-card__footer is-sticky">
            <Btn
              variant="outline"
              loading={action === 'decline'}
              disabled={busy}
              onClick={() => void declineRequest()}
            >
              {action === 'decline' ? 'Declining…' : 'Decline'}
            </Btn>
            <Btn
              disabled={busy || expired || !requiredAvailable}
              onClick={() => setReviewOpen(true)}
            >
              Review and sign proof
            </Btn>
          </div>
        </div>
      )}
      <EvidenceHowItWorks>
        <p>
          The {sellerLabel.toLocaleLowerCase()} shares selected fields from its signed company
          credential. The shared proof is encrypted, stored on IPFS and referenced on-chain, and
          only works for this request, recipient and deadline.
        </p>
        <p>
          Sharing needs a MetaMask signature plus one transaction. Sharing or verifying evidence
          does not accept the custody offer or move stock, and later actions re-check the
          company&apos;s current authorization.
        </p>
      </EvidenceHowItWorks>
      <TechnicalDetails
        fields={[
          { label: 'Reference ID', value: order.orderId },
          { label: 'Raw proof status', value: rawStatus },
          ...(order.delivery.identityCredentialHash
            ? [{ label: 'Identity credential hash', value: order.delivery.identityCredentialHash }]
            : []),
          ...(order.delivery.identityChallenge
            ? [{ label: 'Identity challenge', value: order.delivery.identityChallenge }]
            : []),
          ...Object.entries(material?.binding ?? {}).map(([label, value]) => ({
            label,
            value: String(value),
          })),
        ]}
      />
      {reviewOpen && material && (
        <Modal
          title="Sign and share company evidence"
          onClose={() => setReviewOpen(false)}
          width={560}
        >
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
                <dt>Valid until</dt>
                <dd>{formatEvidenceDate(material.expiresAt)}</dd>
              </div>
            </dl>
            <div>
              <h4>Fields being shared</h4>
              <ul>
                {selectedClaims.map((claim) => (
                  <li key={claim}>{friendlyClaim(claim)}</li>
                ))}
              </ul>
            </div>
            <div className="company-evidence-review__actions action-row">
              <Btn variant="outline" disabled={busy} onClick={() => setReviewOpen(false)}>
                Cancel
              </Btn>
              <Btn
                loading={action === 'share'}
                disabled={busy || expired || !requiredAvailable}
                onClick={() => void signAndShare()}
              >
                {action === 'share' ? 'Signing…' : 'Sign and share'}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function nextStep({
  status,
  holder,
  holderName,
  recipient,
  verifiedAt,
  expired = false,
}: {
  status: string;
  holder: boolean;
  holderName: string;
  recipient: string;
  verifiedAt?: string;
  expired?: boolean;
}): { title?: string; message: string; tone: 'default' | 'done' | 'closed' } {
  if (expired && status !== 'VERIFIED')
    return holder
      ? {
          message: 'This company identity request has expired. No action is possible.',
          tone: 'closed',
        }
      : {
          message:
            'The company identity request has expired. Request it again, or continue without it.',
          tone: 'closed',
        };
  if (status === 'NOT_REQUESTED')
    return holder
      ? { message: 'No evidence has been requested.', tone: 'closed' }
      : {
          message: `Ask ${holderName} to share verified company details before collecting or dispatching this stock.`,
          tone: 'default',
        };
  if (['REQUESTED', 'PENDING'].includes(status))
    return holder
      ? { message: 'Choose which details to share, then sign with MetaMask.', tone: 'default' }
      : { message: `Waiting for ${holderName} to respond.`, tone: 'default' };
  if (['PRESENTED', 'SHARED'].includes(status))
    return holder
      ? { message: `Shared. Waiting for ${recipient} to review and decide.`, tone: 'done' }
      : {
          title: 'Evidence shared',
          message:
            'Review the shared fields and verification results, then accept or reject the evidence.',
          tone: 'default',
        };
  if (status === 'VERIFIED')
    return {
      title: 'Evidence accepted',
      message: verifiedAt
        ? `Accepted on ${formatEvidenceDate(verifiedAt)}. No further action is required.`
        : 'No further action is required.',
      tone: 'done',
    };
  if (status === 'REJECTED')
    return holder
      ? { message: `${recipient} rejected the shared evidence.`, tone: 'closed' }
      : {
          title: 'Evidence rejected',
          message: 'You rejected this evidence. No further action is possible.',
          tone: 'closed',
        };
  if (status === 'DECLINED')
    return { message: `${holder ? 'You' : holderName} declined this request.`, tone: 'closed' };
  return {
    message: holder
      ? 'This request has closed. No action is possible.'
      : 'This request has closed. Create a new one if you still need it.',
    tone: 'closed',
  };
}

export function proofStatusLabel(status?: string) {
  return (
    {
      NOT_REQUESTED: 'Not requested',
      REQUESTED: 'Awaiting response',
      PENDING: 'Awaiting response',
      PRESENTED: 'Evidence shared',
      SHARED: 'Evidence shared',
      VERIFIED: 'Accepted',
      DECLINED: 'Declined',
      REJECTED: 'Rejected',
      EXPIRED: 'Expired',
      UNAVAILABLE: 'Unavailable',
    }[status ?? 'NOT_REQUESTED'] ?? 'Status unavailable'
  );
}

/** Green = done, teal = shared and ready to check, amber = waiting, red = failed or missed, grey = void. */
export function proofStatusVariant(status?: string): BadgeVariant {
  if (status === 'VERIFIED') return 'verified';
  if (['DECLINED', 'REJECTED', 'EXPIRED'].includes(status ?? '')) return 'rejected';
  if (status === 'UNAVAILABLE') return 'expired';
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
  if (status === 'VERIFIED') return 'The shared company evidence was accepted.';
  if (['DECLINED', 'REJECTED'].includes(status))
    return 'The evidence request or verification did not complete successfully.';
  if (['EXPIRED', 'UNAVAILABLE'].includes(status))
    return 'This company evidence request is no longer available for action.';
  return 'The current evidence state could not be determined.';
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
  return value
    .toLocaleLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function shortEvidenceReference(value: string) {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function formatEvidenceDate(value: string | number) {
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}
