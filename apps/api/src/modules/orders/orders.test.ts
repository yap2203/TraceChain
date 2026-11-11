import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ingredientBatchRequestSchema } from '../ingredient-batches/ingredient-batch.schema.js';
import { productRequestSchema } from '../production-flow/production-flow.schema.js';
import express from 'express';
import request from 'supertest';
import { CompanyRole } from '@tracechain/shared';
import { encodeBytes32String, id } from 'ethers';
import { OrdersService } from './orders.service.js';
import { createOrdersRouter } from './orders.routes.js';
import type { OrdersGateway } from './orders.gateway.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';

const buyer = '0x1000000000000000000000000000000000000001';
const seller = '0x2000000000000000000000000000000000000002';
const outsider = '0x3000000000000000000000000000000000000003';
const orderId = id('order'),
  itemId = id('item'),
  batchId = id('batch');
const operationId = '00000000-0000-4000-8000-000000000001';
function fixture(actor = buyer, authorized = true, role = CompanyRole.MANUFACTURER) {
  const auth = {
    getSession: vi.fn().mockResolvedValue({
      authenticated: authorized,
      authorizationReady: authorized,
      address: actor,
      role,
    }),
  };
  const records = new Map<string, any>();
  const repository = {
    findPrivate: vi.fn(async (_kind, key) => records.get(key)),
    savePrivate: vi.fn(async (_kind, record) => {
      records.set(record.id, record);
    }),
  };
  const store = {
    encryptAndStore: vi.fn(async (text) => ({
      cid: 'encrypted-cid',
      payload: { ciphertext: text },
    })),
    decrypt: vi.fn(async (payload) => payload.ciphertext),
  };
  const gateway = {
    chainId: 31337,
    address: seller,
    events: vi.fn(async (_contract: string, name: string) =>
      name === 'ItemListed'
        ? [{ itemId, batchId }]
        : name === 'OrderRequested'
          ? [{ orderId }]
          : name === 'LocationRegistered'
            ? [
                {
                  location: id('private-location'),
                  company: seller,
                  detailsHash: id('private-label'),
                },
              ]
            : [],
    ),
    read: vi.fn(async (_contract: string, method: string) => {
      if (method === 'getItem')
        return {
          seller,
          kind: '1',
          unit: encodeBytes32String('g'),
          name: 'Actual ingredient',
          active: true,
        };
      if (method === 'getOrder')
        return {
          seller,
          buyer,
          itemId,
          requested: '100000',
          allocated: '0',
          dispatched: '0',
          status: '1',
          proposedBatch: batchId,
          expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
        };
      if (method === 'getBatch')
        return {
          unit: encodeBytes32String('g'),
          supplier: seller,
          availableQuantity: '200000',
          status: '1',
          expiresAt: '2000000000',
        };
      if (method === 'getOrderEvidence') return [];
      if (method === 'getListing')
        return { metadataHash: `0x${'0'.repeat(64)}`, encryptedCid: '', archived: false };
      if (method === 'requestDecision')
        return {
          status: '0',
          detailsHash: `0x${'0'.repeat(64)}`,
          encryptedCid: '',
          recordedAt: '0',
        };
      if (method === 'requestOnly') return true;
      if (method === 'listingManagementPolicy' || method === 'supplierManagementPolicy') return 1;
      if (method === 'isUsable') return true;
      if (method === 'hasPermission') return true;
      if (method === 'isAuthorized' || method === 'isValidTraceabilitySource') return true;
      throw new Error(`Unexpected ${method}`);
    }),
    prepare: vi
      .fn()
      .mockResolvedValue({ chainId: 31337, to: seller, data: '0x1234', value: '0x0' }),
  };
  const service = new OrdersService(
    auth as unknown as AuthService,
    gateway as unknown as OrdersGateway,
    store as unknown as CredentialContentStore,
    repository as unknown as ProductionFlowRepository,
  );
  const app = express();
  app.use(express.json());
  app.use(
    '/api/orders',
    createOrdersRouter(() => service, 'session'),
  );
  return { app, gateway, service, store, repository };
}
describe('order API and private metadata', () => {
  it('prepares a version-checked listing edit and reads only the hash-matched public fields', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER);
    await request(f.app)
      .post('/api/orders/prepare')
      .send({
        action: 'ingredient-update',
        operationId,
        batchId,
        expectedHash: `0x${'0'.repeat(64)}`,
        name: 'Supplier listing name',
        category: 'cocoa',
        description: 'Business description',
        price: '14.50',
        currency: 'MYR',
      })
      .expect(200);
    const args = f.gateway.prepare.mock.calls[0][3] as any[];
    expect(f.gateway.prepare).toHaveBeenCalledWith(seller, 'ingredients', 'updateListing', [
      batchId,
      `0x${'0'.repeat(64)}`,
      expect.any(String),
      'encrypted-cid',
    ]);
    const read = f.gateway.read.getMockImplementation()!,
      events = f.gateway.events.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'getListing'
        ? { metadataHash: args[2], encryptedCid: args[3], archived: false }
        : read(contract, method),
    );
    f.gateway.events.mockImplementation(async (contract, name) =>
      name === 'IngredientBatchRegistered'
        ? [{ batchId, supplier: seller }]
        : events(contract, name),
    );
    const result = await f.service.state('session');
    expect(result.catalogue[0]).toMatchObject({
      name: 'Supplier listing name',
      price: '14.50',
      currency: 'MYR',
      nameSource: 'Supplier listing metadata',
    });
    expect(result.catalogue[0].batchDetails[0].supplierAvailable).toBe('200000');
    const stale = await request(f.app)
      .post('/api/orders/prepare')
      .send({
        action: 'ingredient-update',
        operationId,
        batchId,
        expectedHash: `0x${'0'.repeat(64)}`,
        name: 'Stale edit',
        category: 'cocoa',
        description: '',
        currency: 'MYR',
      })
      .expect(409);
    expect(stale.body.error.code).toBe('INGREDIENT_LISTING_CHANGED');
  });
  it('restricts edits and archive/restore to the owner and effective permission', async () => {
    const other = fixture(outsider, true, CompanyRole.SUPPLIER);
    await request(other.app)
      .post('/api/orders/prepare')
      .send({ action: 'ingredient-archive', operationId, batchId, archived: true })
      .expect(403);
    expect(other.gateway.prepare).not.toHaveBeenCalled();
    const f = fixture(seller, true, CompanyRole.SUPPLIER);
    for (const archived of [true, false]) {
      await request(f.app)
        .post('/api/orders/prepare')
        .send({ action: 'ingredient-archive', operationId, batchId, archived })
        .expect(200);
      expect(f.gateway.prepare).toHaveBeenLastCalledWith(seller, 'ingredients', 'setArchived', [
        batchId,
        archived,
      ]);
    }
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (c, m) => (m === 'hasPermission' ? false : read(c, m)));
    await request(f.app)
      .post('/api/orders/prepare')
      .send({ action: 'ingredient-archive', operationId, batchId, archived: true })
      .expect(403);
  });
  it('records decisions only for an open seller-owned request and prevents repeated decisions', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER);
    const response = await request(f.app)
      .post('/api/orders/prepare')
      .send({
        action: 'decide-request',
        operationId,
        orderId,
        decision: 1,
        reason: 'Can supply this quantity',
      })
      .expect(200);
    expect(f.gateway.prepare).toHaveBeenCalledWith(seller, 'orders', 'decideRequest', [
      orderId,
      1,
      expect.any(String),
      'encrypted-cid',
    ]);
    const args = f.gateway.prepare.mock.calls[0][3] as any[],
      read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (c, m) =>
      m === 'requestDecision'
        ? { status: '1', detailsHash: args[2], encryptedCid: args[3], recordedAt: '1' }
        : read(c, m),
    );
    expect((await f.service.state('session')).orders[0].decision.reason).toBe(
      'Can supply this quantity',
    );
    const repeat = await request(f.app)
      .post('/api/orders/prepare')
      .send({
        action: 'decide-request',
        operationId,
        orderId,
        decision: 2,
        reason: 'Changed my mind',
      })
      .expect(409);
    expect(repeat.body.error.code).toBe('REQUEST_ALREADY_DECIDED');
    const buyerFixture = fixture();
    await request(buyerFixture.app)
      .post('/api/orders/prepare')
      .send({ action: 'decide-request', operationId, orderId, decision: 1, reason: 'Self approve' })
      .expect(404);
    expect(buyerFixture.gateway.prepare).not.toHaveBeenCalled();
    expect(response.body.resultId).toBeTruthy();
  });
  it('distinguishes an older listing deployment from an RPC outage', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER),
      read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (c, m) => {
      if (m === 'listingManagementPolicy')
        throw Object.assign(new Error('missing'), { code: 'CALL_EXCEPTION', data: '0x' });
      return read(c, m);
    });
    const old = await request(f.app)
      .post('/api/orders/prepare')
      .send({ action: 'ingredient-archive', operationId, batchId, archived: true })
      .expect(409);
    expect(old.body.error.code).toBe('INGREDIENT_MANAGEMENT_UPGRADE_REQUIRED');
    f.gateway.read.mockImplementation(async (c, m) => {
      if (m === 'listingManagementPolicy') throw new Error('RPC unavailable');
      return read(c, m);
    });
    await request(f.app)
      .post('/api/orders/prepare')
      .send({ action: 'ingredient-archive', operationId, batchId, archived: true })
      .expect(503);
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('prepares a request-only interest without requiring or inventing a location', async () => {
    const f = fixture();
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) =>
      ['requestOnlyPolicy', 'registeredRequestPolicy'].includes(method)
        ? 1
        : read(contract, method),
    );
    const response = await request(f.app)
      .post('/api/orders/prepare')
      .send({
        action: 'request',
        operationId,
        itemId,
        batchId,
        kind: 1,
        requestOnly: true,
        quantity: '12',
        unit: 'g',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        evidenceRequired: false,
        note: 'Interested in this ingredient',
      })
      .expect(200);
    expect(f.gateway.prepare).toHaveBeenCalledWith(buyer, 'orders', 'requestInterest', [
      response.body.resultId,
      1,
      batchId,
      '12',
      expect.any(Number),
      expect.any(String),
      'encrypted-cid',
    ]);
    expect(
      f.gateway.prepare.mock.calls.some(([, , method]) =>
        ['registerLocation', 'allocate', 'dispatch'].includes(method),
      ),
    ).toBe(false);
  });
  it('rejects request-only interest on an older deployment before preparing stock actions', async () => {
    const f = fixture();
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'requestOnlyPolicy' ? 0 : read(contract, method),
    );
    const response = await request(f.app)
      .post('/api/orders/prepare')
      .send({
        action: 'request',
        operationId,
        itemId,
        batchId,
        kind: 1,
        requestOnly: true,
        quantity: '12',
        unit: 'g',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        evidenceRequired: false,
        note: '',
      })
      .expect(409);
    expect(response.body.error.code).toBe('REQUEST_ONLY_UPGRADE_REQUIRED');
    expect(f.gateway.prepare).not.toHaveBeenCalled();
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
  });
  it('discovers registered ingredients without publishing and exposes only the allowed business summary', async () => {
    const f = fixture();
    const fresh = id('unpublished');
    const metadata = {
      ingredientName: 'Registered item',
      category: 'ingredient',
      batchId: 'reference',
      price: '12.50',
      currency: 'MYR',
      exactSourceFacility: 'PRIVATE',
      internalQualityRemarks: 'PRIVATE',
    };
    const hash = `0x${createHash('sha256').update(JSON.stringify(metadata)).digest('hex')}`;
    const originalEvents = f.gateway.events.getMockImplementation()!;
    const originalRead = f.gateway.read.getMockImplementation()!;
    f.gateway.events.mockImplementation(async (contract, name) =>
      name === 'IngredientBatchRegistered'
        ? [{ batchId: fresh, supplier: seller }]
        : originalEvents(contract, name),
    );
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'getBatch'
        ? {
            ...(await originalRead(contract, method)),
            supplier: seller,
            metadataHash: hash,
            encryptedCid: 'source-cid',
          }
        : originalRead(contract, method),
    );
    const service = new OrdersService(
      {
        getSession: async () => ({
          authenticated: true,
          authorizationReady: true,
          address: buyer,
          role: CompanyRole.MANUFACTURER,
        }),
      } as any,
      f.gateway as any,
      f.store as any,
      f.repository as any,
      undefined,
      undefined,
      undefined,
      {
        find: async () => ({
          supplierWallet: seller,
          metadataHash: hash,
          encryptedCid: 'source-cid',
          encryptedPayload: {
            ciphertext: JSON.stringify({ metadata, sdJwt: 'PRIVATE-CREDENTIAL' }),
          },
        }),
      } as any,
    );
    const state = await service.state('session');
    const entry = state.catalogue.find((item) => item.registeredBatch);
    expect(entry).toMatchObject({
      name: 'Registered item',
      price: '12.50',
      currency: 'MYR',
      batches: [fresh],
    });
    expect(JSON.stringify(state)).not.toContain('PRIVATE');
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('prepares a direct registered batch request and reports an outdated deployed suite explicitly', async () => {
    const f = fixture();
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'registeredRequestPolicy' ? 1 : read(contract, method),
    );
    const input = {
      action: 'request',
      operationId,
      itemId,
      batchId,
      kind: 1,
      quantity: '100',
      unit: 'g',
      location: id('receiving'),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      evidenceRequired: true,
      note: '',
    };
    await request(f.app).post('/api/orders/prepare').send(input).expect(200);
    expect(f.gateway.prepare).toHaveBeenCalledWith(
      buyer,
      'orders',
      'requestBatch',
      expect.arrayContaining([1, batchId, '100']),
    );
    f.gateway.prepare.mockClear();
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'registeredRequestPolicy' ? 0 : read(contract, method),
    );
    const failed = await request(f.app).post('/api/orders/prepare').send(input).expect(409);
    expect(failed.body.error.code).toBe('REGISTERED_REQUEST_UPGRADE_REQUIRED');
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('validates informational price precision and currency on both registration forms', () => {
    const ingredient = {
      batchReference: 'price-test',
      category: 'ingredient',
      ingredientName: 'Name',
      certifications: [],
      origin: 'Origin',
      quantity: '10',
      unit: 'litre',
      productionDate: '2026-01-01',
      expiryDate: '2099-01-01',
      price: '12.50',
      currency: 'MYR',
    };
    const product = {
      batchReference: 'price-test',
      category: 'product',
      productName: 'Name',
      ingredientLinks: [{ batchId, quantity: '1' }],
      producedAt: '2026-01-01',
      expiresAt: '2099-01-01',
      quantity: '10',
      unit: 'each',
      price: '12.50',
      currency: 'MYR',
    };
    expect(ingredientBatchRequestSchema.safeParse(ingredient).success).toBe(true);
    expect(productRequestSchema.safeParse(product).success).toBe(true);
    for (const price of ['-1', '1.234', '1e3']) {
      expect(ingredientBatchRequestSchema.safeParse({ ...ingredient, price }).success).toBe(false);
      expect(productRequestSchema.safeParse({ ...product, price }).success).toBe(false);
    }
    expect(productRequestSchema.safeParse({ ...product, currency: 'my' }).success).toBe(false);
  });
  const dispatchInput = () => ({
    action: 'dispatch',
    operationId,
    orderId,
    quantity: '100',
    occurredAt: Math.floor(Date.now() / 1000) - 60,
    expectedAt: Math.floor(Date.now() / 1000) + 3600,
  });
  function dispatchFixture(changes: Record<string, unknown> = {}, kind = 1) {
    const result = fixture(seller, true, CompanyRole.SUPPLIER);
    const original = result.gateway.read.getMockImplementation()!;
    result.gateway.read.mockImplementation(async (contract, method) => {
      const value = await original(contract, method);
      if (method === 'getOrder') return { ...value, allocated: '100000', status: '2', ...changes };
      if (method === 'getItem') return { ...value, kind };
      return value;
    });
    return result;
  }
  it.each([
    [{ allocated: '0' }, 'ORDER_RESERVATION_REQUIRED', 409],
    [{ allocated: '50' }, 'ORDER_DISPATCH_EXCEEDS_RESERVATION', 400],
    [{ expiresAt: '1' }, 'ORDER_DISPATCH_CLOSED', 409],
    [{ evidenceRequired: true }, 'ORDER_EVIDENCE_REQUIRED', 409],
    [{ identityRequired: true, identityValidUntil: '1' }, 'ORDER_IDENTITY_REQUIRED', 409],
  ])(
    'explains dispatch blocker %j without storing shipment data',
    async (changes, code, status) => {
      const { app, gateway, store } = dispatchFixture(changes);
      const response = await request(app)
        .post('/api/orders/prepare')
        .send(dispatchInput())
        .expect(status as number);
      expect(response.body.error.code).toBe(code);
      expect(gateway.prepare).not.toHaveBeenCalled();
      expect(store.encryptAndStore).not.toHaveBeenCalled();
    },
  );
  it('checks all linked evidence expiry even when evidence is optional', async () => {
    const { app, gateway } = dispatchFixture();
    const original = gateway.read.getMockImplementation()!;
    gateway.read.mockImplementation(async (contract, method) => {
      if (method === 'getOrderEvidence') return [id('proof')];
      if (method === 'getRequest')
        return {
          requester: buyer,
          supplier: seller,
          ingredientBatchId: batchId,
          status: '3',
          presentationExpiresAt: '1',
        };
      return original(contract, method);
    });
    const response = await request(app)
      .post('/api/orders/prepare')
      .send(dispatchInput())
      .expect(409);
    expect(response.body.error.code).toBe('ORDER_EVIDENCE_EXPIRED');
    expect(gateway.prepare).not.toHaveBeenCalled();
  });
  it('dispatches reserved ingredients with zero unreserved stock using source validity', async () => {
    const { app, gateway } = dispatchFixture();
    const original = gateway.read.getMockImplementation()!;
    gateway.read.mockImplementation(async (contract, method) => {
      if (method === 'isUsable') return false;
      if (method === 'getBatch') return { availableQuantity: '0' };
      return original(contract, method);
    });
    await request(app).post('/api/orders/prepare').send(dispatchInput()).expect(200);
    expect(gateway.read).toHaveBeenCalledWith('ingredients', 'isValidTraceabilitySource', [
      batchId,
    ]);
    expect(gateway.prepare).toHaveBeenCalled();
    expect(gateway.read.mock.calls.some(([, method]) => method === 'isUsable')).toBe(false);
  });
  it('requires a Distributor location for finished products', async () => {
    const { app, gateway } = dispatchFixture({}, 2);
    const response = await request(app)
      .post('/api/orders/prepare')
      .send(dispatchInput())
      .expect(400);
    expect(response.body.error.code).toBe('ORDER_DISTRIBUTOR_REQUIRED');
    expect(gateway.prepare).not.toHaveBeenCalled();
  });
  it.each([
    [
      'missing proposal',
      { proposedBatch: `0x${'0'.repeat(64)}` },
      '100000',
      'ORDER_PROPOSAL_REQUIRED',
      409,
    ],
    ['existing reservation', { allocated: '100000' }, '100000', 'ORDER_ALREADY_RESERVED', 409],
    ['expired order', { expiresAt: '1' }, '100000', 'ORDER_EXPIRED', 409],
    ['closed order', { status: '3' }, '100000', 'ORDER_NOT_OPEN', 409],
    ['excess order quantity', {}, '100001', 'ORDER_ALLOCATION_EXCEEDS_REQUEST', 400],
  ])(
    'explains %s before preparing another reservation',
    async (_name, changes, quantity, code, status) => {
      const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
      const original = gateway.read.getMockImplementation()!;
      gateway.read.mockImplementation(async (contract, method) => {
        const value = await original(contract, method);
        return method === 'getOrder' ? { ...value, ...changes } : value;
      });
      const response = await request(app)
        .post('/api/orders/prepare')
        .send({ action: 'allocate', operationId, orderId, quantity })
        .expect(status as number);
      expect(response.body.error.code).toBe(code);
      expect(gateway.prepare).not.toHaveBeenCalled();
    },
  );
  it('explains insufficient batch stock and unusable credentials without preparing a transaction', async () => {
    const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
    const original = gateway.read.getMockImplementation()!;
    gateway.read.mockImplementation(async (contract, method) => {
      const value = await original(contract, method);
      return method === 'getBatch' ? { ...value, availableQuantity: '10' } : value;
    });
    const response = await request(app)
      .post('/api/orders/prepare')
      .send({ action: 'allocate', operationId, orderId, quantity: '100000' })
      .expect(409);
    expect(response.body.error.code).toBe('ORDER_INSUFFICIENT_STOCK');
    gateway.read.mockImplementation(async (contract, method) =>
      method === 'isUsable' ? false : original(contract, method),
    );
    const unusable = await request(app)
      .post('/api/orders/prepare')
      .send({ action: 'allocate', operationId, orderId, quantity: '100000' })
      .expect(409);
    expect(unusable.body.error.code).toBe('ORDER_BATCH_UNUSABLE');
    expect(gateway.prepare).not.toHaveBeenCalled();
  });
  it('prepares a valid partial reservation and denies a buyer trying to reserve seller stock', async () => {
    const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
    await request(app)
      .post('/api/orders/prepare')
      .send({ action: 'allocate', operationId, orderId, quantity: '50000' })
      .expect(200);
    expect(gateway.prepare).toHaveBeenCalledWith(seller, 'orders', 'allocate', [orderId, '50000']);
    const other = fixture();
    const denied = await request(other.app)
      .post('/api/orders/prepare')
      .send({ action: 'allocate', operationId, orderId, quantity: '50000' })
      .expect(403);
    expect(denied.body.error.code).toBe('ORDER_SELLER_REQUIRED');
    expect(other.gateway.prepare).not.toHaveBeenCalled();
  });
  it('rejects an unreadable hashed unit instead of inventing a unit label', async () => {
    const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
    gateway.read.mockResolvedValue({
      supplier: seller,
      unit: id('legacy-unit-hash'),
      status: '1',
      expiresAt: '2000000000',
    } as any);
    const response = await request(app)
      .post('/api/orders/prepare')
      .send({ action: 'list', operationId, name: 'Ingredient', kind: 1, batchId })
      .expect(409);
    expect(response.body.error.code).toBe('CATALOGUE_UNIT_INVALID');
    expect(gateway.prepare).not.toHaveBeenCalled();
  });
  it.each(['g', 'kg', 'litre', 'each', 'unit'])(
    'publishes %s batches using their registered unit without conversion',
    async (unit) => {
      const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
      gateway.read.mockImplementation(async (_contract, method) =>
        method === 'catalogueUnitPolicy'
          ? (2 as any)
          : ({
              supplier: seller,
              unit: encodeBytes32String(unit),
              status: '1',
              expiresAt: '2000000000',
            } as any),
      );
      await request(app)
        .post('/api/orders/prepare')
        .send({ action: 'list', operationId, name: 'Ingredient', kind: 1, batchId })
        .expect(200);
      expect(gateway.prepare).toHaveBeenCalledWith(
        seller,
        'orders',
        'listItem',
        expect.arrayContaining(['Ingredient', 1, batchId]),
      );
    },
  );
  it('reports that the old deployed contract needs updating for litre instead of rejecting the unit itself', async () => {
    const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
    gateway.read.mockImplementation(async (_contract, method) => {
      if (method === 'catalogueUnitPolicy')
        throw Object.assign(new Error('missing function in older deployment'), {
          code: 'CALL_EXCEPTION',
          data: '0x',
        });
      return {
        supplier: seller,
        unit: encodeBytes32String('litre'),
        status: '1',
        expiresAt: '2000000000',
      } as any;
    });
    const response = await request(app)
      .post('/api/orders/prepare')
      .send({ action: 'list', operationId, name: 'Ingredient', kind: 1, batchId })
      .expect(409);
    expect(response.body.error.code).toBe('CATALOGUE_UPGRADE_REQUIRED');
    expect(gateway.prepare).not.toHaveBeenCalled();
  });
  it('returns batch eligibility and the existing unit for the seller selection', async () => {
    const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
    gateway.events.mockImplementation(async (_contract, name) =>
      name === 'IngredientBatchRegistered' ? [{ batchId, supplier: seller }] : ([] as any),
    );
    const read = gateway.read.getMockImplementation()!;
    gateway.read.mockImplementation(async (contract, method) =>
      method === 'getBatch'
        ? {
            supplier: seller,
            unit: encodeBytes32String('litre'),
            status: '1',
            expiresAt: '2000000000',
          }
        : read(contract, method),
    );
    const response = await request(app).get('/api/orders').expect(200);
    expect(response.body.listingBatches[0]).toMatchObject({
      batchId,
      unit: 'litre',
      eligible: true,
    });
  });
  it('does not mislabel an RPC failure as an unsupported unit or old contract', async () => {
    const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
    gateway.read.mockImplementation(async (_contract, method) => {
      if (method === 'catalogueUnitPolicy')
        throw Object.assign(new Error('RPC connection failed'), { code: 'NETWORK_ERROR' });
      return {
        supplier: seller,
        unit: encodeBytes32String('litre'),
        status: '1',
        expiresAt: '2000000000',
      } as any;
    });
    const response = await request(app)
      .post('/api/orders/prepare')
      .send({ action: 'list', operationId, name: 'Ingredient', kind: 1, batchId })
      .expect(503);
    expect(response.body.error.code).toBe('CATALOGUE_POLICY_UNAVAILABLE');
  });
  it('loads chain catalogue and separates reservations, dispatch and evidence without granting physical stock', async () => {
    const { app } = fixture();
    const response = await request(app).get('/api/orders').expect(200);
    expect(response.body.catalogue[0]).toMatchObject({
      name: 'Actual ingredient',
      unit: 'g',
      batchDetails: [
        { batchId, supplierAvailable: '200000', expiresAt: '2000000000', status: '1' },
      ],
    });
    expect(response.body.orders[0]).toMatchObject({
      requested: '100000',
      allocated: '0',
      dispatched: '0',
      evidenceIds: [],
    });
    expect(response.body.shipments).toEqual([]);
  });
  it('hides other-company orders and private location labels before decrypting', async () => {
    const { app, store } = fixture(outsider);
    const response = await request(app).get('/api/orders').expect(200);
    expect(response.body.orders).toEqual([]);
    expect(response.body.locations[0].label).toBeUndefined();
    expect(store.decrypt).not.toHaveBeenCalled();
  });
  it('requires current company authorization before reading or preparing state', async () => {
    const { app, gateway } = fixture(buyer, false);
    await request(app).get('/api/orders').expect(403);
    await request(app)
      .post('/api/orders/prepare')
      .send({ action: 'allocate', operationId, orderId, quantity: '100000' })
      .expect(403);
    expect(gateway.prepare).not.toHaveBeenCalled();
    expect(gateway.events).not.toHaveBeenCalled();
  });
  it.each(['1.5', '1e5', '-1', '0', ' 10', '0x10'])(
    'rejects unsupported quantity precision %s before calldata',
    async (quantity) => {
      const { app, gateway } = fixture();
      await request(app)
        .post('/api/orders/prepare')
        .send({ action: 'allocate', operationId, orderId, quantity })
        .expect(400);
      expect(gateway.prepare).not.toHaveBeenCalled();
    },
  );
  it('encodes explicit canonical units and keeps private order notes in encrypted storage', async () => {
    const { app, gateway, store } = fixture();
    const body = {
      action: 'request',
      operationId,
      itemId,
      quantity: '100000',
      unit: 'g',
      location: id('receiving'),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      evidenceRequired: true,
      note: 'Private delivery instructions',
    };
    const response = await request(app).post('/api/orders/prepare').send(body).expect(200);
    expect(store.encryptAndStore).toHaveBeenCalled();
    const args = gateway.prepare.mock.calls[0] as any;
    expect(args[0]).toBe(buyer);
    expect(args[2]).toBe('requestOrder');
    expect(args[3][2]).toBe('100000');
    expect(args[3][3]).toBe(encodeBytes32String('g'));
    expect(JSON.stringify(response.body)).not.toContain(body.note);
    await request(app)
      .post('/api/orders/prepare')
      .send({ ...body, unit: 'kg' })
      .expect(400);
  });
  it('keeps a litre request quantity and unit exactly as submitted', async () => {
    const { app, gateway } = fixture();
    gateway.read.mockResolvedValue({ seller, unit: encodeBytes32String('litre') } as any);
    await request(app)
      .post('/api/orders/prepare')
      .send({
        action: 'request',
        operationId,
        itemId,
        quantity: '200000',
        unit: 'litre',
        location: id('receiving'),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        evidenceRequired: false,
        note: '',
      })
      .expect(200);
    const args = gateway.prepare.mock.calls[0] as any;
    expect(args[3][2]).toBe('200000');
    expect(args[3][3]).toBe(encodeBytes32String('litre'));
  });
  it('rejects replaying an operation ID with a different encrypted request', async () => {
    const { service } = fixture();
    const body = {
      action: 'request' as const,
      operationId,
      itemId,
      quantity: '100000',
      unit: 'g' as const,
      location: id('receiving'),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      evidenceRequired: true,
      note: 'Original',
    };
    await service.prepare('session', body);
    await expect(service.prepare('session', { ...body, note: 'Changed' })).rejects.toMatchObject({
      code: 'OPERATION_CONFLICT',
    });
  });
  it('rejects wrong-batch order evidence and cross-company identity requests', async () => {
    const { service } = fixture();
    await expect(
      service.prepareEvidence('session', orderId, {
        operationId,
        batchId: id('unrelated'),
        claims: ['expiryDate'],
        requiredClaims: ['expiryDate'],
        reason: 'Review',
        dueAt: new Date(Date.now() + 600000),
      }),
    ).rejects.toMatchObject({ code: 'WRONG_BATCH' });
    await expect(
      service.identity('session', orderId, {
        action: 'request',
        purpose: 'Review',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
  });
  it('reports chain preflight failures without RPC secrets or fabricated success', async () => {
    const { app, gateway } = fixture(seller, true, CompanyRole.SUPPLIER);
    gateway.prepare.mockRejectedValue(new Error('Private RPC details'));
    const response = await request(app)
      .post('/api/orders/prepare')
      .send({ action: 'allocate', operationId, orderId, quantity: '100000' })
      .expect(409);
    expect(response.body.error.code).toBe('ORDER_TRANSITION_REJECTED');
    expect(JSON.stringify(response.body)).not.toContain('Private RPC');
  });
  it('fails closed on service outages and denies unrelated-company recall details', async () => {
    const { app, gateway } = fixture(outsider);
    await request(app).get(`/api/orders/recall/${batchId}`).expect(404);
    gateway.events.mockRejectedValue(new Error('RPC down'));
    await request(app).get('/api/orders').expect(503);
  });
});
