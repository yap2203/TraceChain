import { useState, type ReactNode } from 'react';
import { Contact, type LucideIcon } from 'lucide-react';
import { EvidenceCard, FieldPairs, IdentifierFields } from './EvidenceIdentity';
import { COMPANY_ALWAYS_CLAIMS } from '@tracechain/shared';
import { Alert, Btn, ClaimRow, Input } from '../workspaces/shared/ui';
import type { BadgeVariant } from '../workspaces/shared/ui/Badge';
import './evidence-exchange.css';

/**
 * On-chain ingredient evidence request status → label and badge.
 * Green = accepted, teal = shared and ready to check, amber = waiting, red = declined/rejected.
 */
export const INGREDIENT_EVIDENCE_STATUS: Record<number, { label: string; variant: BadgeVariant }> =
  {
    1: { label: 'Awaiting response', variant: 'pending' },
    2: { label: 'Evidence shared', variant: 'shared' },
    3: { label: 'Accepted', variant: 'verified' },
    4: { label: 'Declined', variant: 'rejected' },
    5: { label: 'Rejected', variant: 'rejected' },
    6: { label: 'Cancelled', variant: 'expired' },
  };

export function ingredientEvidenceStatus(status: number, dueAt?: number) {
  if (status === 1 && dueAt && dueAt * 1000 <= Date.now())
    return { label: 'Expired', variant: 'rejected' as BadgeVariant };
  return (
    INGREDIENT_EVIDENCE_STATUS[status] ?? { label: 'Unknown', variant: 'default' as BadgeVariant }
  );
}

/**
 * Evidence detail body: the task (next step, fields, actions) in the main column and reference
 * facts in a titled side column on wide screens; one column, task first, on narrow screens.
 */
export function EvidenceDetailLayout({
  aside,
  asideTitle = 'Request summary',
  asideIcon: AsideIcon,
  children,
}: {
  aside?: ReactNode;
  asideTitle?: string;
  asideIcon?: LucideIcon;
  children: ReactNode;
}) {
  if (!aside) return <div className="evidence-detail-main">{children}</div>;
  return (
    <div className="evidence-detail-body">
      <div className="evidence-detail-main">{children}</div>
      <aside className="evidence-detail-aside" aria-label={asideTitle}>
        <h3>
          {AsideIcon && <AsideIcon size={18} aria-hidden="true" />}
          {asideTitle}
        </h3>
        {aside}
      </aside>
    </div>
  );
}

/** The single "what happens next" box every evidence detail shows. */
export function EvidenceNextStep({
  title,
  message,
  action,
  tone = 'default',
  children,
}: {
  /** Short outcome, e.g. "Evidence shared"; the message explains it. */
  title?: ReactNode;
  message: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'done' | 'closed';
  /** Full-width content under the message, such as an EvidenceDecision. */
  children?: ReactNode;
}) {
  return (
    <div className={`evidence-next-step is-${tone}`}>
      <div>
        <span>Next step</span>
        {title && <strong className="evidence-next-step__title">{title}</strong>}
        <p>{message}</p>
      </div>
      {action && <div className="evidence-next-step__action">{action}</div>}
      {children && <div className="evidence-next-step__body">{children}</div>}
    </div>
  );
}

/**
 * The requester's decision on shared evidence, identical for company identity and ingredient
 * evidence: "Verify and accept" in one step, or reject with a reason.
 */
