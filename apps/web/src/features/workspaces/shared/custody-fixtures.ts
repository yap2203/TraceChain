export const INCOMING_SHIPMENTS = [
  {
    id: 'SHIP-2026-088',
    product: 'Milk Chocolate',
    batch: 'CHOCOLATE-2026-050',
    sender: 'CocoaCraft Manufacturing Sdn. Bhd.',
    senderDid: 'did:ethr:0x7B82…44A1',
    qty: 500,
    dispatch: '2026-08-05',
    eta: '2026-08-09',
    status: 'awaiting' as const,
    credStatus: 'active',
    transferRef: 'TRANSFER-2026-001',
  },
];

export const DIST_INVENTORY = [
  {
    batch: 'CHOCOLATE-2026-050',
    name: 'Milk Chocolate',
    manufacturer: 'CocoaCraft Mfg.',
    received: 500,
    available: 490,
    reserved: 490,
    damaged: 10,
    date: '2026-08-09',
    status: 'accepted' as const,
  },
  {
    batch: 'CHOC-DARK-2026-040',
    name: 'Dark Chocolate',
    manufacturer: 'CocoaCraft Mfg.',
    received: 400,
    available: 400,
    reserved: 0,
    damaged: 0,
    date: '2026-07-20',
    status: 'accepted' as const,
  },
];

export const DIST_TRANSFERS = [
  {
    ref: 'TRET-2026-001',
    batch: 'CHOC-DARK-2026-040',
    product: 'Dark Chocolate',
    sender: 'Swift Distribution',
    recipient: 'FreshMart Retail',
    qty: 400,
    dispatch: '2026-07-22',
    status: 'accepted' as const,
  },
];

export const RETAIL_SHIPMENTS = [
  {
    id: 'TRET-2026-002',
    product: 'Milk Chocolate',
    batch: 'CHOCOLATE-2026-050',
    sender: 'Swift Distribution Sdn. Bhd.',
    qty: 490,
    dispatch: '2026-08-09',
    status: 'awaiting' as const,
    credStatus: 'active',
    transferRef: 'TRANSFER-2026-002',
  },
];

export const PRODUCT_RECORDS: Record<
  string,
  {
    batch: string;
    name: string;
    manufacturer: string;
    received: string;
    qty: number;
    expiry: string;
    custodyStages: number;
    ingredientCreds: number;
    status: 'verified' | 'pending' | 'attention';
    custodyHistory: {
      org: string;
      action: string;
      date: string;
      qty?: string;
      verified: boolean;
      active?: boolean;
    }[];
    ingredients: { name: string; batch: string; supplier: string }[];
  }
> = {
  'CHOCOLATE-2026-050': {
    batch: 'CHOCOLATE-2026-050',
    name: 'Milk Chocolate',
    manufacturer: 'CocoaCraft Mfg. Sdn. Bhd.',
    received: '2026-08-09',
    qty: 490,
    expiry: '2027-02-01',
    custodyStages: 4,
    ingredientCreds: 3,
    status: 'verified',
    custodyHistory: [
      {
        org: 'CocoaCraft Manufacturing Sdn. Bhd.',
        action: 'Product batch created',
        date: '1 Aug 2026, 09:14',
        qty: '500 units produced',
        verified: true,
      },
      {
        org: 'Swift Distribution Sdn. Bhd.',
        action: 'Accepted product custody',
        date: '9 Aug 2026, 11:30',
        qty: '500 received, 10 damaged, 490 available',
        verified: true,
      },
      {
        org: 'Swift Distribution Sdn. Bhd.',
        action: 'Transferred to retailer',
        date: '9 Aug 2026, 14:15',
        qty: '490 units dispatched',
        verified: true,
      },
      {
        org: 'FreshMart Retail Sdn. Bhd.',
        action: 'Accepted product custody',
        date: '9 Aug 2026, 16:00',
        qty: '490 units received',
        verified: true,
      },
    ],
    ingredients: [
      { name: 'Cocoa Powder', batch: 'COCOA-2026-001', supplier: 'ABC Ingredients' },
      { name: 'Milk Powder', batch: 'MILK-2026-010', supplier: 'ABC Ingredients' },
      { name: 'Cane Sugar', batch: 'SUGAR-2026-090', supplier: 'ABC Ingredients' },
    ],
  },
  'CHOC-DARK-2026-040': {
    batch: 'CHOC-DARK-2026-040',
    name: 'Dark Chocolate',
    manufacturer: 'CocoaCraft Mfg. Sdn. Bhd.',
    received: '2026-07-20',
    qty: 400,
    expiry: '2027-01-20',
    custodyStages: 4,
    ingredientCreds: 2,
    status: 'verified',
    custodyHistory: [
      {
        org: 'CocoaCraft Manufacturing Sdn. Bhd.',
        action: 'Product batch created',
        date: '18 Jul 2026, 10:00',
        qty: '400 units produced',
        verified: true,
      },
      {
        org: 'Swift Distribution Sdn. Bhd.',
        action: 'Accepted product custody',
        date: '20 Jul 2026, 09:00',
        qty: '400 units received',
        verified: true,
      },
      {
        org: 'Swift Distribution Sdn. Bhd.',
        action: 'Transferred to retailer',
        date: '22 Jul 2026, 14:00',
        qty: '400 units dispatched',
        verified: true,
      },
      {
        org: 'FreshMart Retail Sdn. Bhd.',
        action: 'Accepted product custody',
        date: '22 Jul 2026, 17:00',
        qty: '400 units received',
        verified: true,
      },
    ],
    ingredients: [
      { name: 'Cocoa Powder', batch: 'COCOA-2026-001', supplier: 'ABC Ingredients' },
      { name: 'Cane Sugar', batch: 'SUGAR-2026-090', supplier: 'ABC Ingredients' },
    ],
  },
  'BISCUIT-2026-018': {
    batch: 'BISCUIT-2026-018',
    name: 'Oat Biscuit',
    manufacturer: 'GrainCo Processing Sdn. Bhd.',
    received: '2026-07-05',
    qty: 200,
    expiry: '2027-01-05',
    custodyStages: 4,
    ingredientCreds: 4,
    status: 'verified',
    custodyHistory: [
      {
        org: 'GrainCo Processing Sdn. Bhd.',
        action: 'Product batch created',
        date: '1 Jul 2026, 08:00',
        qty: '200 units produced',
        verified: true,
      },
      {
        org: 'Swift Distribution Sdn. Bhd.',
        action: 'Accepted product custody',
        date: '3 Jul 2026, 10:00',
        qty: '200 units received',
        verified: true,
      },
      {
        org: 'Swift Distribution Sdn. Bhd.',
        action: 'Transferred to retailer',
        date: '4 Jul 2026, 11:00',
        qty: '200 units dispatched',
        verified: true,
      },
      {
        org: 'FreshMart Retail Sdn. Bhd.',
        action: 'Accepted product custody',
        date: '5 Jul 2026, 09:00',
        qty: '200 units received',
        verified: true,
      },
    ],
    ingredients: [
      { name: 'Rolled Oats', batch: 'OAT-2026-011', supplier: 'GrainCo' },
      { name: 'Wheat Flour', batch: 'WHEAT-2026-009', supplier: 'GrainCo' },
      { name: 'Honey', batch: 'HONEY-2026-003', supplier: 'BeeNature' },
      { name: 'Palm Oil', batch: 'OIL-2026-022', supplier: 'TropicalOil' },
    ],
  },
};
