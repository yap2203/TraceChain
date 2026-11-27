import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Circle,
  Clock,
  Info,
  MinusCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ingredientClaimLabel, isRetiredIngredientClaim } from '@tracechain/shared';
import { TechnicalIdentifier } from '../workspaces/shared/ui';
import type { BadgeVariant } from '../workspaces/shared/ui/Badge';
import { CompanyAvatar } from './CatalogueMedia';
import { relativeDeadline } from './EvidenceParts';
import './evidence-exchange.css';

/* ---------- Summary card: who/what, status, and the current outcome ---------- */

export type OutcomeTone = 'done' | 'action' | 'waiting' | 'warning' | 'closed';
const OUTCOME_ICON: Record<OutcomeTone, LucideIcon> = {
  done: CheckCircle2,
  action: Info,
  waiting: Clock,
  warning: AlertTriangle,
  closed: XCircle,
};

/** The most important current outcome, whether action is needed, and the action itself. */
export function EvidenceOutcome({
  tone,
  title,
  message,
  action,
}: {
  tone: OutcomeTone;
  title: string;
  message: ReactNode;
  action?: ReactNode;
}) {
  const Icon = OUTCOME_ICON[tone];
  return (
    <div className={`evidence-outcome is-${tone}`} role="status">
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {action && <div className="evidence-outcome__action">{action}</div>}
    </div>
  );
}

/** Top card of an evidence detail: subject, counterparty and role, status badges, outcome. */
export function EvidenceSummaryCard({
  icon: Icon,
  title,
  subtitle,
  context,
  badges,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  context: string;
  badges?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="evidence-card evidence-summary-card" aria-label={`${context}: ${title}`}>
      <header className="evidence-summary-card__head">
        <span className="evidence-summary-card__icon" aria-hidden="true">
          <Icon size={22} />
        </span>
        <div>
          <h2>{title}</h2>
          {subtitle && <span>{subtitle}</span>}
          <small>{context}</small>
        </div>
        {badges && <div className="evidence-summary-card__badges">{badges}</div>}
      </header>
      {children && <div className="evidence-card__body">{children}</div>}
    </section>
  );
}

/** A titled card section with an icon and optional meta on the right ("5 fields shared"). */
export function EvidenceCard({
  icon: Icon,
  title,
  meta,
  children,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="evidence-card" aria-label={title}>
      <header className="evidence-card__head">
        <Icon size={18} aria-hidden="true" />
        <h3>{title}</h3>
        {meta && <span>{meta}</span>}
      </header>
      <div className="evidence-card__body">{children}</div>
    </section>
  );
}

