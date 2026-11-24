import { it, expect } from 'vitest';
import {
  CURRENT_INGREDIENT_REQUEST_CLAIMS,
  companyDisclosureGroup,
  toggleCompanyDisclosure,
  ingredientDisclosureErrors,
  ingredientPolicyRequirements,
  toggleIngredientDisclosure,
  expandIngredientRequestedClaims,
  isRetiredIngredientClaim,
  visibleIngredientClaims,
  COMPANY_EVIDENCE_CLAIMS,
  INGREDIENT_EVIDENCE_CLAIMS,
  validateEvidenceClaimSelection,
} from './disclosure-policy.js';
it('publishes stable claim catalogues and rejects unknown or duplicate selections', () => {
  expect(COMPANY_EVIDENCE_CLAIMS.find((claim) => claim.id === 'walletAddress')?.credentialPath).toBe(
    'credentialSubject.walletAddress',
  );
  expect(INGREDIENT_EVIDENCE_CLAIMS.find((claim) => claim.id === 'expiryDate')?.group).toBe(
    'Dates and quantity',
  );
  expect(validateEvidenceClaimSelection(['companyName', 'role'], COMPANY_EVIDENCE_CLAIMS)).toBe(
    true,
  );
  expect(validateEvidenceClaimSelection(['companyName', 'companyName'], COMPANY_EVIDENCE_CLAIMS)).toBe(
    false,
  );
  expect(validateEvidenceClaimSelection(['unknown'], COMPANY_EVIDENCE_CLAIMS)).toBe(false);
});
it('keeps processing and quality claims out of new form choices without removing legacy support', () => {
  const choices = CURRENT_INGREDIENT_REQUEST_CLAIMS.map(([key]) => key);
  expect(choices).toContain('productionDate');
  expect(choices).toContain('certifications');
  expect(choices).not.toContain('processingCountry');
  expect(choices).not.toContain('processingLocation');
  expect(choices).not.toContain('qualityTests');
  expect(choices).not.toContain('qualityDocuments');
  expect(choices).not.toContain('productionDateMeaning');
});
it('hides retired legacy values while preserving useful ingredient evidence', () => {
  expect(isRetiredIngredientClaim('qualityTest_' + 'a'.repeat(32))).toBe(true);
  expect(
    visibleIngredientClaims({
      countryOfOrigin: 'Ghana',
      processingCountry: 'MY',
      qualityTestSummary: 'Legacy result',
      ['qualityDocuments_' + 'a'.repeat(32)]: { documents: [] },
      originDetails: {
        countryName: 'Ghana',
        region: 'Ashanti',
        processingLocation: 'Legacy plant',
      },
      allergenDeclaration: { kind: 'declaresNone' },
    }),
  ).toEqual({
    countryOfOrigin: 'Ghana',
    originDetails: { countryName: 'Ghana', region: 'Ashanti' },
    allergenDeclaration: { kind: 'declaresNone' },
  });
});
it('groups registration fields and leaves internal/application references independent', () => {
  expect(companyDisclosureGroup(['companyRegistrationNumber'])).toEqual([
    'companyRegistrationNumber',
    'registrationCountry',
  ]);
  expect(
    toggleCompanyDisclosure(
      ['companyName', 'companyRegistrationNumber', 'registrationCountry'],
      'registrationCountry',
      false,
    ),
  ).toEqual(['companyName']);
});
it('enforces food suitability, explicitly permitted unknown and associated details', () => {
  const policy = { policyVersion: 2 as const, template: 'food' as const };
  expect(
    ingredientDisclosureErrors({ allergenDeclaration: { kind: 'unknown' } }, policy, []),
  ).not.toEqual([]);
  expect(
    ingredientDisclosureErrors(
      { allergenDeclaration: { kind: 'unknown' } },
      { ...policy, allowUnknownAllergens: true },
      [],
    ),
  ).toEqual([]);
  expect(
    ingredientDisclosureErrors({ allergenDeclaration: { kind: 'contains' } }, policy, []),
  ).not.toEqual([]);
  expect(
    ingredientDisclosureErrors(
      { allergenDeclaration: { kind: 'contains', details: 'Milk' } },
      policy,
      [],
    ),
  ).toEqual([]);
  expect(ingredientDisclosureErrors({ allergenDeclaration: 'None' }, policy, [])).not.toEqual([]);
});
it('requires traceability dates and keeps certificate scope distinct from laboratory evidence', () => {
  expect(ingredientPolicyRequirements({ template: 'basic' }, [])).toEqual([
    'countryOfOrigin',
    'productionDate',
    'expiryDate',
  ]);
  const cert = { id: 'a', name: 'Organic', scope: 'Company', noExpiry: true };
  const payload = { ['certification_' + 'a'.repeat(32)]: cert };
  expect(
    ingredientDisclosureErrors(
      payload,
      { template: 'certification', certificationRequirement: { scope: 'This batch' } },
      [],
      'BATCH',
    ),
  ).not.toEqual([]);
  expect(ingredientDisclosureErrors(payload, { template: 'quality' }, [], 'BATCH')).not.toEqual([]);
  expect(
    ingredientDisclosureErrors(
      payload,
      {
        template: 'certification',
        certificationRequirement: { scope: 'Company', name: 'Organic' },
      },
      [],
      'BATCH',
    ),
  ).toEqual([]);
});
it('selects a single file plus its parent and never adds a sibling document', () => {
  const payload = {
    ['certification_' + 'a'.repeat(32)]: { id: 'a' },
    ['certificationDocuments_' + 'b'.repeat(32)]: { certificationId: 'a' },
    ['certificationDocuments_' + 'c'.repeat(32)]: { certificationId: 'a' },
  };
  const selected = toggleIngredientDisclosure(
    [],
    'certificationDocuments_' + 'b'.repeat(32),
    true,
    payload,
  );
  expect(selected).toEqual(['certificationDocuments_' + 'b'.repeat(32), 'certification_a']);
  expect(expandIngredientRequestedClaims(['certificationDocuments'], payload)).toHaveLength(3);
});
