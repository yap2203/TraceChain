/** Versioned request policy. These lists are not authorization evidence. */
export const DISCLOSURE_POLICY_VERSION = 2 as const;
export const COMPANY_ALWAYS_CLAIMS = ['companyName', 'role', 'walletAddress', 'id'] as const;
export const COMPANY_REGISTRATION_GROUP = [
  'companyRegistrationNumber',
  'registrationCountry',
] as const;
export function companyDisclosureGroup(claims: readonly string[]): string[] {
  return [
    ...new Set([
      ...claims,
      ...(claims.some((key) => COMPANY_REGISTRATION_GROUP.includes(key as never))
        ? COMPANY_REGISTRATION_GROUP
        : []),
    ]),
  ];
}
export function toggleCompanyDisclosure(
  current: string[],
  claim: string,
  included: boolean,
): string[] {
  const group = companyDisclosureGroup([claim]);
  return included
    ? [...new Set([...current, ...group])]
    : current.filter((key) => !group.includes(key));
}
export const INGREDIENT_ALWAYS_CLAIMS = [
  'ingredientName',
  'batchId',
  'batchReference',
  'supplierWallet',
  'supplierDid',
] as const;
export const INGREDIENT_REQUEST_CLAIMS = [
  ['countryOfOrigin', 'Raw-material country of origin'],
  ['productionDate', 'Production / processing date (Supplier reported)'],
  ['expiryDate', 'Ingredient expiry date'],
  ['allergenDeclaration', 'Allergen status and associated details'],
  ['originRegion', 'Origin region'],
  ['originCity', 'Origin city / district'],
  ['exactSourceFacility', 'Source facility / farm reference'],
  ['privateOriginAddress', 'Private source address'],
  ['processingCountry', 'Processing country'],
  ['processingLocation', 'Processing facility reference'],
  ['certifications', 'Certification entry (type and scope)'],
  ['certificationDocuments', 'Certification documents (whole files)'],
  ['qualityTests', 'Laboratory test results and context'],
  ['qualityDocuments', 'Laboratory evidence files (whole files)'],
  ['qualityTestSummary', 'Legacy quality test summary'],
  ['internalQualityRemarks', 'Internal quality remarks'],
  ['certificationDetails', 'Legacy certification text'],
] as const;
/** Current form choices; the wider set remains valid for historical requests/credentials. */
export const CURRENT_INGREDIENT_REQUEST_CLAIMS = INGREDIENT_REQUEST_CLAIMS.filter(
  ([key]) =>
    ![
      'processingCountry',
      'processingLocation',
      'qualityTests',
      'qualityDocuments',
      'qualityTestSummary',
      'internalQualityRemarks',
    ].includes(key),
).map(
  ([key, label]) =>
    [key, key === 'productionDate' ? 'Production date (Supplier reported)' : label] as const,
);
export const INGREDIENT_REQUEST_TEMPLATES = {
  custom: { label: 'Custom request', required: [] },
  basic: {
    label: 'Basic traceability',
    required: ['countryOfOrigin', 'productionDate', 'expiryDate'],
  },
  food: { label: 'Food suitability', required: ['allergenDeclaration'] },
  certification: { label: 'Certification check', required: ['certifications'] },
  quality: { label: 'Quality check', required: ['qualityTests'] },
} as const;
export type IngredientRequestTemplate = keyof typeof INGREDIENT_REQUEST_TEMPLATES;
export interface IngredientRequestPolicy {
  policyVersion?: 2;
  template?: IngredientRequestTemplate;
  certificationRequirement?: {
    name?: string;
    scope?: 'Company' | 'Facility' | 'Ingredient' | 'This batch';
    scopeReference?: string;
  };
  allowUnknownAllergens?: boolean;
}
export function ingredientPolicyRequirements(
  policy: IngredientRequestPolicy,
  required: string[] = [],
): string[] {
  return [
    ...new Set([
      ...required,
      ...(INGREDIENT_REQUEST_TEMPLATES[policy.template ?? 'custom']?.required ?? []),
    ]),
  ];
}
export function expandIngredientRequestedClaims(
  claims: string[],
  payload: Record<string, unknown>,
): string[] {
  const keys = Object.keys(payload);
  if (claims.includes('productionDate') && keys.includes('productionDateMeaning'))
    claims = [...claims, 'productionDateMeaning'];
  return [
    ...new Set(
      claims.flatMap((key) =>
        key === 'certifications'
          ? keys.filter((k) => k.startsWith('certification_'))
          : key === 'certificationDocuments'
            ? keys.filter(
                (k) => k.startsWith('certificationDocuments_') || k.startsWith('certification_'),
              )
            : key === 'qualityTests'
              ? keys.filter((k) => k.startsWith('qualityTest_'))
              : key === 'qualityDocuments'
                ? keys.filter(
                    (k) => k.startsWith('qualityDocuments_') || k.startsWith('qualityTest_'),
                  )
                : [key],
      ),
    ),
  ];
}
export function toggleIngredientDisclosure(
  current: string[],
  key: string,
  include: boolean,
  payload: Record<string, unknown>,
): string[] {
  const selected = include ? [...current, key] : current.filter((value) => value !== key);
  if (
    include &&
    (key.startsWith('certificationDocuments_') || key.startsWith('qualityDocuments_'))
  ) {
    const quality = key.startsWith('qualityDocuments_');
    const value = payload[key] as { certificationId?: string; qualityTestId?: string };
    selected.push(
      (quality ? 'qualityTest_' : 'certification_') +
        String(quality ? value.qualityTestId : value.certificationId).replaceAll('-', ''),
    );
  }
  if (!include && (key.startsWith('certification_') || key.startsWith('qualityTest_')))
    return selected.filter((value) => {
      const file = payload[value] as
        { certificationId?: string; qualityTestId?: string } | undefined;
      return !(
        (value.startsWith('certificationDocuments_') || value.startsWith('qualityDocuments_')) &&
        (file?.certificationId ?? file?.qualityTestId) === (payload[key] as { id?: string })?.id
      );
    });
  return [...new Set(selected)];
}
/** Evaluate verified disclosed claims; never call this to authenticate an unverified payload. */
export function ingredientDisclosureErrors(
  payload: Record<string, unknown>,
  policy: IngredientRequestPolicy,
  required: string[],
  batchReference?: string,
  at: Date = new Date(),
): string[] {
  const errors: string[] = [];
  const requirements = ingredientPolicyRequirements(policy, required);
  if (
    payload.policyVersion === 2 &&
    requirements.includes('productionDate') &&
    !payload.productionDateMeaning
  )
    errors.push(
      'The signed meaning of this date is unavailable. An authorized replacement credential is needed.',
    );
  for (const key of requirements) {
    if (
      ['certifications', 'certificationDocuments', 'qualityTests', 'qualityDocuments'].includes(key)
    )
      continue;
    if (
      payload[key] == null ||
      payload[key] === '' ||
      (Array.isArray(payload[key]) && !payload[key].length)
    )
      errors.push(`Required information is unavailable: ${key}.`);
  }
  const certificationEntries = Object.entries(payload)
    .filter(([key]) => /^certification_[a-f0-9]{32}$/.test(key))
    .map(([, value]) => value as Record<string, unknown>);
  const rule = policy.certificationRequirement;
  const matching = certificationEntries.filter(
    (entry) =>
      (!rule?.name || String(entry.name).toLowerCase() === rule.name.toLowerCase()) &&
      (!rule?.scope || entry.scope === rule.scope) &&
      (!rule?.scopeReference || entry.scopeReference === rule.scopeReference) &&
      (entry.scope !== 'This batch' || entry.scopeReference === batchReference) &&
      (entry.noExpiry === true ||
        (typeof entry.expiryDate === 'string' &&
          entry.expiryDate >= at.toISOString().slice(0, 10))) &&
      (!entry.issueDate || String(entry.issueDate) <= at.toISOString().slice(0, 10)),
  );
  if (requirements.includes('certifications') && !matching.length)
    errors.push(
      'A certification matching the requested type, scope and batch reference is required.',
    );
  const documents = Object.entries(payload)
    .filter(([key]) => key.startsWith('certificationDocuments_'))
    .map(([, v]) => v as { certificationId?: string });
  if (rule && certificationEntries.length && matching.length !== certificationEntries.length)
    errors.push('A disclosed certification does not match the requested type, scope or validity.');
  if (
    requirements.includes('certificationDocuments') &&
    !documents.some((doc) => matching.some((entry) => entry.id === doc.certificationId))
  )
    errors.push('An explicitly selected document for a matching certification is required.');
  const tests = Object.entries(payload)
    .filter(([key]) => /^qualityTest_[a-f0-9]{32}$/.test(key))
    .map(([, value]) => value as Record<string, unknown>);
  if (
    requirements.includes('qualityTests') &&
    !tests.some((test) => test.testedBatchReference === batchReference)
  )
    errors.push('Laboratory results for this exact batch are required.');
  if (
    requirements.includes('qualityDocuments') &&
    !Object.entries(payload).some(
      ([key, value]) =>
        key.startsWith('qualityDocuments_') &&
        tests.some(
          (test) =>
            test.id === (value as { qualityTestId?: string }).qualityTestId &&
            test.testedBatchReference === batchReference,
        ),
    )
  )
    errors.push('Select a laboratory document and its complete test context for this batch.');
  if (requirements.includes('allergenDeclaration')) {
    const allergen = payload.allergenDeclaration as { kind?: string; details?: string } | undefined;
    if (
      !allergen ||
      typeof allergen !== 'object' ||
      !['contains', 'mayContain', 'declaresNone', 'unknown'].includes(allergen.kind ?? '')
    )
      errors.push(
        'An explicit signed allergen status is required; legacy free text cannot satisfy this policy.',
      );
    else if (allergen.kind === 'unknown' && !policy.allowUnknownAllergens)
      errors.push('Unknown allergen status does not satisfy this request.');
    else if (['contains', 'mayContain'].includes(allergen.kind!) && !allergen.details?.trim())
      errors.push('Associated allergen details are required.');
  }
  return errors;
}
