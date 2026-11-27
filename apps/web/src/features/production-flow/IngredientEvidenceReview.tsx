import type { ReactNode } from 'react';
import { ClipboardList, FileCheck, Leaf } from 'lucide-react';
import { Alert, Badge, TechnicalDetails } from '../workspaces/shared/ui';
import type { BadgeVariant } from '../workspaces/shared/ui/Badge';
import { EvidenceDetailLayout } from '../orders/EvidenceParts';
import {
  EvidenceCard,
  EvidenceOutcome,
  EvidenceSummaryCard,
  INGREDIENT_IDENTIFIER_CLAIMS,
  IdentifierFields,
  RequestSummary,
  evidenceDateFields,
  ingredientRequestedRows,
  verificationBadge,
  type OutcomeTone,
} from '../orders/EvidenceIdentity';
import { IngredientClaimValue } from './IngredientClaimValue';
import { getSharedCertificationDocument, type EvidenceReview } from './production-flow.api';

/**
 * Requester's view of received ingredient evidence: summary and outcome, shared business and
 * identity information on the left; the request summary (parties, dates, requested fields) on
 * the right. Verification and acceptance stay separate actions supplied by the page.
 */
export function IngredientEvidenceReview({
  review,
  ingredient,
  requesterRole,
  requestFor,
  status,
  outcome,
  actions,
  children,
  howItWorks,
}: {
  review: EvidenceReview;
  ingredient: string;
  requesterRole: string;
  requestFor: ReactNode;
  status: { label: string; variant: BadgeVariant };
  outcome: { tone: OutcomeTone; title: string; message: string };
  actions?: ReactNode;
  /** Shown under the summary card, e.g. the rejection form. */
  children?: ReactNode;
  howItWorks?: ReactNode;
}) {
  const supplier = review.supplierName ?? 'Supplier';
  const verification = verificationBadge(review.verification.state);
  const shared = Object.entries(review.sharedClaims).filter(([key]) => key !== 'policyVersion');
  const business = shared.filter(([key]) => !(key in INGREDIENT_IDENTIFIER_CLAIMS));
  const open = review.status === 1 || review.status === 2;
  return (
    <EvidenceDetailLayout
      asideTitle="Request summary"
      asideIcon={ClipboardList}
      aside={
        <RequestSummary
          requester={{ name: 'Your company', role: requesterRole, you: true }}
          provider={{ name: supplier, role: 'Supplier', wallet: review.supplier }}
          facts={[
            { label: 'Request for', value: requestFor },
            ...evidenceDateFields({
              dueAt: review.dueAt,
              open,
              proofValidUntil: review.presentationExpiry,
              credentialExpires: review.credentialExpiry,
              verifiedAt: review.verification.verifiedAt,
            }),
          ]}
          purpose={review.purpose}
          requested={ingredientRequestedRows(review)}
        />
      }
    >
      <EvidenceSummaryCard
        icon={Leaf}
        title={ingredient}
        subtitle={`${supplier} · Supplier`}
        context="Ingredient evidence"
        badges={
          <>
            <Badge label={status.label} variant={status.variant} />
            <Badge label={verification.label} variant={verification.variant} />
          </>
        }
      >
        <EvidenceOutcome {...outcome} action={actions} />
      </EvidenceSummaryCard>
      {children}
      <EvidenceCard
        icon={FileCheck}
        title="Shared ingredient information"
        meta={`${shared.length} ${shared.length === 1 ? 'field' : 'fields'} shared`}
      >
        {review.unmetRequirements?.length ? (
          <Alert
            type="warning"
            message={`Incomplete: the Supplier did not share everything you marked required. ${review.unmetRequirements.join(' ')} Decide whether to accept or reject this evidence.`}
          />
        ) : null}
        {business.length > 0 && (
          <div className="ingredient-review-grid">
            {business.map(([key, value]) => (
              <div key={key}>
                <IngredientClaimValue
                  name={key}
                  value={value}
                  loadDocument={(id) => getSharedCertificationDocument(review.requestId, id)}
                />
              </div>
            ))}
          </div>
        )}
        <IdentifierFields
          fields={Object.entries(INGREDIENT_IDENTIFIER_CLAIMS).map(([key, label]) => ({
            label,
            value:
              typeof review.sharedClaims[key] === 'string'
                ? (review.sharedClaims[key] as string)
                : undefined,
          }))}
        />
      </EvidenceCard>
      {howItWorks}
      <TechnicalDetails
        fields={[
          { label: 'Request ID', value: review.requestId },
          { label: 'Ingredient batch ID', value: review.batchId },
          { label: 'Credential ID', value: review.credentialId },
        ]}
      />
    </EvidenceDetailLayout>
  );
}
