import { describe, it, expect } from 'vitest';
import {
  normalizeIngredientQuantity,
  ingredientCountryCodes,
  ingredientDetailClaims,
} from './ingredient-details.js';
describe('ingredient canonical quantities', () => {
  it.each([
    ['1.25', 'kg', '1250', 'g'],
    ['0.001', 'kg', '1', 'g'],
    ['1.234', 'litre', '1234', 'mL'],
    ['25', 'mL', '25', 'mL'],
    ['2', 'each', '2', 'each'],
    ['9'.repeat(39), 'g', '9'.repeat(39), 'g'],
  ])('converts %s %s exactly', (input, unit, quantity, canonical) =>
    expect(normalizeIngredientQuantity(input!, unit!)).toEqual({ quantity, unit: canonical }),
  );
  it.each([
    ['0', 'kg'],
    ['-1', 'g'],
    ['1e3', 'g'],
    ['1.0001', 'kg'],
    ['0.5', 'g'],
    ['0.1', 'mL'],
    ['1.5', 'each'],
    ['10', 'pound'],
    ['9'.repeat(39), 'kg'],
  ])('rejects unsupported quantity %s %s', (value, unit) =>
    expect(() => normalizeIngredientQuantity(value!, unit!)).toThrow(),
  );
  it('reuses 249 unique ISO country codes', () => {
    expect(ingredientCountryCodes).toHaveLength(249);
    expect(new Set(ingredientCountryCodes).size).toBe(249);
  });
  it('separates granular origin, complete certification and document claims', () => {
    const claims = ingredientDetailClaims(
      {
        countryCode: 'MY',
        countryName: 'Malaysia',
        region: 'Johor',
        privateAddress: 'Private address',
      },
      { kind: 'unknown' },
      [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Organic',
          issuer: 'Stated authority',
          reference: 'CERT-1',
          scope: 'Company',
          noExpiry: true,
          documents: [],
        },
      ],
    );
    expect(claims.countryOfOrigin).toBe('Malaysia');
    expect(claims.originRegion).toBe('Johor');
    expect(claims.privateOriginAddress).toBe('Private address');
    expect(claims.certification_11111111111141118111111111111111).not.toHaveProperty('documents');
  });
});
