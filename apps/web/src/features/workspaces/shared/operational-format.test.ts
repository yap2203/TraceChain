import { encodeBytes32String } from 'ethers';
import { describe, expect, it } from 'vitest';

import {
  formatOperationalPrice,
  formatOperationalQuantity,
  hasPresentationValue,
  operationalUnit,
} from './operational-format';

describe('operational unit formatting', () => {
  it('hides only absent optional values, preserving zero and disclosure or error labels', () => {
    for (const value of [undefined, null, '', '  '])
      expect(hasPresentationValue(value)).toBe(false);
    for (const value of [0, '0', 'Not shared', 'Unavailable'])
      expect(hasPresentationValue(value)).toBe(true);
  });
  it('decodes the on-chain each unit into user-facing units', () => {
    const encoded = encodeBytes32String('each');
    expect(formatOperationalQuantity('123', encoded)).toBe('123 each');
    expect(formatOperationalPrice('MYR', '12', encoded)).toBe('MYR 12.00 / each');
  });

  it('shows safe custom units and falls back neutrally for malformed bytes', () => {
    const encoded = encodeBytes32String('boxes');
    expect(operationalUnit(encoded)).toEqual({
      canonical: 'boxes',
      priceLabel: 'boxes',
      quantityLabel: 'boxes',
      raw: encoded,
    });
    expect(formatOperationalQuantity('25', encoded)).toBe('25 boxes');
    expect(formatOperationalPrice('MYR', '7.5', encoded)).toBe('MYR 7.50 / boxes');
    const malformed = `0x${'ff'.repeat(32)}`;
    expect(formatOperationalQuantity('4', malformed)).toBe('4 units');
  });
});
