export const REQUESTS = [
  {
    id: 'REQ-2026-031',
    from: 'CocoaCraft Manufacturing Sdn. Bhd.',
    batch: 'COCOA-2026-001',
    ingredient: 'Cocoa Powder',
    due: '2026-08-15',
    status: 'pending' as const,
    claims: ['Ingredient name', 'Batch number', 'Origin', 'Allergen status', 'Certification'],
  },
  {
    id: 'REQ-2026-029',
    from: 'CocoaCraft Manufacturing Sdn. Bhd.',
    batch: 'MILK-2026-010',
    ingredient: 'Milk Powder',
    due: '2026-08-12',
    status: 'shared' as const,
    claims: ['Ingredient name', 'Batch number', 'Allergen status'],
  },
];
