import { encodeBytes32String } from 'ethers';
import { describe, expect, it } from 'vitest';

import {
  formatOperationalPrice,
  formatOperationalQuantity,
  operationalUnit,
} from './operational-format';

describe('operational unit formatting', () => {
  it('decodes the on-chain each unit into user-facing units', () => {
    const encoded = encodeBytes32String('each');
    expect(formatOperationalQuantity('123', encoded)).toBe('123 units');
    expect(formatOperationalPrice('MYR', '12', encoded)).toBe('MYR 12.00 per unit');
  });

  it('does not guess an unknown encoded unit', () => {
    const encoded = encodeBytes32String('crate');
    expect(operationalUnit(encoded)).toEqual({ quantityLabel: 'unit unavailable', raw: encoded });
    expect(formatOperationalQuantity('4', encoded)).toBe('4 unit unavailable');
  });
});