/** Business information as label/value pairs, two per row on wide screens. */
export function FieldPairs({ fields }: { fields: { label: string; value: ReactNode }[] }) {
  if (!fields.length) return null;
  return (
    <dl className="evidence-field-pairs">
      {fields.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Technical identity information: each identifier boxed, with copy and full-value toggle. */
export function IdentifierFields({
  title = 'Digital identity information',
  fields,
}: {
  title?: string;
  fields: { label: string; value?: string }[];
}) {
  const visible = fields.filter((field): field is { label: string; value: string } =>
    Boolean(field.value),
  );
  if (!visible.length) return null;
  return (
    <div className="evidence-identifiers">
      <h4>{title}</h4>
      {visible.map((field) => (
        <div key={field.label}>
          <span>{field.label}</span>
          <TechnicalIdentifier label={field.label} value={field.value} boxed />
        </div>
      ))}
    </div>
  );
}

/* ---------- Parties ---------- */

/** A party to an evidence exchange: name and role first, wallet as a copyable identifier. */
export function IdentityProfile({
  relation,
  name,
  role,
  wallet,
  logoPath,
  you = false,
}: {
  relation: string;
  name: string;
  role?: string;
  wallet?: string;
  logoPath?: string;
  you?: boolean;
}) {
  return (
    <div className="identity-profile">
      <CompanyAvatar name={name} logoPath={logoPath} size="sm" />
      <div className="identity-profile__text">
        <span className="identity-profile__relation">{relation}</span>
        <strong aria-label={you ? `${name} (you)` : undefined}>{name}</strong>
        {role && <span>{role}</span>}
        {wallet && (
          <TechnicalIdentifier label={`${relation} wallet`} value={wallet} expandable={false} />
        )}
      </div>
    </div>
  );
}

export interface EvidenceParty {
  name: string;
  role?: string;
  wallet?: string;
  you?: boolean;
}

/** Requesting party and evidence provider side by side, clearly labelled. */
export function EvidenceParties({
  requester,
  provider,
}: {
  requester: EvidenceParty;
  provider: EvidenceParty;
}) {
  return (
    <div className="evidence-parties">
      <IdentityProfile relation="Requested by" {...requester} />
      <ArrowLeftRight className="evidence-parties__arrow" size={16} aria-hidden="true" />
      <IdentityProfile relation="Evidence from" {...provider} />
    </div>
  );
}

/* ---------- Verification ---------- */

/** Verified only after a successful verification result; shared evidence is never shown as verified. */
export function verificationBadge(state?: 'NOT_VERIFIED' | 'PASSED') {
  return state === 'PASSED'
    ? { label: 'Verified', variant: 'verified' as BadgeVariant }
    : { label: 'Not verified yet', variant: 'pending' as BadgeVariant };
}

/* ---------- Requested versus shared ---------- */

export type RequestedFieldState =
  'shared' | 'missing' | 'notShared' | 'withheld' | 'unavailable' | 'requested';
const FIELD_STATE: Record<RequestedFieldState, { label: string; icon: LucideIcon }> = {
  shared: { label: 'Shared', icon: CheckCircle2 },
  missing: { label: 'Missing', icon: AlertTriangle },
  notShared: { label: 'Not shared', icon: MinusCircle },
  withheld: { label: 'Withheld', icon: AlertTriangle },
  unavailable: { label: 'Not in credential', icon: MinusCircle },
  requested: { label: '', icon: Circle },
};
export interface RequestedFieldRow {
  claim: string;
  label: string;
  required: boolean;
  state: RequestedFieldState;
}

/** One row per requested field: what was asked for and what was (or will be) shared. */
export function RequestedFields({ title, rows }: { title: string; rows: RequestedFieldRow[] }) {
  if (!rows.length) return null;
  const shared = rows.filter((row) => row.state === 'shared').length;
  const outcome = rows.some((row) => row.state !== 'requested');
  return (
    <div className="requested-fields" aria-label={title}>
      <header>
        <h4>{title}</h4>
        {outcome && (
          <span>
            {shared} of {rows.length} shared
          </span>
        )}
      </header>
      <ul>
        {rows.map((row) => {
          const state = FIELD_STATE[row.state];
          const Icon = state.icon;
          return (
            <li key={row.claim} className={`is-${row.state}`}>
              <Icon size={15} aria-hidden="true" />
              <span className="requested-fields__label">
                {row.label}
                {row.state !== 'requested' && (
                  <small>{row.required ? 'Required' : 'Optional'}</small>
                )}
              </span>
              <span className="requested-fields__state">
                {row.state === 'requested' ? (row.required ? 'Required' : 'Optional') : state.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const GROUP_PREFIX: Record<string, string> = {
  certifications: 'certification_',
  certificationDocuments: 'certificationDocuments_',
  qualityTests: 'qualityTest_',
  qualityDocuments: 'qualityDocuments_',
};
/** Whether a requested ingredient field (or field group) is present in the disclosed claims. */
export function ingredientFieldShared(claim: string, claims: Record<string, unknown>) {
  const prefix = GROUP_PREFIX[claim];
  if (prefix) return Object.keys(claims).some((key) => key.startsWith(prefix));
  const value = claims[claim];
  return value != null && value !== '' && !(Array.isArray(value) && !value.length);
}

/** Requester view: each requested field marked Shared, Missing (required) or Not shared. */
export function ingredientRequestedRows(review: {
  requestedClaims?: string[];
  requiredClaims?: string[];
  sharedClaims: Record<string, unknown>;
}): RequestedFieldRow[] {
  const required = review.requiredClaims ?? [];
  return (review.requestedClaims ?? [])
    .filter((claim) => !isRetiredIngredientClaim(claim))
    .map((claim) => {
      const isRequired = required.includes(claim);
      return {
        claim,
        label: ingredientClaimLabel(claim),
        required: isRequired,
        state: ingredientFieldShared(claim, review.sharedClaims)
          ? 'shared'
          : isRequired
            ? 'missing'
            : 'notShared',
      };
    });
}

/** Ingredient claims that are technical identifiers rather than business information. */
export const INGREDIENT_IDENTIFIER_CLAIMS: Record<string, string> = {
  supplierWallet: 'Supplier wallet',
  supplierDid: 'Supplier decentralized identity (DID)',
  batchId: 'TraceChain batch ID',
  credentialId: 'Credential ID',
};

/* ---------- Dates ---------- */

/**
 * Request deadline, proof lifetime and credential expiry are different dates; each is labelled.
 * The time left is shown only while the request is still open.
 */
export function evidenceDateFields({
  dueAt,
  open,
  proofValidUntil,
  credentialExpires,
  verifiedAt,
}: {
  dueAt?: number;
  open: boolean;
  proofValidUntil?: string;
  credentialExpires?: string;
  verifiedAt?: string;
}) {
  const date = (value?: string) => (value && value !== 'Unavailable' ? new Date(value) : undefined);
  const deadline = dueAt ? relativeDeadline(dueAt) : undefined;
  const fields: { label: string; value: ReactNode }[] = [];
  if (dueAt)
    fields.push({
      label: 'Request deadline',
      value: (
        <>
          {new Date(dueAt * 1000).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          <small>
            {new Date(dueAt * 1000).toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
            {open && deadline && !deadline.past ? ` · due ${deadline.text}` : ''}
          </small>
        </>
      ),
    });
  const proof = date(proofValidUntil);
  if (proof) fields.push({ label: 'Shared proof valid until', value: proof.toLocaleString() });
  const credential = date(credentialExpires);
  if (credential)
    fields.push({ label: 'Credential expires', value: credential.toLocaleDateString() });
  const verified = date(verifiedAt);
  if (verified) fields.push({ label: 'Verified on', value: verified.toLocaleString() });
  return fields;
}

/* ---------- Request summary (side column) ---------- */

/** Side column: parties, what the request is for, deadline and dates, purpose, requested fields. */
export function RequestSummary({
  requester,
  provider,
  facts,
  purpose,
  requested,
}: {
  requester: EvidenceParty;
  provider: EvidenceParty;
  facts: { label: string; value: ReactNode }[];
  purpose?: string;
  requested: RequestedFieldRow[];
}) {
  return (
    <div className="request-summary">
      <EvidenceParties requester={requester} provider={provider} />
      <FieldPairs fields={facts} />
      {purpose && (
        <div className="request-summary__purpose">
          <span>Purpose of request</span>
          <p>{purpose}</p>
        </div>
      )}
      <RequestedFields title="Requested information" rows={requested} />
    </div>
  );
}
