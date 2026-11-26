import type { ReactNode } from 'react';
import { COMPANY_ALWAYS_CLAIMS } from '@tracechain/shared';
import { ClaimRow } from '../workspaces/shared/ui';
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
  children,
}: {
  aside?: ReactNode;
  asideTitle?: string;
  children: ReactNode;
}) {
  if (!aside) return <div className="evidence-detail-main">{children}</div>;
  return (
    <div className="evidence-detail-body">
      <div className="evidence-detail-main">{children}</div>
      <aside className="evidence-detail-aside" aria-label={asideTitle}>
        <h3>{asideTitle}</h3>
        {aside}
      </aside>
    </div>
  );
}

/** The single "what happens next" box every evidence detail shows. */
export function EvidenceNextStep({
  message,
  action,
  tone = 'default',
}: {
  message: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'done' | 'closed';
}) {
  return (
    <div className={`evidence-next-step is-${tone}`}>
      <div>
        <span>Next step</span>
        <p>{message}</p>
      </div>
      {action && <div className="evidence-next-step__action">{action}</div>}
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
              included={isRequired || selected.includes(claim)}
              locked={isRequired || !selectable}
              technical={technicalClaim(claim)}
              onToggle={() => onToggle(claim)}
            />
          );
        })}
      </div>
    </section>
  );
}

/** Read-only view of claims another company shared. */
export function SharedClaims({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values);
  if (!entries.length) return null;
  return (
    <dl className="evidence-shared-claims">
      {entries.map(([claim, value]) => (
        <div key={claim}>
          <dt>{friendlyClaim(claim)}</dt>
          <dd title={technicalClaim(claim) ? displayClaimValue(claim, value) : undefined}>
            {displayClaimValue(claim, value)}
          </dd>
        </div>
      ))}
    </dl>
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
