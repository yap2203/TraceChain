import { id, ZeroAddress } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { CompanyRole } from '@tracechain/shared';
import { OrdersService } from './orders.service.js';
import { readBusinessTraceability } from './business-traceability.js';

const maker = '0x1000000000000000000000000000000000000001',
  buyer = '0x2000000000000000000000000000000000000002',
  carrier = '0x3000000000000000000000000000000000000003',
  supplier = '0x4000000000000000000000000000000000000004';
const productId = id('product'),
  ingredientId = id('ingredient'),
  reference = id('request'),
  location = id('site');
function fixture(actor = carrier, role = CompanyRole.DISTRIBUTOR) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const auth = {
    getSession: vi.fn(async () => ({
      authenticated: true,
      authorizationReady: true,
      address: actor,
      role,
    })),
  };
  const records = new Map<string, any>();
  const repo = {
    findPrivate: vi.fn(async (_kind: string, key: string) => records.get(key)),
    savePrivate: vi.fn(async (_kind: string, record: any) => {
      records.set(record.id, record);
    }),
  };
  const store = {
    encryptAndStore: vi.fn(async (text: string) => ({
      cid: 'encrypted-only',
      payload: { ciphertext: text },
    })),
    decrypt: vi.fn(async (payload: any) => payload.ciphertext),
  };
  let delivery = { mode: 1, stage: 3, distributor: carrier, batchId: productId };
  const gateway = {
    chainId: 31337,
    address: maker,
    events: vi.fn(async (_contract: string, event: string) =>
      event === 'LocationRegistered'
        ? [{ location, company: carrier, detailsHash: id('unknown-label') }]
        : [],
    ),
    read: vi.fn(async (contract: string, method: string) => {
      if (method === 'getOrder')
        return { seller: maker, buyer, expiresAt, proposedBatch: productId };
      if (method === 'productDeliveryPolicy') return 1;
      if (contract === 'productDelivery' && method === 'get') return delivery;
      if (method === 'locationOwner') return carrier;
      if (method === 'custodyPolicy') return 1;
      if (method === 'warehouses') return { distributor: carrier };
      return 0;
    }),
    prepare: vi.fn(),
  };
  const service = new OrdersService(auth as any, gateway, store as any, repo as any);
  return {
    service,
    auth,
    gateway,
    store,
    records,
    delivery,
    setDelivery: (value: typeof delivery) => {
      delivery = value;
    },
  };
}
describe('participant pickup planning', () => {
  it('stores an encrypted plan only after carrier acceptance and allows the buyer to read it', async () => {
    const f = fixture();
    expect((await f.service.pickupPlan('session', reference)).plan).toBeNull();
    const pickupAt = Math.floor(Date.now() / 1000) + 600;
    await f.service.pickupPlan('session', reference, { pickupAt });
    expect(f.store.encryptAndStore).toHaveBeenCalled();
    f.auth.getSession.mockResolvedValue({
      authenticated: true,
      authorizationReady: true,
      address: buyer,
      role: CompanyRole.RETAILER,
    });
    expect((await f.service.pickupPlan('session', reference)).plan.pickupAt).toBe(pickupAt);
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('rejects foreign readers and seller attempts to schedule on behalf of the Distributor', async () => {
    const foreign = fixture(supplier, CompanyRole.SUPPLIER);
    await expect(foreign.service.pickupPlan('session', reference)).rejects.toMatchObject({
      code: 'PICKUP_NOT_FOUND',
    });
    const seller = fixture(maker, CompanyRole.MANUFACTURER);
    await expect(
      seller.service.pickupPlan('session', reference, {
        pickupAt: Math.floor(Date.now() / 1000) + 600,
      }),
    ).rejects.toMatchObject({ code: 'PICKUP_NOT_READY' });
    expect(seller.store.encryptAndStore).not.toHaveBeenCalled();
  });
  it('rejects unaccepted assignments, custody mode, past times and times after expiry', async () => {
    const f = fixture();
    const pickupAt = Math.floor(Date.now() / 1000) + 600;
    f.setDelivery({ ...f.delivery, stage: 2 });
    await expect(f.service.pickupPlan('s', reference, { pickupAt })).rejects.toMatchObject({
      code: 'PICKUP_NOT_READY',
    });
    f.setDelivery({ ...f.delivery, mode: 2 });
    await expect(f.service.pickupPlan('s', reference, { pickupAt })).rejects.toMatchObject({
      code: 'PICKUP_NOT_READY',
    });
    f.setDelivery({ ...f.delivery });
    for (const time of [1, Math.floor(Date.now() / 1000) + 7200])
      await expect(f.service.pickupPlan('s', reference, { pickupAt: time })).rejects.toMatchObject({
        code: 'PICKUP_TIME_INVALID',
      });
  });
  it('does not reuse planning data after batch replacement and rejects tampered ciphertext', async () => {
    const f = fixture();
    await f.service.pickupPlan('s', reference, { pickupAt: Math.floor(Date.now() / 1000) + 600 });
    f.setDelivery({ ...f.delivery, batchId: id('replacement') });
    expect((await f.service.pickupPlan('s', reference)).plan).toBeNull();
    f.setDelivery(f.delivery);
    const stored = [...f.records.values()][0];
    stored.payload.ciphertext = '{"pickupAt":1}';
    await expect(f.service.pickupPlan('s', reference)).rejects.toMatchObject({
      code: 'PICKUP_UNAVAILABLE',
    });
  });
});
describe('company-owned location profile', () => {
  it('edits the owner’s display label without changing the chain location or making a transaction', async () => {
    const f = fixture();
    await f.service.updateLocationLabel('s', location, 'Warehouse North');
    const profile = await f.service.companyProfile('s');
    expect(profile.locations[0]).toMatchObject({
      location,
      label: 'Warehouse North',
      warehouse: true,
    });
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('rejects another company’s location before persisting anything', async () => {
    const f = fixture(buyer, CompanyRole.RETAILER);
    await expect(f.service.updateLocationLabel('s', location, 'Foreign')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
  });
});
describe('public-fact traceability projection', () => {
  function graph(role = 'SUPPLIER', actor = supplier) {
    const state = {
      actor,
      role,
      warehouseSupported: true,
      productDeliverySupported: true,
      orders: [],
      shipments: [],
      companies: [{ wallet: buyer, role: 'RETAILER' }],
      catalogue: [
        {
          itemId: id('ingredient-item'),
          seller: supplier,
          kind: 1,
          name: 'Registered flour',
          unit: 'kg',
          batchReference: 'FLOUR-1',
          batches: [ingredientId],
        },
        {
          itemId: id('product-item'),
          seller: maker,
          kind: 2,
          name: 'Registered bread',
          unit: 'each',
          batchReference: 'BREAD-1',
          batches: [productId],
        },
      ],
    };
    const gateway = {
      chainId: 31337,
      address: maker,
      prepare: vi.fn(),
      events: vi.fn(async (_contract: string, event: string) =>
        event === 'TransferCreated' ? [{ transferId: reference, productBatchId: productId }] : [],
      ),
      read: vi.fn(async (_contract: string, method: string) => {
        if (method === 'getIngredientLinks') return [{ batchId: ingredientId, quantity: '10' }];
        if (method === 'getProduct')
          return {
            manufacturer: maker,
            totalQuantity: '20',
            producedAt: 100,
            status: 1,
            encryptedCid: 'SECRET',
          };
        if (method === 'getBatch')
          return {
            supplier,
            producedAt: 90,
            expiresAt: 2_000_000_000,
            status: 1,
            encryptedCid: 'SECRET',
            exactSourceFacility: 'CONFIDENTIAL',
          };
        if (method === 'getTransfer')
          return {
            productBatchId: productId,
            sender: maker,
            recipient: buyer,
            quantity: '20',
            usable: '20',
            status: 2,
            dispatchedAt: 200,
            shipmentCid: 'SECRET',
          };
        if (method === 'productDeliveryCarrier') return carrier;
        return ZeroAddress;
      }),
    };
    return { state, gateway };
  }
  const names = async () =>
    new Map([
      [supplier.toLowerCase(), 'Supplier'],
      [maker.toLowerCase(), 'Manufacturer'],
      [buyer.toLowerCase(), 'Retailer'],
      [carrier.toLowerCase(), 'Distributor'],
    ]);
  it('uses the exact batch metadata when catalogue entries aggregate multiple batches', async () => {
    const f = graph();
    (f.state.catalogue[0] as any).batchSummaries = {
      [ingredientId]: { name: 'Exact flour batch', batchReference: 'EXACT-FLOUR' },
    };
    (f.state.catalogue[1] as any).batchSummaries = {
      [productId]: { name: 'Exact bread batch', batchReference: 'EXACT-BREAD' },
    };
    const result = await readBusinessTraceability(f.gateway, f.state, {}, names);
    expect(result.routes[0].ingredients[0]).toMatchObject({
      name: 'Exact flour batch',
      reference: 'EXACT-FLOUR',
    });
    expect(result.routes[0].name).toBe('Exact bread batch');
    expect(
      result.routes[0].stages.find((stage) => stage.id === 'production')?.records[0],
    ).toMatchObject({ product: 'Exact bread batch', reference: 'EXACT-BREAD' });
  });
  it('follows a Supplier ingredient into a product and actual Retailer receipt without private fields', async () => {
    const f = graph();
    const result = await readBusinessTraceability(f.gateway, f.state, {}, names);
    expect(result.routes[0].stages.map((stage) => stage.state)).toEqual([
      'recorded',
      'not-recorded',
      'recorded',
      'recorded',
      'recorded',
    ]);
    expect(result.routes[0].ingredients[0].quantityUsed).toBe('10');
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|CONFIDENTIAL|encryptedCid|shipmentCid|exactSourceFacility/,
    );
  });
  it('keeps a missing downstream journey unrecorded rather than inventing completed stages', async () => {
    const f = graph();
    f.gateway.read.mockImplementation(async (_contract, method) =>
      method === 'getIngredientLinks'
        ? []
        : method === 'getBatch'
          ? { supplier, producedAt: 90, expiresAt: 2_000_000_000, status: 1 }
          : ({} as any),
    );
    const result = await readBusinessTraceability(f.gateway, f.state, {}, names);
    expect(result.routes[0].productBatchId).toBeNull();
    expect(result.routes[0].stages.slice(1).every((stage) => stage.state === 'not-recorded')).toBe(
      true,
    );
  });
  it('does not offer another Supplier’s ingredient or an unrelated Retailer product as a root', async () => {
    const foreign = graph('SUPPLIER', carrier);
    expect(
      (await readBusinessTraceability(foreign.gateway, foreign.state, {}, names)).roots,
    ).toEqual([]);
    const retailer = graph('RETAILER', buyer);
    expect(
      (await readBusinessTraceability(retailer.gateway, retailer.state, {}, names)).roots,
    ).toEqual([]);
  });
});
