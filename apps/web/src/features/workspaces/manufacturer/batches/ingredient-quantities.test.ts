import { describe, expect, it } from 'vitest';
import {
  ingredientUnitOptions,
  registeredIngredientQuantity as convert,
} from './ingredient-quantities';
describe('exact ingredient quantities', () => {
  it('converts compatible decimal display units into whole registered units', () => {
    expect(convert('1.25', 'kg', 'g')).toEqual({ quantity: '1250' });
    expect(convert('0.5', 'litre', 'ml')).toEqual({ quantity: '500' });
    expect(convert('1000', 'g', 'kg')).toEqual({ quantity: '1' });
    expect(convert('9007199254740993', 'each', 'each')).toEqual({ quantity: '9007199254740993' });
  });
  it('rejects fractional registered quantities, incompatible units, zero and invalid input', () => {
    for (const [value, from, to] of [
      ['0.1', 'g', 'kg'],
      ['3', 'litre', 'g'],
      ['0', 'kg', 'g'],
      ['1e3', 'g', 'g'],
      ['-1', 'kg', 'kg'],
      ['1.1234567', 'kg', 'g'],
    ])
      expect(convert(value, from, to).error).toBeTruthy();
    expect(ingredientUnitOptions('each')).toEqual([{ value: 'each', label: 'each' }]);
    expect(ingredientUnitOptions('constructor')).toEqual([
      { value: 'constructor', label: 'constructor' },
    ]);
    expect(ingredientUnitOptions('g').map((option) => option.value)).toEqual(['g', 'kg', 'mg']);
  });
});