export function EvidenceDecision({
  busy,
  onAccept,
  onReject,
  recipient,
  disabled = false,
}: {
  /** Which action is running: 'accept', 'reject' or ''. */
  busy: string;
  onAccept: () => void;
  onReject: (reason: string) => void;
  /** Who is told the reason, e.g. "the Supplier". */
  recipient: string;
  disabled?: boolean;
}) {
  const [rejecting, setRejecting] = useState(false),
    [reason, setReason] = useState('');
  if (rejecting)
    return (
      <div className="evidence-decision">
        <Input
          label="Rejection reason"
          value={reason}
          onChange={setReason}
          maxLength={500}
          required
          placeholder={`Tell ${recipient} why the evidence is rejected`}
        />
        <div className="evidence-decision__actions">
          <Btn variant="outline" disabled={Boolean(busy)} onClick={() => setRejecting(false)}>
            Cancel
          </Btn>
          <Btn
            variant="danger"
            loading={busy === 'reject'}
            disabled={!reason.trim() || Boolean(busy)}
            onClick={() => onReject(reason.trim())}
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject evidence'}
          </Btn>
        </div>
      </div>
    );
  return (
    <div className="evidence-decision__actions">
      <Btn
        variant="outline"
        disabled={disabled || Boolean(busy)}
        onClick={() => setRejecting(true)}
      >
        Reject…
      </Btn>
      <Btn loading={busy === 'accept'} disabled={disabled || Boolean(busy)} onClick={onAccept}>
        {busy === 'accept' ? 'Verifying…' : 'Verify and accept'}
      </Btn>
    </div>
  );
}

/** Explanations live here, collapsed, instead of being repeated across the page. */
export function EvidenceHowItWorks({ children }: { children: ReactNode }) {
  return (
    <details className="evidence-how-it-works">
      <summary>How this works</summary>
      <div>{children}</div>
    </details>
  );
}

/** Requested company fields: required ones locked on, optional ones toggled by the holder. */
export function EvidenceFieldList({
  values,
  required,
  selected,
  selectable,
  onToggle,
  onToggleAll,
}: {
  values: Record<string, unknown>;
  required: string[];
  selected: string[];
  selectable: boolean;
  onToggle: (claim: string) => void;
  onToggleAll?: () => void;
}) {
  const names = Object.keys(values);
  const ordered = [
    ...names.filter((claim) => required.includes(claim)),
    ...names.filter((claim) => !required.includes(claim)),
  ];
  const optional = names.filter((claim) => !required.includes(claim));
  const sharing = names.filter((claim) => selected.includes(claim)).length;
  const always = COMPANY_ALWAYS_CLAIMS as readonly string[];
  // Required is a label: the holder may withhold it, except the identity-binding fields.
  const withheld = selectable
    ? required.filter((claim) => !always.includes(claim) && !selected.includes(claim))
    : [];
  return (
    <section className="evidence-fields" aria-labelledby="evidence-fields-title">
      <header>
        <h4 id="evidence-fields-title">Fields requested</h4>
        <strong>
          {sharing} of {names.length} fields will be shared
        </strong>
        {selectable && optional.length > 0 && onToggleAll && (
          <label className="company-evidence-share-all">
            <span>Share all optional</span>
            <button
              type="button"
              role="switch"
              aria-label="Share all optional fields"
              aria-checked={optional.every((claim) => selected.includes(claim))}
              className="evidence-claim-switch"
              onClick={onToggleAll}
            >
              <span aria-hidden="true" />
            </button>
          </label>
        )}
      </header>
      <div className="evidence-fields__list">
        {ordered.map((claim) => {
          const isRequired = required.includes(claim);
          // The server lists the binding fields as required; only those stay locked.
          const locked = !selectable || (isRequired && always.includes(claim));
          return (
            <ClaimRow
              key={claim}
              label={friendlyClaim(claim)}
              value={displayClaimValue(claim, values[claim])}
              requirement={
                (COMPANY_ALWAYS_CLAIMS as readonly string[]).includes(claim)
                  ? 'always'
                  : isRequired
                    ? 'required'
                    : 'optional'
              }
              included={locked || selected.includes(claim)}
              locked={locked}
              technical={technicalClaim(claim)}
              onToggle={() => onToggle(claim)}
            />
          );
        })}
      </div>
      {withheld.length > 0 && (
        <Alert
          type="warning"
          message={`Not sharing required: ${withheld.map(friendlyClaim).join(', ')}. You can still share; the requester will see the proof as incomplete and may reject it.`}
        />
      )}
    </section>
  );
}

