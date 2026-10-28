export const INGREDIENT_CREDS = [
  {
    id: 'IC-COCOA-2026-001',
    name: 'Cocoa Powder',
    batch: 'COCOA-2026-001',
    supplier: 'ABC Ingredients Sdn. Bhd.',
    status: 'active' as const,
    expires: '2027-04-15',
    verified: true,
  },
  {
    id: 'IC-MILK-2026-010',
    name: 'Milk Powder',
    batch: 'MILK-2026-010',
    supplier: 'ABC Ingredients Sdn. Bhd.',
    status: 'active' as const,
    expires: '2027-05-01',
    verified: true,
  },
  {
    id: 'IC-SUGAR-2026-090',
    name: 'Cane Sugar',
    batch: 'SUGAR-2026-090',
    supplier: 'ABC Ingredients Sdn. Bhd.',
    status: 'active' as const,
    expires: '2027-06-10',
    verified: true,
  },
];

export const PRODUCT_BATCHES = [
  {
    id: 'CHOCOLATE-2026-050',
    name: 'Milk Chocolate',
    produced: '2026-08-01',
    qty: 500,
    ingredients: 3,
    custodian: 'CocoaCraft Manufacturing',
    status: 'active' as const,
  },
  {
    id: 'CHOC-DARK-2026-040',
    name: 'Dark Chocolate',
    produced: '2026-07-20',
    qty: 400,
    ingredients: 2,
    custodian: 'Swift Distribution Sdn. Bhd.',
    status: 'active' as const,
  },
];

export const BATCH_INGREDIENTS: Record<
  string,
  { name: string; batch: string; supplier: string; credId: string }[]
> = {
  'CHOCOLATE-2026-050': [
    {
      name: 'Cocoa Powder',
      batch: 'COCOA-2026-001',
      supplier: 'ABC Ingredients',
      credId: 'IC-COCOA-2026-001',
    },
    {
      name: 'Milk Powder',
      batch: 'MILK-2026-010',
      supplier: 'ABC Ingredients',
      credId: 'IC-MILK-2026-010',
    },
    {
      name: 'Cane Sugar',
      batch: 'SUGAR-2026-090',
      supplier: 'ABC Ingredients',
      credId: 'IC-SUGAR-2026-090',
    },
  ],
  'CHOC-DARK-2026-040': [
    {
      name: 'Cocoa Powder',
      batch: 'COCOA-2026-001',
      supplier: 'ABC Ingredients',
      credId: 'IC-COCOA-2026-001',
    },
    {
      name: 'Cane Sugar',
      batch: 'SUGAR-2026-090',
      supplier: 'ABC Ingredients',
      credId: 'IC-SUGAR-2026-090',
    },
  ],
};
