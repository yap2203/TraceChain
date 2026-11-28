import { CompanyRole } from '@tracechain/shared';
import { encodeBytes32String, id } from 'ethers';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { CustodyOffers } from './custody-offers.js';
import { createOrdersRouter } from './orders.routes.js';
import { OrdersService } from './orders.service.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonProductionFlowRepository } from '../production-flow/production-flow.repository.js';

const source = '0x1000000000000000000000000000000000000001',
  carrier = '0x2000000000000000000000000000000000000002',
  foreign = '0x3000000000000000000000000000000000000003';
const batchId = id('batch'),
  from = id('source'),
  otherFrom = id('other-source'),
  to = id('warehouse'),
  metadataHash = id('signed-batch');
const input = {
  operationId: '00000000-0000-4000-8000-000000000001',
  kind: 1 as 1 | 2,
  batchId,
  quantity: '10',
  fromLocation: from,
  toLocation: to,
  distributor: carrier,
  expiresAt: Math.floor(Date.now() / 1000) + 7200,
};
function fixture(
  options: {
    inventoryAvailable?: string;
    inventoryInitialized?: boolean;
    locationStock?: string;
    locationTracked?: boolean;
    totalQuantity?: string;
  } = {},
) {
  let actor = source,
    role = CompanyRole.SUPPLIER,
    active = true,
    shipment: any = {};
  const records = new Map<string, any>();
  const repo = {
    findPrivate: vi.fn(async (_kind: string, key: string) => records.get(key)),
    listPrivate: vi.fn(async () => [...records.values()]),
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
  const gateway = {
    chainId: 31337,
    address: source,
    events: vi.fn(async (_contract: string, event: string) =>
      event === 'TransferCreated'
        ? Number(shipment.status) > 0
          ? [...records.values()]
              .map((r) => JSON.parse(r.payload.ciphertext))
              .filter((o) => o.shipmentId)
              .map((o) => ({ transferId: o.shipmentId }))
          : []
        : event === 'InventoryInitialized'
          ? options.inventoryInitialized
            ? [{ batchId, manufacturer: source, quantity: options.totalQuantity ?? '123' }]
            : []
          : [{ batchId, blockHash: id('registration-block') }],
    ),
    prepare: vi.fn(),
    read: vi.fn(async (_contract: string, method: string, args?: any[]) => {
      if (method === 'getBatch' || method === 'getProduct')
        return {
          supplier: source,
          manufacturer: source,
          availableQuantity: '100',
          metadataHash,
          expiresAt: input.expiresAt + 1000,
          status: 1,
          totalQuantity: options.totalQuantity ?? '123',
          unit: encodeBytes32String('kg'),
        };
      if (method === 'isAuthorized') return active;
      if (method === 'warehouses') return { distributor: carrier };
      if (method === 'locationOwner')
        return args?.[0] === from || args?.[0] === otherFrom ? source : carrier;
      if (method === 'getRoadShipment' || method === 'getTransfer') return shipment;
      if (method === 'locationTracked') return options.locationTracked ?? true;
      if (method === 'locationStock') return options.locationStock ?? '100';
      if (method === 'productionLocation') return from;
      if (method === 'getInventory')
        return {
          available: options.inventoryAvailable ?? '0',
          reserved: '0',
          damaged: '0',
          rejected: '0',
        };
      if (method === 'dispatchLocation') return from;
      if (method === 'receivingLocation') return to;
      return 0;
    }),
  };
  const prepare = vi.fn(async () => ({
      transaction: { to: source, chainId: 31337, data: '0x', value: '0' },
      resultId: id('prepared'),
    })),
    proofCheck = vi.fn(async () => {});
  const offers = new CustodyOffers({
    gateway,
    repository: repo as any,
    store: store as any,
    session: async () => ({ address: actor, role }),
    prepare,
    proofCheck,
  });
  const auth = {
    getSession: vi.fn(async () => ({
      authenticated: true,
      authorizationReady: true,
      address: actor,
      role,
    })),
  };
  const service = new OrdersService(auth as any, gateway, store as any, repo as any);
  const app = express();
  app.use(express.json());
  app.use(
    '/api/orders',
    createOrdersRouter(() => service, 'session'),
  );
  return {
    app,
    offers,
    records,
    store,
    gateway,
    prepare,
    proofCheck,
    repo,
    auth,
    actor: (wallet: string, nextRole: CompanyRole) => {
      actor = wallet;
      role = nextRole;
    },
    active: (value: boolean) => {
      active = value;
    },
    shipment: (value: any) => {
      shipment = value;
    },
  };
}
describe('custody offer, acceptance, pickup and handoff', () => {
  it('lists a prepared product handoff without reading a transfer that has not been created', async () => {
    const f = fixture();
    f.actor(source, CompanyRole.MANUFACTURER);
    const { offer } = await f.offers.create('s', { ...input, kind: 2 });
    f.actor(carrier, CompanyRole.DISTRIBUTOR);
    const now = Math.floor(Date.now() / 1000);
    await f.offers.act('s', offer.offerId, {
      action: 'accept',
      pickupAt: now + 600,
      vehicle: 'VAB 1234',
      expectedAt: now + 3600,
    });
    f.actor(source, CompanyRole.MANUFACTURER);
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, args) => {
      if (method === 'getTransfer')
        throw Object.assign(new Error('InvalidInput()'), { code: 'CALL_EXCEPTION' });
      return read(contract, method, args);
    });
    const events = f.gateway.events.getMockImplementation()!;
    f.gateway.events.mockImplementation(async (contract, event) =>
      event === 'TransferCreated' ? [] : events(contract, event),
    );
    await f.offers.prepare('s', offer.offerId);
    const savedRecord = structuredClone(f.records.get(offer.offerId));
    f.gateway.read.mockClear();
    const response = await request(f.app).get('/api/orders/custody-offers').expect(200);
    expect(response.body.offers).toHaveLength(1);
    expect(response.body.offers[0].status).toBe('SCHEDULED');
    expect(response.body.offers[0].shipmentId).toBeUndefined();
    expect(response.body.offers[0].plannedShipmentId).toBe(
      JSON.parse(savedRecord.payload.ciphertext).shipmentId,
    );
    expect(f.records.get(offer.offerId)).toEqual(savedRecord);
    expect(f.gateway.read.mock.calls.some(([, method]) => method === 'getTransfer')).toBe(false);
    expect(f.repo.savePrivate).toHaveBeenCalled();
    f.gateway.events.mockImplementation(async (contract, event) => {
      if (event === 'TransferCreated') throw new Error('Event RPC unavailable');
      return events(contract, event);
    });
    await request(f.app).get('/api/orders/custody-offers').expect(503);
  });
  it.each([1, 2] as const)(
    'discovers kind %s once for its intended Distributor and denies unrelated companies',
    async (kind) => {
      const f = fixture();
      f.actor(source, kind === 1 ? CompanyRole.SUPPLIER : CompanyRole.MANUFACTURER);
      const created = await f.offers.create('s', { ...input, kind });
      expect(f.gateway.prepare).not.toHaveBeenCalled();
      f.actor(carrier.toUpperCase().replace('0X', '0x'), CompanyRole.DISTRIBUTOR);
      expect((await f.offers.list('s')).offers.map((x) => x.offerId)).toEqual([
        created.offer.offerId,
      ]);
      expect((await f.offers.get('s', created.offer.offerId)).kind).toBe(kind);
      const now = Math.floor(Date.now() / 1000);
      const accepted = await f.offers.act('s', created.offer.offerId, {
        action: 'accept',
        pickupAt: now + 300,
        vehicle: 'VAB 1234',
        expectedAt: now + 600,
      });
      expect(accepted.offer.status).toBe('SCHEDULED');
      expect(f.gateway.prepare).not.toHaveBeenCalled();
      await expect(
        f.offers.prepare('s', created.offer.offerId, {
          vehicle: 'VAB 1234',
          occurredAt: 1,
          expectedAt: 2,
        }),
      ).rejects.toMatchObject({ code: 'SENDER_REQUIRED' });
      f.actor(foreign, CompanyRole.DISTRIBUTOR);
      expect((await f.offers.list('s')).offers).toEqual([]);
      await expect(f.offers.get('s', created.offer.offerId)).rejects.toMatchObject({
        code: 'OFFER_NOT_FOUND',
      });
      await expect(
        f.offers.act('s', created.offer.offerId, { action: 'reject' }),
      ).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
    },
  );
  it('proves a pinned product offer is not discoverable by a second API without a shared index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-offer-isolation-'));
    try {
      const f = fixture();
      const repositoryA = new JsonProductionFlowRepository(join(directory, 'a', 'workflows.json'));
      const repositoryB = new JsonProductionFlowRepository(join(directory, 'b', 'workflows.json'));
      const build = (
        repository: JsonProductionFlowRepository,
        address: string,
        role: CompanyRole,
      ) =>
        new CustodyOffers({
          gateway: f.gateway,
          store: f.store as any,
          repository,
          session: async () => ({ address, role }),
          prepare: f.prepare,
          proofCheck: f.proofCheck,
        });
      const apiA = build(repositoryA, source, CompanyRole.MANUFACTURER);
      const apiB = build(repositoryB, carrier, CompanyRole.DISTRIBUTOR);
      const { offer } = await apiA.create('s', { ...input, kind: 2 });
      expect(f.store.encryptAndStore).toHaveBeenCalled();
      const sameApiDistributor = build(repositoryA, carrier, CompanyRole.DISTRIBUTOR);
      expect((await sameApiDistributor.list('s')).offers.map((x) => x.offerId)).toEqual([
        offer.offerId,
      ]);
      expect((await apiB.list('s')).offers).toEqual([]);
      await expect(apiB.get('s', offer.offerId)).rejects.toMatchObject({ code: 'OFFER_NOT_FOUND' });
      expect(await repositoryB.listPrivate('transfers')).toEqual([]);
      expect(await repositoryA.listPrivate('transfers')).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('lists a valid offer while omitting stale ingredient and product offers', async () => {
    const f = fixture();
    const validBatch = id('current-ingredient-batch');
    const staleIngredient = id('stale-ingredient-batch');
    const staleProduct = id('stale-product-batch');
    const registrationHash = id('current-registration-block');
    let ingredientRegistrations = [validBatch, staleIngredient].map((value) => ({
      batchId: value,
      blockHash: registrationHash,
    }));
    let productRegistrations = [{ productBatchId: staleProduct, blockHash: registrationHash }];
    const events = f.gateway.events.getMockImplementation()!;
    f.gateway.events.mockImplementation(async (contract, event) => {
      if (event === 'IngredientBatchRegistered') return ingredientRegistrations;
      if (event === 'ProductCreated') return productRegistrations;
      return events(contract, event);
    });

    const valid = await f.offers.create('s', {
      ...input,
      batchId: validBatch,
      operationId: crypto.randomUUID(),
    });
    await f.offers.create('s', {
      ...input,
      batchId: staleIngredient,
      operationId: crypto.randomUUID(),
    });
    f.actor(source, CompanyRole.MANUFACTURER);
    await f.offers.create('s', {
      ...input,
      batchId: staleProduct,
      kind: 2,
      operationId: crypto.randomUUID(),
    });

    ingredientRegistrations = ingredientRegistrations.slice(0, 1);
    productRegistrations = [];
    f.actor(source, CompanyRole.SUPPLIER);
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, args) => {
      if (
        (method === 'getBatch' && args?.[0] === staleIngredient) ||
        (method === 'getProduct' && args?.[0] === staleProduct)
      )
        throw Object.assign(new Error('missing current batch'), { code: 'CALL_EXCEPTION' });
      return read(contract, method, args);
    });

    const response = await request(f.app).get('/api/orders/custody-offers').expect(200);
    expect(response.body.offers).toHaveLength(1);
    expect(response.body.offers[0].offerId).toBe(valid.offer.offerId);
    expect(f.records).toHaveProperty('size', 3);
  });

  it('returns an empty list when every saved offer is stale and still creates current offers', async () => {
    const f = fixture();
    const staleBatch = id('stale-only-batch');
    const currentBatch = id('new-current-batch');
    const registrationHash = id('registration-block');
    let registrations = [{ batchId: staleBatch, blockHash: registrationHash }];
    const events = f.gateway.events.getMockImplementation()!;
    f.gateway.events.mockImplementation(async (contract, event) =>
      event === 'IngredientBatchRegistered' ? registrations : events(contract, event),
    );
    await f.offers.create('s', {
      ...input,
      batchId: staleBatch,
      operationId: crypto.randomUUID(),
    });
    registrations = [];
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, args) => {
      if (method === 'getBatch' && args?.[0] === staleBatch)
        throw Object.assign(new Error('missing current batch'), { code: 'CALL_EXCEPTION' });
      return read(contract, method, args);
    });

    const response = await request(f.app).get('/api/orders/custody-offers').expect(200);
    expect(response.body.offers).toEqual([]);
    expect(f.records).toHaveProperty('size', 1);

    registrations = [{ batchId: currentBatch, blockHash: registrationHash }];
    await expect(
      f.offers.create('s', {
        ...input,
        batchId: currentBatch,
        operationId: crypto.randomUUID(),
      }),
    ).resolves.toMatchObject({ offer: { batchId: currentBatch } });
  });

  it('propagates a registration-event lookup failure instead of treating offers as stale', async () => {
    const f = fixture();
    await f.offers.create('s', input);
    f.gateway.events.mockRejectedValue(new Error('registration lookup unavailable'));

    const response = await request(f.app).get('/api/orders/custody-offers').expect(503);
    expect(response.body.error.code).toBe('ORDER_SERVICE_UNAVAILABLE');
    await expect(f.offers.list('s')).rejects.toThrow('registration lookup unavailable');
  });

  it('does not classify a registered offer as stale when its batch read fails', async () => {
    const f = fixture();
    await f.offers.create('s', input);
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, args) => {
      if (method === 'getBatch')
        throw Object.assign(new Error('batch RPC unavailable'), { code: 'CALL_EXCEPTION' });
      return read(contract, method, args);
    });

    const response = await request(f.app).get('/api/orders/custody-offers').expect(503);
    expect(response.body.error.code).toBe('ORDER_SERVICE_UNAVAILABLE');
    await expect(f.offers.list('s')).rejects.toMatchObject({ code: 'CALL_EXCEPTION' });
  });

  it('does not allow a stale offer opened directly to be acted on', async () => {
    const f = fixture();
    const { offer } = await f.offers.create('s', input);
    f.gateway.events.mockResolvedValue([]);
    const read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, args) => {
      if (method === 'getBatch')
        throw Object.assign(new Error('missing current batch'), { code: 'CALL_EXCEPTION' });
      return read(contract, method, args);
    });
    f.actor(carrier, CompanyRole.DISTRIBUTOR);

    await expect(f.offers.act('s', offer.offerId, { action: 'accept' })).rejects.toMatchObject({
      code: 'OFFER_NOT_FOUND',
    });
    expect(f.records.get(offer.offerId)?.recordType).toBe('custody-offer');
    expect(f.repo.savePrivate).toHaveBeenCalledTimes(1);
  });

  it('accepts a small offer from a fresh product batch only at its production location', async () => {
    const f = fixture({
      inventoryAvailable: '0',
      inventoryInitialized: false,
      locationTracked: false,
      totalQuantity: '123',
    });
    f.actor(source, CompanyRole.MANUFACTURER);

    const result = await f.offers.create('s', {
      ...input,
      kind: 2,
      quantity: '2',
    });
    expect(result.offer.quantity).toBe('2');
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.gateway.prepare).not.toHaveBeenCalled();

    await expect(
      f.offers.create('s', {
        ...input,
        operationId: crypto.randomUUID(),
        kind: 2,
        quantity: '124',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    await expect(
      f.offers.create('s', {
        ...input,
        operationId: crypto.randomUUID(),
        kind: 2,
        quantity: '2',
        fromLocation: otherFrom,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it.each(['0', '1'])(
    'rejects initialized product inventory with only %s available',
    async (available) => {
      const f = fixture({
        inventoryAvailable: '123',
        inventoryInitialized: true,
        locationStock: available,
        locationTracked: true,
        totalQuantity: '123',
      });
      f.actor(source, CompanyRole.MANUFACTURER);

      await expect(
        f.offers.create('s', { ...input, kind: 2, quantity: '2' }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    },
  );

  it('does not assume a zeroed product inventory is fresh when initialization cannot be verified', async () => {
    const f = fixture({
      inventoryAvailable: '0',
      inventoryInitialized: false,
      locationTracked: false,
      totalQuantity: '123',
    });
    f.actor(source, CompanyRole.MANUFACTURER);
    const events = f.gateway.events.getMockImplementation()!;
    f.gateway.events.mockImplementation(async (contract, event) => {
      if (event === 'InventoryInitialized') throw new Error('Inventory event lookup unavailable');
      return events(contract, event);
    });

    await expect(f.offers.create('s', { ...input, kind: 2, quantity: '2' })).rejects.toThrow(
      'Inventory event lookup unavailable',
    );
    expect(f.repo.savePrivate).not.toHaveBeenCalled();
  });

  it('keeps Supplier custody offers bound to IngredientRegistry availability', async () => {
    const f = fixture({ inventoryAvailable: '0', inventoryInitialized: false });
    await expect(f.offers.create('s', { ...input, quantity: '100' })).resolves.toMatchObject({
      offer: { kind: 1, quantity: '100' },
    });
    await expect(
      f.offers.create('s', {
        ...input,
        operationId: crypto.randomUUID(),
        quantity: '101',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('expires without a fake stock transaction and rejects a changed chain registration anchor', async () => {
    const f = fixture();
    const { offer } = await f.offers.create('s', input);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date((input.expiresAt + 1) * 1000));
      expect((await f.offers.get('s', offer.offerId)).status).toBe('EXPIRED');
      f.actor(carrier, CompanyRole.DISTRIBUTOR);
      await expect(f.offers.act('s', offer.offerId, { action: 'accept' })).rejects.toMatchObject({
        code: 'OFFER_CLOSED',
      });
    } finally {
      vi.useRealTimers();
    }
    f.gateway.events.mockResolvedValue([
      { batchId, blockHash: id('different-chain-registration') },
    ]);
    await expect(f.offers.get('s', offer.offerId)).rejects.toMatchObject({
      code: 'OFFER_NOT_FOUND',
    });
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it.each([1, 2] as const)(
    'binds kind %s company proof to the custody parties and batch without inventing chain attestations',
    async (kind) => {
      const f = fixture();
      if (kind === 2) f.actor(source, CompanyRole.MANUFACTURER);
      const { offer } = await f.offers.create('s', { ...input, kind });
      f.actor(carrier, CompanyRole.DISTRIBUTOR);
      const flow = {
        startOrderIdentity: vi.fn(async () => ({
          challenge: 'fresh-custody-challenge',
          expiresAt: input.expiresAt - 100,
        })),
        orderIdentityAttestation: vi.fn(async () => ({
          checks: [{ code: 'real-verifier-result', passed: true }],
        })),
      };
      const messaging = { send: vi.fn(async () => ({})) };
      const service = new OrdersService(
        f.auth as any,
        f.gateway,
        f.store as any,
        { ...f.repo, findEvidence: async () => undefined } as any,
        flow as any,
        messaging as any,
      );
      await service.identity(
        's',
        offer.offerId,
        {
          action: 'request',
          purpose: 'Review sender',
          expiresAt: input.expiresAt - 100,
          requiredClaims: ['companyName'],
        },
        true,
      );
      expect(flow.startOrderIdentity).toHaveBeenCalledWith(
        's',
        expect.objectContaining({
          deliveryOrderId: offer.offerId,
          buyer: source,
          seller: carrier,
          batchId,
        }),
      );
      expect(messaging.send).not.toHaveBeenCalled();
      expect((await service.identity('s', offer.offerId, { action: 'verify' }, true)).state).toBe(
        'COMPLETE',
      );
      expect(f.gateway.prepare).not.toHaveBeenCalled();
      const record = {
        deliveryOrderId: offer.offerId,
        requester: source,
        supplier: carrier,
        batchId,
        requestId: id(
          `ingredient-delivery-identity:${offer.offerId.toLowerCase()}:${carrier.toLowerCase()}`,
        ),
      };
      expect(await service.deliveryIdentityParticipants(record as any)).toBe(true);
      expect(
        await service.deliveryIdentityParticipants({
          ...record,
          batchId: id('wrong-batch'),
        } as any),
      ).toBe(false);
      f.actor(foreign, CompanyRole.DISTRIBUTOR);
      await expect(
        service.identity('s', offer.offerId, { action: 'request' }, true),
      ).rejects.toThrow();
      f.active(false);
      await expect(service.deliveryIdentityParticipants(record as any)).rejects.toMatchObject({
        code: 'PARTICIPANT_UNAUTHORIZED',
      });
    },
  );
  it('gates custody steps on the recorded company verification without re-verifying the presentation', async () => {
    const f = fixture();
    const { offer } = await f.offers.create('s', input);
    f.actor(carrier, CompanyRole.DISTRIBUTOR);
    const outcome = { status: 'PRESENTED', presenterWallet: source };
    const flow = {
      companyIdentityProofOutcome: vi.fn(async () => outcome),
      getCompanyIdentityProofStatus: vi.fn(),
    };
    const service = new OrdersService(
      f.auth as any,
      f.gateway,
      f.store as any,
      { ...f.repo, findEvidence: async () => ({ identityProof: {} }) } as any,
      flow as any,
    );
    const accept = () =>
      service.actCustodyOffer('s', offer.offerId, {
        action: 'accept',
        pickupAt: Math.floor(Date.now() / 1000) + 600,
        vehicle: 'VAB 1234',
        expectedAt: Math.floor(Date.now() / 1000) + 7200,
      });
    await expect(accept()).rejects.toMatchObject({ code: 'COMPANY_PROOF_REQUIRED' });
    Object.assign(outcome, { status: 'VERIFIED', presenterWallet: foreign });
    await expect(accept()).rejects.toMatchObject({ code: 'COMPANY_PROOF_REQUIRED' });
    outcome.presenterWallet = source;
    expect((await accept()).offer.status).toBe('SCHEDULED');
    // The outcome is read for the offer's verifier; the short-lived presentation is never re-verified.
    expect(flow.companyIdentityProofOutcome).toHaveBeenCalledWith(expect.any(String), carrier);
    expect(flow.getCompanyIdentityProofStatus).not.toHaveBeenCalled();
  });
  it('lets the Distributor decide once an unverified company request has expired', async () => {
    const f = fixture();
    const { offer } = await f.offers.create('s', input);
    f.actor(carrier, CompanyRole.DISTRIBUTOR);
    const flow = {
      companyIdentityProofOutcome: vi.fn(async () => ({
        status: 'REQUESTED',
        presenterWallet: source,
      })),
      getCompanyIdentityProofStatus: vi.fn(),
    };
    const proof = { expiresAt: Math.floor(Date.now() / 1000) + 300 };
    const service = new OrdersService(
      f.auth as any,
      f.gateway,
      f.store as any,
      { ...f.repo, findEvidence: async () => ({ identityProof: proof }) } as any,
      flow as any,
    );
    const accept = () =>
      service.actCustodyOffer('s', offer.offerId, {
        action: 'accept',
        pickupAt: Math.floor(Date.now() / 1000) + 600,
        vehicle: 'VAB 1234',
        expectedAt: Math.floor(Date.now() / 1000) + 7200,
      });
    await expect(accept()).rejects.toMatchObject({ code: 'COMPANY_PROOF_REQUIRED' });
    proof.expiresAt = Math.floor(Date.now() / 1000) - 1;
    expect((await accept()).offer.status).toBe('SCHEDULED');
  });
  it.each([1, 2] as const)(
    'coordinates kind %s without moving stock until the original sender confirms handoff',
    async (kind) => {
      const f = fixture();
      if (kind === 2) f.actor(source, CompanyRole.MANUFACTURER);
      const { offer } = await f.offers.create('s', { ...input, kind });
      expect(f.prepare).not.toHaveBeenCalled();
      expect(f.gateway.prepare).not.toHaveBeenCalled();
      f.actor(carrier, CompanyRole.DISTRIBUTOR);
      // Acceptance carries the pickup time, vehicle and arrival, so the offer is arranged in one step.
      const pickupAt = Math.floor(Date.now() / 1000) + 600;
      await expect(f.offers.act('s', offer.offerId, { action: 'accept' })).rejects.toMatchObject({
        code: 'INVALID_PICKUP_TIME',
      });
      await expect(
        f.offers.act('s', offer.offerId, { action: 'accept', pickupAt, expectedAt: pickupAt + 60 }),
      ).rejects.toMatchObject({ code: 'PICKUP_VEHICLE_REQUIRED' });
      await expect(
        f.offers.act('s', offer.offerId, {
          action: 'accept',
          pickupAt,
          vehicle: 'VAB 1234',
          expectedAt: pickupAt,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ARRIVAL_TIME' });
      await f.offers.act('s', offer.offerId, {
        action: 'accept',
        pickupAt: Math.floor(Date.now() / 1000) + 600,
        vehicle: 'VAB 1234',
        expectedAt: Math.floor(Date.now() / 1000) + 7200,
      });
      f.actor(source, kind === 1 ? CompanyRole.SUPPLIER : CompanyRole.MANUFACTURER);
      // The label can be printed once pickup is arranged; it must match the shipment the handoff records.
      const planned = (await f.offers.get('s', offer.offerId)).plannedShipmentId;
      expect(planned).toMatch(/^0x[0-9a-f]{64}$/);
      // The sender only confirms: vehicle and arrival come from the arrangement, the time from now.
      const before = Math.floor(Date.now() / 1000);
      await f.offers.prepare('s', offer.offerId);
      const sent = f.prepare.mock.calls[0]![1];
      expect(sent.vehicle).toBe('VAB 1234');
      expect(sent.expectedAt).toBe((await f.offers.get('s', offer.offerId)).expectedAt);
      expect(sent.occurredAt).toBeGreaterThanOrEqual(before);
      expect(f.prepare).toHaveBeenCalledWith(
        's',
        expect.objectContaining({
          action: kind === 1 ? 'stock-dispatch' : 'product-dispatch',
          quantity: '10',
          fromLocation: from,
          toLocation: to,
          operationId: input.operationId,
        }),
      );
      const prepared = await f.offers.get('s', offer.offerId);
      expect(prepared.status).toBe('SCHEDULED');
      expect(prepared.shipmentId).toBeUndefined();
      expect(prepared.plannedShipmentId).toBe(planned);
      f.shipment({
        sender: source,
        recipient: carrier,
        batchId,
        productBatchId: batchId,
        quantity: '10',
        fromLocation: from,
        toLocation: to,
        status: 1,
      });
      expect((await f.offers.get('s', offer.offerId)).status).toBe('DISPATCHED');
      f.shipment({
        sender: source,
        recipient: carrier,
        batchId,
        productBatchId: batchId,
        quantity: '10',
        fromLocation: from,
        toLocation: to,
        status: kind === 1 ? 3 : 2,
      });
      expect((await f.offers.get('s', offer.offerId)).status).toBe('RECEIVED');
    },
  );
  it('blocks another company before decrypting or listing private offer data', async () => {
    const f = fixture();
    const { offer } = await f.offers.create('s', input);
    f.store.decrypt.mockClear();
    f.actor(foreign, CompanyRole.DISTRIBUTOR);
    await expect(f.offers.get('s', offer.offerId)).rejects.toMatchObject({
      code: 'OFFER_NOT_FOUND',
    });
    expect((await f.offers.list('s')).offers).toEqual([]);
    expect(f.store.decrypt).not.toHaveBeenCalled();
  });
  it('does not permit scheduling before acceptance, sender review on behalf of a carrier, or carrier dispatch on behalf of sender', async () => {
    const f = fixture();
    const { offer } = await f.offers.create('s', input);
    await expect(f.offers.act('s', offer.offerId, { action: 'accept' })).rejects.toMatchObject({
      code: 'DISTRIBUTOR_REQUIRED',
    });
    f.actor(carrier, CompanyRole.DISTRIBUTOR);
    await expect(
      f.offers.act('s', offer.offerId, {
        action: 'schedule',
        pickupAt: Math.floor(Date.now() / 1000) + 600,
      }),
    ).rejects.toMatchObject({ code: 'ACCEPT_FIRST' });
    await expect(
      f.offers.prepare('s', offer.offerId, { vehicle: 'VAB 1234', occurredAt: 1, expectedAt: 2 }),
    ).rejects.toMatchObject({ code: 'SENDER_REQUIRED' });
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it('rejection, expiry, inactive participants and requested-but-unverified proof block progression', async () => {
    const f = fixture();
    const { offer } = await f.offers.create('s', input);
    f.actor(carrier, CompanyRole.DISTRIBUTOR);
    f.proofCheck.mockRejectedValueOnce(new Error('Proof required'));
    await expect(f.offers.act('s', offer.offerId, { action: 'accept' })).rejects.toThrow(
      'Proof required',
    );
    f.active(false);
    await expect(f.offers.act('s', offer.offerId, { action: 'accept' })).rejects.toMatchObject({
      code: 'PARTICIPANT_UNAUTHORIZED',
    });
    f.active(true);
    await f.offers.act('s', offer.offerId, { action: 'reject' });
    await expect(f.offers.act('s', offer.offerId, { action: 'accept' })).rejects.toMatchObject({
      code: 'OFFER_CLOSED',
    });
    await expect(
      f.offers.create('s', { ...input, operationId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 'SENDER_ROLE_REQUIRED' });
  });
  it('rejects batch/route substitution, ciphertext changes and duplicate create operations', async () => {
    const f = fixture();
    await expect(f.offers.create('s', { ...input, fromLocation: to })).rejects.toMatchObject({
      code: 'LOCATION_NOT_OWNED',
    });
    const { offer } = await f.offers.create('s', input);
    await expect(f.offers.create('s', input)).rejects.toMatchObject({ code: 'OFFER_EXISTS' });
    const stored = f.records.get(offer.offerId);
    stored.payload.ciphertext = '{}';
    await expect(f.offers.get('s', offer.offerId)).rejects.toMatchObject({
      code: 'OFFER_UNAVAILABLE',
    });
  });
});
