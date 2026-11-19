import { describe, expect, it } from 'vitest';
import type { IngredientCredential } from '@tracechain/ssi';
import { missingLegacyIngredientClaims } from './legacy-ingredient-claims.js';

describe('legacy full-disclosure claim requirements', () => {
  const subject = {
    origin: 'Original supplier origin text',
    certifications: ['Original certificate text'],
    allergenInformation: 'Unknown',
  } as IngredientCredential['credentialSubject'];
  it('preserves legacy text without inventing structured certification or origin metadata', () => {
    expect(
      missingLegacyIngredientClaims(subject, [
        'countryOfOrigin',
        'certificationDetails',
        'Full Ingredient Credential',
      ]),
    ).toEqual([]);
    expect(
      missingLegacyIngredientClaims(subject, [
        'certifications',
        'certificationDocuments',
        'originRegion',
        'privateOriginAddress',
      ]),
    ).toEqual(['certifications', 'certificationDocuments', 'originRegion', 'privateOriginAddress']);
  });
  it('rejects absent and empty mandatory fields', () => {
    expect(
      missingLegacyIngredientClaims({ ...subject, certifications: [] }, [
        'certificationDetails',
        'batchId',
      ]),
    ).toEqual(['certificationDetails', 'batchId']);
  });
});
