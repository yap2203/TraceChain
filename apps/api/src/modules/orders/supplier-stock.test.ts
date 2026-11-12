import { describe, expect, it } from 'vitest';
import { supplierStock } from './supplier-stock.js';

const catalogue = [
  {
    itemId: 'item',
    seller: 'supplier',
    kind: 1,
    unit: 'g',
    batches: ['batch'],
    batchDetails: [{ batchId: 'batch', supplierAvailable: '100' }],
  },
];
const order = {
  orderId: 'request',
  seller: 'supplier',
  itemId: 'item',
  requestedBatch: 'batch',
  requested: '20',
  approvedReceivedQuantity: '0',
  status: 1,
  expiresAt: 200,
  isRequestOnly: true,
  decision: { status: 0 },
};
const calculate = (orders = [order], items = catalogue) =>
  supplierStock('supplier', items, orders, 100)[0];

describe('Supplier remaining-stock projection', () => {
  it('subtracts pending and approved demand without mutating actual stock', () => {
    const result = calculate([
      order,
      { ...order, orderId: 'approved', requested: '30', decision: { status: 1 } },
    ]);
    expect(result).toMatchObject({
      availableQuantity: '100',
      pendingQuantity: '20',
      approvedQuantity: '30',
      outstandingQuantity: '50',
      remainingAfterRequests: '50',
      shortfall: '0',
      requestCount: 2,
    });
    expect(catalogue[0].batchDetails[0].supplierAvailable).toBe('100');
  });
  it('subtracts only the unreceived balance after a partial receipt already debited source stock', () => {
    const result = calculate(
      [{ ...order, requested: '30', approvedReceivedQuantity: '10', decision: { status: 1 } }],
      [{ ...catalogue[0], batchDetails: [{ batchId: 'batch', supplierAvailable: '90' }] }],
    );
    expect(result).toMatchObject({
      availableQuantity: '90',
      approvedQuantity: '20',
      remainingAfterRequests: '70',
    });
  });
  it('excludes rejected, expired, closed, legacy-reserved and other sellers’ orders', () => {
    expect(
      calculate([
        { ...order, decision: { status: 2 } },
        { ...order, expiresAt: 100 },
        { ...order, status: 3 },
        { ...order, isRequestOnly: false },
        { ...order, seller: 'outsider' },
        { ...order, approvedReceivedQuantity: '20' },
      ]),
    ).toMatchObject({ remainingAfterRequests: '100', requestCount: 0 });
  });
  it('clamps remaining to zero and reports excess demand with exact large integers', () => {
    const huge = '9007199254740993123456789';
    expect(calculate([{ ...order, requested: huge }])).toMatchObject({
      remainingAfterRequests: '0',
      shortfall: (BigInt(huge) - 100n).toString(),
    });
  });
  it('keeps batches separate and never guesses an unbound legacy multi-batch request', () => {
    const items = [
      {
        ...catalogue[0],
        batches: ['batch', 'second'],
        batchDetails: [
          ...catalogue[0].batchDetails,
          { batchId: 'second', supplierAvailable: '50' },
        ],
      },
    ];
    expect(
      supplierStock('supplier', items, [order], 100).map((stock) => stock.remainingAfterRequests),
    ).toEqual(['80', '50']);
    expect(calculate([{ ...order, requestedBatch: '' }], items).remainingAfterRequests).toBeNull();
    expect(calculate([{ ...order, requestedBatch: '' }]).remainingAfterRequests).toBe('80');
    expect(supplierStock('outsider', items, [order], 100)).toEqual([]);
  });
  it('does not report an accurate projection when an older request has no readable decision', () => {
    const result = supplierStock(
      'supplier',
      catalogue,
      [{ ...order, decision: undefined }],
      100,
    )[0];
    expect(result.availableQuantity).toBe('100');
    expect(result.remainingAfterRequests).toBeNull();
    expect(result.shortfall).toBeNull();
  });
});
