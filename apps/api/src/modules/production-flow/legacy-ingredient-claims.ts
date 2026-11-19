import type { IngredientCredential } from '@tracechain/ssi';

/** Legacy presentations disclose the whole VC, but cannot invent newer structured claims. */
export function missingLegacyIngredientClaims(
  subject: IngredientCredential['credentialSubject'],
  required: string[],
): string[] {
  const origin = subject.originDetails;
  const values: Record<string, unknown> = {
    ...subject,
    countryOfOrigin: origin?.countryName ?? subject.origin,
    originRegion: origin?.region,
    originCity: origin?.city,
    exactSourceFacility: origin?.facility,
    privateOriginAddress: origin?.privateAddress,
    processingLocation: origin?.processingLocation,
    processingCountry: origin?.processingCountry,
    qualityDocuments: subject.qualityTests?.flatMap((entry) => entry.documents),
    allergenDeclaration: subject.allergen ?? subject.allergenInformation,
    certificationDetails: subject.certifications,
    certifications: subject.certificationEntries,
    certificationDocuments: subject.certificationEntries?.flatMap((entry) => entry.documents),
  };
  return required.filter((key) => {
    if (key === 'Full Ingredient Credential') return false;
    const value = values[key];
    return value == null || value === '' || (Array.isArray(value) && value.length === 0);
  });
}