/** Read-only view of claims another company shared. */
export function SharedClaims({
  values,
  missing = [],
}: {
  values: Record<string, unknown>;
  missing?: string[];
}) {
  const entries = Object.entries(values);
  if (!entries.length) return null;
  const business = entries.filter(([claim]) => !technicalClaim(claim));
  const identifiers = entries.filter(([claim]) => technicalClaim(claim));
  return (
    <EvidenceCard
      icon={Contact}
      title="Shared company information"
      meta={`${entries.length} ${entries.length === 1 ? 'field' : 'fields'} shared`}
    >
      {missing.length > 0 && (
        <Alert
          type="warning"
          message={`Incomplete: required ${missing.map(friendlyClaim).join(', ')} not shared. The signatures are valid; decide whether this is enough to continue.`}
        />
      )}
      <FieldPairs
        fields={business.map(([claim, value]) => ({
          label: friendlyClaim(claim),
          value: displayClaimValue(claim, value),
        }))}
      />
      <IdentifierFields
        fields={identifiers.map(([claim, value]) => ({
          label: claim === 'id' ? 'Decentralized identity (DID)' : friendlyClaim(claim),
          value: typeof value === 'string' ? value : String(value ?? ''),
        }))}
      />
    </EvidenceCard>
  );
}

export function friendlyClaim(claim: string) {
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

export function displayClaimValue(claim: string, value: unknown) {
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

export function claimValueAvailable(value: unknown) {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

export function technicalClaim(claim: string) {
  return ['companyId', 'walletAddress', 'applicationReference', 'id'].includes(claim);
}

/** "in 3 h", "on 28 Nov", "2 days ago" — short and readable. */
export type EvidenceGroup = 'action' | 'open' | 'closed';
export type EvidenceStatusFilter = 'all' | EvidenceGroup;
export const matchesStatusFilter = (filter: EvidenceStatusFilter, group: EvidenceGroup) =>
  filter === 'all' || filter === group || (filter === 'open' && group === 'action');

/** Who acts next on an ingredient request: the Supplier while awaiting, the requester once shared. */
export function ingredientRequestGroup(
  request: { status: number; dueAt: number },
  side: 'received' | 'sent',
): EvidenceGroup {
  if (request.status === 1 && request.dueAt * 1000 > Date.now())
    return side === 'received' ? 'action' : 'open';
  if (request.status === 2) return side === 'sent' ? 'action' : 'open';
  return 'closed';
}

/** One status filter for every Evidence Exchange list. */
export function EvidenceStatusSelect({
  value,
  onChange,
  actionCount,
}: {
  value: EvidenceStatusFilter;
  onChange: (value: EvidenceStatusFilter) => void;
  actionCount: number;
}) {
  return (
    <label className="evidence-toolbar__select">
      <span className="sr-only">Filter by status</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as EvidenceStatusFilter)}
      >
        <option value="all">All statuses</option>
        <option value="action">Needs your action ({actionCount})</option>
        <option value="open">Open</option>
        <option value="closed">Closed</option>
      </select>
    </label>
  );
}

/** Deadline table cell: date, then "Due in 5 h" / "Overdue" / "Closed" underneath. */
export function DeadlineCell({ dueAt, closed }: { dueAt: number; closed: boolean }) {
  const deadline = relativeDeadline(dueAt);
  return (
    <td className={deadline.past && !closed ? 'is-overdue' : undefined}>
      <span className="evidence-table__stack">
        <strong>{new Date(dueAt * 1000).toLocaleDateString()}</strong>
        <small>{closed ? 'Closed' : deadline.past ? 'Overdue' : `Due ${deadline.text}`}</small>
      </span>
    </td>
  );
}

export function relativeDeadline(expiresAt: number) {
  const ms = expiresAt * 1000 - Date.now();
  const date = new Date(expiresAt * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
  if (ms <= 0) return { past: true, text: date };
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return { past: false, text: 'in under 1 h' };
  if (hours < 48) return { past: false, text: `in ${hours} h` };
  return { past: false, text: `on ${date}` };
}
