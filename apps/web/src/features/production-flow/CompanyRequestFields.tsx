import { COMPANY_ALWAYS_CLAIMS, COMPANY_EVIDENCE_CLAIMS, companyDisclosureGroup } from '@tracechain/shared';
import {
  classifyEvidenceClaims,
  evidenceClaimLists,
  EvidenceClaimSelector,
} from './EvidenceClaimSelector';

export function normalizeCompanyRequestFields(required: string[], optional: string[]) {
  const registrationKeys = ['companyRegistrationNumber', 'registrationCountry'];
  const registrationRequired = required.some((key) => registrationKeys.includes(key));
  const registrationOptional =
    !registrationRequired && optional.some((key) => registrationKeys.includes(key));
  const fields = classifyEvidenceClaims(
    COMPANY_EVIDENCE_CLAIMS.map((claim) => claim.id),
    [
      ...COMPANY_ALWAYS_CLAIMS,
      ...required.filter((key) => !registrationKeys.includes(key)),
      ...(registrationRequired ? companyDisclosureGroup(['companyRegistrationNumber']) : []),
    ],
    [
      ...optional.filter((key) => !registrationKeys.includes(key)),
      ...(registrationOptional ? companyDisclosureGroup(['companyRegistrationNumber']) : []),
    ],
  );
  return evidenceClaimLists(fields);
}
export function CompanyRequestFields({
  required,
  optional,
  onChange,
}: {
  required: string[];
  optional: string[];
  onChange: (required: string[], optional: string[]) => void;
}) {
  return (
    <div className="company-request-fields">
      <EvidenceClaimSelector
        catalogue={COMPANY_EVIDENCE_CLAIMS.filter((claim) => !COMPANY_ALWAYS_CLAIMS.includes(claim.id as never))}
        required={required.filter((claim) => !COMPANY_ALWAYS_CLAIMS.includes(claim as never))}
        optional={optional}
        onChange={(nextRequired, nextOptional) => {
          const normalized = normalizeCompanyRequestFields(nextRequired, nextOptional);
          onChange(normalized.required, normalized.optional);
        }}
      />
      <details className="evidence-automatic-fields">
        <summary>Automatically included for verification</summary>
        <p>Subject DID, wallet binding, approved role, company name, credential reference, issuer proof, request ID, verifier, purpose, challenge and deadline are included by the current proof protocol.</p>
      </details>
    </div>
  );
}
