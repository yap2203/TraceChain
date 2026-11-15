import { CompanyRole } from '@tracechain/shared';
import { encodeBytes32String, id } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { CustodyOffers } from './custody-offers.js';
import { OrdersService } from './orders.service.js';

const source = '0x1000000000000000000000000000000000000001',
  carrier = '0x2000000000000000000000000000000000000002',
  foreign = '0x3000000000000000000000000000000000000003';
const batchId = id('batch'),
  from = id('source'),
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
function fixture() {
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
    events: vi.fn(async () => [{ batchId, blockHash: id('registration-block') }]),
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
          unit: encodeBytes32String('kg'),
        };
      if (method === 'isAuthorized') return active;
      if (method === 'warehouses') return { distributor: carrier };
      if (method === 'locationOwner') return args?.[0] === from ? source : carrier;
      if (method === 'getRoadShipment' || method === 'getTransfer') return shipment;
      if (method === 'locationTracked') return true;
      if (method === 'locationStock') return '100';
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
  return {
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
      expect(messaging.send).toHaveBeenCalledWith(
        's',
        expect.objectContaining({ recipientWallet: source }),
      );
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
  it.each([1, 2] as const)(
    'coordinates kind %s without moving stock until the original sender confirms handoff',
    async (kind) => {
      const f = fixture();
      if (kind === 2) f.actor(source, CompanyRole.MANUFACTURER);
      const { offer } = await f.offers.create('s', { ...input, kind });
      expect(f.prepare).not.toHaveBeenCalled();
      expect(f.gateway.prepare).not.toHaveBeenCalled();
      f.actor(carrier, CompanyRole.DISTRIBUTOR);
      await f.offers.act('s', offer.offerId, { action: 'accept' });
      await f.offers.act('s', offer.offerId, {
        action: 'schedule',
        pickupAt: Math.floor(Date.now() / 1000) + 600,
      });
      f.actor(source, kind === 1 ? CompanyRole.SUPPLIER : CompanyRole.MANUFACTURER);
      const payload = {
        vehicle: 'VAB 1234',
        occurredAt: Math.floor(Date.now() / 1000),
        expectedAt: Math.floor(Date.now() / 1000) + 3600,
      };
      await f.offers.prepare('s', offer.offerId, payload);
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
