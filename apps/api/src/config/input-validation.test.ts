import { describe, expect, it } from 'vitest';
import { requestDateSchema } from './input-validation.js';
import { ingredientBatchRequestSchema } from '../modules/ingredient-batches/ingredient-batch.schema.js';
describe('API input validation', () => {
  it('accepts explicit calendar/ISO dates and rejects coercions and impossible dates', () => {
    for (const input of ['2030-01-01', '2030-01-01T12:00:00.000Z', new Date('2030-01-01')])
      expect(requestDateSchema.safeParse(input).success).toBe(true);
    for (const input of [
      null,
      true,
      false,
      1,
      '',
      'bad-date',
      '2026-02-30',
      '2026-13-01',
      '2030-01-01T30:00:00Z',
    ])
      expect(requestDateSchema.safeParse(input).success).toBe(false);
  });
  it('rejects bad quantities, blank/oversized text and reports date errors against the field', () => {
    const valid = {
      allergenInformation: '',
      batchReference: 'TEST-1',
      category: 'other',
      certifications: [],
      expiryDate: '2099-01-01',
      ingredientName: 'Ingredient',
      origin: 'Malaysia',
      productionDate: '2020-01-01',
      quantity: '5',
      unit: 'kg',
    };
    expect(ingredientBatchRequestSchema.safeParse(valid).success).toBe(true);
    for (const change of [
      { quantity: '1e3' },
      { quantity: '-1' },
      { quantity: '0' },
      { quantity: '9'.repeat(40) },
      { ingredientName: '  ' },
      { origin: 'x'.repeat(161) },
      { productionDate: true },
    ])
      expect(ingredientBatchRequestSchema.safeParse({ ...valid, ...change }).success).toBe(false);
    const result = ingredientBatchRequestSchema.safeParse({
      ...valid,
      productionDate: '2098-01-01',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.some((issue) => issue.path[0] === 'productionDate')).toBe(true);
  });
});
