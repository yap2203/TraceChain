import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ingredientBatchRequestSchema } from '../ingredient-batches/ingredient-batch.schema.js';
import { productRequestSchema } from '../production-flow/production-flow.schema.js';
import express from 'express';
import request from 'supertest';
import { CompanyRole, encodeIngredientDeliveryQr, encodeShipmentQr } from '@tracechain/shared';
import { encodeBytes32String, id } from 'ethers';
import { OrdersService } from './orders.service.js';
import { createOrdersRouter } from './orders.routes.js';
import type { OrdersGateway } from './orders.gateway.js';
import type { AuthService } from '../auth/auth.service.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';

const buyer = '0x1000000000000000000000000000000000000001';
const seller = '0x2000000000000000000000000000000000000002';
const outsider = '0x3000000000000000000000000000000000000003';
const orderId = id('order'),
  itemId = id('item'),
  batchId = id('batch');
const operationId = '00000000-0000-4000-8000-000000000001';
afterEach(() => vi.unstubAllEnvs());
describe('Manufacturer-selected Retailer product delivery', () => {
  function product(actor = seller, role = CompanyRole.MANUFACTURER) {
    const f = fixture(actor, true, role),
      previous = f.gateway.read.getMockImplementation()!,
      expiresAt = Math.floor(Date.now() / 1000) + 3600;
    f.gateway.read.mockImplementation(async (c, m, args) => {
      if (m === 'productDeliveryPolicy') return 1;
      if (c === 'productDelivery' && m === 'get')
        return {
          manufacturer: seller,
          retailer: buyer,
          distributor: outsider,
          batchId,
          mode: 1,
          stage: 3,
        };
      if (m === 'getOrder') return { ...(await previous(c, m)), requested: '10', expiresAt };
      if (m === 'requestedBatch') return batchId;
      if (m === 'getProduct') return { manufacturer: seller };
      if (m === 'locationOwner') return args?.[0] === id('retailer-location') ? buyer : actor;
      if (m === 'getInventory') return { available: '10' };
      if (m === 'locationStock') return '10';
      return previous(c, m);
    });
    return f;
  }
  const selection = {
    action: 'product-order-select' as const,
    operationId,
    orderId,
    mode: 1 as 1 | 2,
    distributor: outsider,
    fromLocation: id('manufacturer-location'),
    toLocation: id('retailer-location'),
  };
  it('lets the owning Manufacturer prepare direct carrier selection for the Retailer order', async () => {
    const f = product();
    await f.service.prepareLogistics('session', selection);
    expect(f.gateway.prepare).toHaveBeenCalledWith(seller, 'productDelivery', 'select', [
      orderId,
      1,
      outsider,
      selection.fromLocation,
      selection.toLocation,
    ]);
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
  });
  it('rejects a foreign Manufacturer and product custody shortages', async () => {
    await expect(
      product(buyer).service.prepareLogistics('session', selection),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    const f = product(),
      previous = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (c, m, args) =>
      m === 'locationOwner'
        ? args?.[0] === selection.toLocation
          ? buyer
          : outsider
        : m === 'locationStock'
          ? '9'
          : previous(c, m, args),
    );
    await expect(
      f.service.prepareLogistics('session', { ...selection, mode: 2 }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_PRODUCT_CUSTODY' });
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('requires the exact product-order QR for assigned direct carrier pickup', async () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', 'http://localhost:5173');
    const f = product(outsider, CompanyRole.DISTRIBUTOR);
    const input = {
      action: 'product-order-dispatch' as const,
      operationId,
      orderId,
      vehicle: 'VAB 1234',
      occurredAt: Math.floor(Date.now() / 1000) - 1,
      expectedAt: Math.floor(Date.now() / 1000) + 600,
    };
    await expect(f.service.prepareLogistics('session', input)).rejects.toMatchObject({
      code: 'SHIPMENT_QR_INVALID',
    });
    const qrPayload = encodeShipmentQr({
      shipmentId: orderId,
      kind: 'product',
      chainId: 31337,
      ordersAddress: seller,
      publicAppUrl: 'http://localhost:5173',
    });
    await expect(
      f.service.prepareLogistics('session', { ...input, qrPayload }),
    ).rejects.toMatchObject({ code: 'PICKUP_PLAN_REQUIRED' });
    await f.service.pickupPlan('session', orderId, {
      pickupAt: Math.floor(Date.now() / 1000) + 300,
    });
    await f.service.prepareLogistics('session', { ...input, qrPayload });
    expect(f.gateway.prepare).toHaveBeenCalledWith(outsider, 'productDelivery', 'dispatch', [
      orderId,
      expect.objectContaining({ vehicle: 'VAB 1234' }),
    ]);
  });
});
describe('Supplier-selected direct or custody fulfilment', () => {
  function selection() {
    const f = fixture(seller, true, CompanyRole.SUPPLIER),
      read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) => {
      if (method === 'custodyPolicy') return 1;
      if (method === 'getOrder') return { ...(await read(contract, method)), requested: '10' };
      if (method === 'get') return { stage: 1 };
      if (method === 'requestDecision') return { status: 1 };
      if (method === 'requestedBatch') return batchId;
      if (method === 'getPosition')
        return { position: { supplier: seller, batchId }, available: '10' };
      if (method === 'locationOwner') return buyer;
      return read(contract, method);
    });
    return f;
  }
  const input = {
    action: 'arrange-from-custody' as const,
    operationId,
    orderId,
    positionId: id('stock'),
    receivingLocation: id('factory'),
  };
  it('prepares custody selection only for approved owned orders with sufficient exact-batch stock', async () => {
    const f = selection();
    await f.service.prepareLogistics('session', input);
    expect(f.gateway.prepare).toHaveBeenCalledWith(seller, 'delivery', 'arrangeFromCustody', [
      orderId,
      input.positionId,
      input.receivingLocation,
    ]);
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
  });
  it.each([
    [
      'getPosition',
      { position: { supplier: outsider, batchId }, available: '100' },
      'INSUFFICIENT_CUSTODY_STOCK',
    ],
    [
      'getPosition',
      { position: { supplier: seller, batchId: id('foreign') }, available: '100' },
      'INSUFFICIENT_CUSTODY_STOCK',
    ],
    [
      'getPosition',
      { position: { supplier: seller, batchId }, available: '9' },
      'INSUFFICIENT_CUSTODY_STOCK',
    ],
    ['get', { stage: 2 }, 'FULFILMENT_SELECTION_CLOSED'],
    ['requestDecision', { status: 0 }, 'FULFILMENT_SELECTION_CLOSED'],
    ['locationOwner', outsider, 'RESOURCE_NOT_FOUND'],
    ['getOrder', { seller: outsider }, 'RESOURCE_NOT_FOUND'],
    ['fulfilmentPolicy', 1, 'FULFILMENT_UPGRADE_REQUIRED'],
  ])('rejects substituted or unavailable selection: %s %j', async (method, value, code) => {
    const f = selection(),
      read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (c, m) => (m === method ? value : read(c, m)));
    await expect(f.service.prepareLogistics('session', input)).rejects.toMatchObject({ code });
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('allows ingredient requests without a custody position for Supplier selection after approval', async () => {
    const f = fixture(),
      read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (c, m) =>
      [
        'ingredientDeliveryPolicy',
        'registeredRequestPolicy',
        'requestOnlyPolicy',
        'custodyPolicy',
      ].includes(m)
        ? 1
        : read(c, m),
    );
    await f.service.prepare('session', {
      action: 'request',
      operationId,
      itemId,
      batchId,
      kind: 1,
      quantity: '10',
      unit: 'g',
      location: id('factory'),
      requestOnly: true,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      evidenceRequired: false,
      note: '',
    });
    expect(f.gateway.prepare).toHaveBeenCalledWith(
      buyer,
      'orders',
      'requestIngredientDelivery',
      expect.any(Array),
    );
    expect(f.gateway.prepare).not.toHaveBeenCalledWith(
      buyer,
      'delivery',
      'placeCustodyOrder',
      expect.anything(),
    );
  });
});
describe('cross-company management denial', () => {
  it('rejects another company receiving location before storing a new order', async () => {
    const f = fixture(),
      previous = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'locationOwner' ? outsider : previous(contract, method),
    );
    await expect(
      f.service.prepare('session', {
        action: 'request',
        operationId,
        itemId,
        kind: 1,
        batchId,
        quantity: '10',
        unit: 'g',
        location: id('foreign-factory'),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        note: '',
      } as any),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('rejects a Supplier attempting to order ingredients as a Manufacturer', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER);
    await expect(
      f.service.prepare('session', {
        action: 'request',
        operationId,
        kind: 1,
        batchId,
        quantity: '10',
      } as any),
    ).rejects.toMatchObject({ code: 'BUYER_ROLE_REQUIRED', status: 403 });
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
  });
  it.each([CompanyRole.MANUFACTURER, CompanyRole.DISTRIBUTOR])(
    'preserves legitimate product dispatch by its owner or current custodian: %s',
    async (role) => {
      const f = fixture(outsider, true, role),
        previous = f.gateway.read.getMockImplementation()!;
      f.gateway.read.mockImplementation(async (contract, method) => {
        if (method === 'custodyPolicy') return 1;
        if (method === 'getProduct')
          return { manufacturer: role === CompanyRole.MANUFACTURER ? outsider : buyer };
        if (method === 'getInventory') return { available: '10' };
        return previous(contract, method);
      });
      await f.service.prepareLogistics('session', {
        action: 'product-dispatch',
        operationId,
        batchId,
        quantity: '10',
        recipient: buyer,
        fromLocation: id('source'),
        toLocation: id('target'),
        vehicle: 'VAB 1234',
        occurredAt: Math.floor(Date.now() / 1000) - 60,
        expectedAt: Math.floor(Date.now() / 1000) + 600,
      });
      expect(f.gateway.prepare).toHaveBeenCalledWith(
        outsider,
        'custody',
        'createRoadTransfer',
        expect.any(Array),
      );
    },
  );
  it.each([
    'propose',
    'close',
    'evidence',
    'bind-evidence',
    'recall',
    'ingredient-archive',
    'ingredient-update',
    'list',
    'decide-request',
  ])('rejects foreign records before preparing or storing: %s', async (action) => {
    const f = fixture(outsider, true, CompanyRole.SUPPLIER);
    await expect(
      f.service.prepare('session', {
        action,
        operationId,
        orderId,
        batchId,
        kind: 1,
        name: 'Foreign ingredient',
        evidenceId: id('proof'),
        archived: true,
      } as any),
    ).rejects.toMatchObject({ status: expect.any(Number) });
    expect(f.gateway.prepare).not.toHaveBeenCalled();
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
  });
  it.each([
    'stock-dispatch',
    'product-dispatch',
    'warehouse-decision',
    'arrange-delivery',
    'order-dispatch',
    'shipment-vehicle',
    'warehouse',
  ])('denies same-role resource substitution in logistics: %s', async (action) => {
    const role =
      action === 'product-dispatch'
        ? CompanyRole.MANUFACTURER
        : ['stock-dispatch', 'arrange-delivery'].includes(action)
          ? CompanyRole.SUPPLIER
          : CompanyRole.DISTRIBUTOR;
    const f = fixture(outsider, true, role),
      previous = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) => {
      if (method === 'custodyPolicy' || method === 'reviewPolicy') return 1;
      if (method === 'getProduct') return { manufacturer: buyer };
      if (method === 'getRoadShipment') return { sender: seller, recipient: buyer };
      if (method === 'custodyOrders') return { positionId: id('position') };
      if (method === 'getPosition') return { position: { distributor: buyer } };
      if (method === 'locationOwner') return buyer;
      return previous(contract, method);
    });
    await expect(
      f.service.prepareLogistics('session', {
        action,
        operationId,
        orderId,
        batchId,
        shipmentId: id('shipment'),
        quantity: '10',
        fromLocation: id('source'),
        toLocation: id('destination'),
        location: id('warehouse'),
        occurredAt: Math.floor(Date.now() / 1000) - 60,
        expectedAt: Math.floor(Date.now() / 1000) + 600,
        vehicle: 'VAB 1234',
        decision: 1,
        name: 'Warehouse',
        recipient: buyer,
      } as any),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    expect(f.gateway.prepare).not.toHaveBeenCalled();
    expect(f.store.encryptAndStore).not.toHaveBeenCalled();
  });
  it('rejects a valid QR when the shipment belongs to a different receiver', async () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', 'http://localhost:5173');
    const f = fixture(outsider, true, CompanyRole.DISTRIBUTOR),
      previous = f.gateway.read.getMockImplementation()!;
    const shipmentId = id('other-company-shipment');
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'custodyPolicy'
        ? 1
        : method === 'getRoadShipment'
          ? { recipient: buyer }
          : previous(contract, method),
    );
    const qrPayload = encodeShipmentQr({
      shipmentId,
      kind: 'ingredient',
      chainId: 31337,
      ordersAddress: seller,
      publicAppUrl: 'http://localhost:5173',
    });
    await expect(
      f.service.prepareLogistics('session', {
        action: 'shipment-receive',
        operationId,
        shipmentId,
        kind: 'ingredient',
        quantity: '10',
        occurredAt: Math.floor(Date.now() / 1000),
        qrPayload,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
});
describe('private custody and company proof inbox', () => {
  it('marks a proof from a missing or reset chain context unavailable without reusing its presentation', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER),
      previous = f.gateway.read.getMockImplementation()!;
    Object.assign(f.repository, {
      listEvidence: vi.fn().mockResolvedValue([
        {
          requestId: id('stale'),
          requester: buyer,
          supplier: seller,
          orderContext: true,
          identityProof: {
            purpose: 'Old order proof',
            expiresAt: 2000000000,
            status: 'VERIFIED',
          },
        },
      ]),
    });
    const status = vi.fn();
    Object.assign(f.service, { flow: { getCompanyIdentityProofStatus: status } });
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'getOrder'
        ? {
            buyer: '0x0000000000000000000000000000000000000000',
            seller: '0x0000000000000000000000000000000000000000',
          }
        : previous(contract, method),
    );
    expect((await f.service.informationRequests('session')).requests[0].status).toBe('UNAVAILABLE');
    expect(status).not.toHaveBeenCalled();
  });
  it.each([
    [outsider, CompanyRole.DISTRIBUTOR, 1, 1],
    ['0x4000000000000000000000000000000000000004', CompanyRole.DISTRIBUTOR, 0, 0],
    [seller, CompanyRole.SUPPLIER, 1, 1],
    [buyer, CompanyRole.MANUFACTURER, 0, 1],
  ] as const)(
    'restricts inventory for %s / %s on the server',
    async (actor, role, privateCount, catalogueCount) => {
      const f = fixture(actor, true, role),
        read = f.gateway.read.getMockImplementation()!,
        events = f.gateway.events.getMockImplementation()!;
      const positionId = id('private-warehouse-position');
      f.gateway.events.mockImplementation(async (contract, event) =>
        event === 'CustodyPositionCreated' ? [{ positionId }] : events(contract, event),
      );
      f.gateway.read.mockImplementation(async (contract, method) =>
        method === 'ingredientDeliveryPolicy' || method === 'custodyPolicy'
          ? 1
          : method === 'getPosition'
            ? {
                position: {
                  batchId,
                  supplier: seller,
                  distributor: outsider,
                  location: id('warehouse'),
                  unit: encodeBytes32String('g'),
                  quantity: '100',
                },
                reserved: '60',
                available: '40',
              }
            : method === 'get'
              ? { stage: 0 }
              : method === 'custodyOrders'
                ? { positionId: id('other'), quantity: '0' }
                : method === 'isAuthorized' || method === 'isValidTraceabilitySource'
                  ? true
                  : read(contract, method),
      );
      const result = await f.service.state('session');
      expect(result.logistics?.positions).toHaveLength(privateCount);
      expect(result.catalogue[0]?.custodyPositions ?? []).toHaveLength(catalogueCount);
      if (role === CompanyRole.DISTRIBUTOR && !privateCount)
        expect(result.catalogue).toHaveLength(0);
      if (role === CompanyRole.MANUFACTURER) {
        expect(result.catalogue[0].custodyPositions[0]).toMatchObject({ available: '40' });
        expect(result.catalogue[0].custodyPositions[0]).not.toHaveProperty('quantity');
        expect(result.catalogue[0].custodyPositions[0]).not.toHaveProperty('reserved');
      }
      if (privateCount === 0) expect(result.logistics?.productPositions).toHaveLength(0);
    },
  );
  it('lists only exact participants’ company proof requests without credential payloads', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER);
    const proof = {
      purpose: 'Confirm company role',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      status: 'REQUESTED',
      presentationPayload: { ciphertext: 'private-secret' },
    };
    const records = [
      {
        requestId: id('received'),
        requester: seller,
        supplier: outsider,
        deliveryOrderId: id('incoming'),
        identityProof: proof,
      },
      {
        requestId: id('sent'),
        requester: buyer,
        supplier: seller,
        orderContext: true,
        identityProof: proof,
      },
      { requestId: id('foreign'), requester: buyer, supplier: outsider, identityProof: proof },
    ];
    const status = vi.fn().mockResolvedValue({ status: 'REQUESTED' });
    Object.assign(f.repository, { listEvidence: vi.fn().mockResolvedValue(records) });
    Object.assign(f.service, { flow: { getCompanyIdentityProofStatus: status } });
    const response = await request(f.app).get('/api/orders/information-requests').expect(200);
    expect(response.body.requests).toHaveLength(2);
    expect(response.body.requests.map((row: any) => row.direction).sort()).toEqual([
      'received',
      'sent',
    ]);
    expect(response.body.requests.find((row: any) => row.context === 'delivery').referenceId).toBe(
      id('incoming'),
    );
    expect(JSON.stringify(response.body)).not.toContain('private-secret');
    expect(JSON.stringify(response.body)).not.toContain(id('foreign'));
    expect(status).toHaveBeenCalledTimes(2);
  });
});
describe('warehouse-first transport preparation', () => {
  it('binds Supplier company proof to the incoming custody shipment and its exact Distributor', async () => {
    const f = fixture(outsider, true, CompanyRole.DISTRIBUTOR),
      previous = f.gateway.read.getMockImplementation()!;
    const shipmentId = id('custody-offer');
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'reviewPolicy'
        ? 1
        : method === 'getRoadShipment'
          ? { leg: 1, sender: seller, recipient: outsider, batchId }
          : method === 'get'
            ? { stage: 2, distributor: outsider }
            : previous(contract, method),
    );
    const status = vi.fn().mockResolvedValue({ status: 'NOT_REQUESTED' });
    Object.assign(f.service, { flow: { getCompanyIdentityProofStatus: status }, messaging: {} });
    await f.service.identity('session', shipmentId, { action: 'status' }, true);
    const reference = id(
      `ingredient-delivery-identity:${shipmentId.toLowerCase()}:${outsider.toLowerCase()}`,
    );
    expect(status).toHaveBeenCalledWith('session', reference);
    const record = {
      deliveryOrderId: shipmentId,
      requestId: reference,
      requester: seller,
      supplier: outsider,
    } as any;
    expect(await f.service.deliveryIdentityParticipants(record)).toBe(true);
    expect(await f.service.deliveryIdentityParticipants({ ...record, requester: buyer })).toBe(
      false,
    );
  });
  it('prepares custody decisions and Supplier arrangement only through the updated child contract', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER),
      previous = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) =>
      method === 'custodyPolicy' || method === 'reviewPolicy' ? 1 : previous(contract, method),
    );
    await f.service.prepareLogistics('session', {
      action: 'arrange-delivery',
      operationId,
      orderId,
    });
    expect(f.gateway.prepare).toHaveBeenCalledWith(seller, 'delivery', 'arrangeDelivery', [
      orderId,
    ]);
    await expect(
      f.service.prepareLogistics('session', {
        action: 'warehouse-decision',
        operationId,
        shipmentId: id('incoming'),
        decision: 2,
      }),
    ).rejects.toMatchObject({ code: 'DISTRIBUTOR_REQUIRED', status: 403 });
    const distributor = fixture(outsider, true, CompanyRole.DISTRIBUTOR),
      read = distributor.gateway.read.getMockImplementation()!;
    distributor.gateway.read.mockImplementation(async (contract, method) =>
      method === 'custodyPolicy' || method === 'reviewPolicy'
        ? 1
        : method === 'getRoadShipment'
          ? { sender: seller, recipient: outsider }
          : read(contract, method),
    );
    await distributor.service.prepareLogistics('session', {
      action: 'warehouse-decision',
      operationId,
      shipmentId: id('incoming'),
      decision: 2,
    });
    expect(distributor.gateway.prepare).toHaveBeenCalledWith(
      outsider,
      'delivery',
      'decideWarehouseShipment',
      [id('incoming'), 2],
    );
  });
  it('hides buyer/seller notes from the warehouse custodian before seller approval', async () => {
    const f = fixture(outsider, true, CompanyRole.DISTRIBUTOR);
    const read = f.gateway.read.getMockImplementation()!,
      events = f.gateway.events.getMockImplementation()!;
    const positionId = id('private-position'),
      location = id('warehouse');
    f.gateway.events.mockImplementation((contract, event) =>
      event === 'CustodyPositionCreated'
        ? Promise.resolve([{ positionId }])
        : events(contract, event),
    );
    f.gateway.read.mockImplementation(async (contract, method) => {
      if (method === 'ingredientDeliveryPolicy' || method === 'custodyPolicy') return 1;
      if (method === 'get')
        return { stage: '0', distributor: '0x0000000000000000000000000000000000000000' };
      if (method === 'getPosition')
        return {
          position: {
            batchId,
            supplier: seller,
            distributor: outsider,
            location,
            unit: encodeBytes32String('g'),
            quantity: '100',
          },
          available: '90',
          reserved: '10',
        };
      if (method === 'custodyOrders')
        return { positionId, quantity: '10', dispatched: '0', received: '0' };
      if (method === 'isAuthorized' || method === 'isValidTraceabilitySource') return true;
      if (method === 'getOrder')
        return {
          ...(await read(contract, method)),
          detailsHash: id('private-note'),
          detailsCid: 'encrypted-note',
        };
      return read(contract, method);
    });
    await f.repository.savePrivate('products', {
      id: orderId,
      contentHash: id('private-note'),
      cid: 'encrypted-note',
      payload: { ciphertext: JSON.stringify({ note: 'Buyer confidential note' }) },
    });
    const result = await f.service.state('session');
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].custodyOrder.distributor).toBe(outsider);
    expect(result.orders[0].details).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('Buyer confidential note');
  });
  const now = Math.floor(Date.now() / 1000);
  const road = {
    action: 'stock-dispatch',
    operationId,
    batchId,
    quantity: '10',
    fromLocation: id('source'),
    toLocation: id('warehouse'),
    vehicle: 'vab 1234',
    occurredAt: now - 60,
    expectedAt: now + 3600,
  };
  function warehouse(actor = seller, authorized = true) {
    const f = fixture(
      actor,
      authorized,
      actor === seller ? CompanyRole.SUPPLIER : CompanyRole.MANUFACTURER,
    );
    const previous = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, ...rest) =>
      method === 'custodyPolicy'
        ? 1
        : method === 'getPosition'
          ? { position: { batchId, unit: encodeBytes32String('g') }, available: '20' }
          : method === 'locationOwner'
            ? actor
            : previous(contract, method, ...rest),
    );
    return f;
  }
  it('prepares canonical road data with an authenticated sender and normalized vehicle', async () => {
    const f = warehouse();
    const response = await request(f.app).post('/api/orders/logistics/prepare').send(road);
    expect(response.status).toBe(200);
    expect(f.gateway.prepare).toHaveBeenCalledWith(seller, 'delivery', 'dispatchToWarehouse', [
      expect.objectContaining({
        vehicle: 'VAB 1234',
        referenceId: batchId,
        quantity: '10',
        occurredAt: now - 60,
      }),
    ]);
  });
  it('rejects malformed input, future times, invalid arrival and unauthenticated access', async () => {
    const f = warehouse();
    for (const changes of [
      { vehicle: ' ' },
      { quantity: '1.5' },
      { occurredAt: now + 3600 },
      { expectedAt: now - 100 },
      { fromLocation: 'invalid' },
    ])
      expect(
        (
          await request(f.app)
            .post('/api/orders/logistics/prepare')
            .send({ ...road, ...changes })
        ).status,
      ).toBe(400);
    expect(f.gateway.prepare).not.toHaveBeenCalled();
    expect(
      (await request(warehouse(seller, false).app).post('/api/orders/logistics/prepare').send(road))
        .status,
    ).toBe(403);
  });
  it('requires available warehouse stock and selects the atomic reservation method', async () => {
    const f = warehouse(buyer);
    const input = {
      action: 'request' as const,
      operationId,
      kind: 1 as const,
      batchId,
      quantity: '20',
      unit: 'g',
      positionId: id('position'),
      location: id('factory'),
      expiresAt: now + 3600,
      note: '',
    };
    await f.service.prepare('session', input);
    expect(f.gateway.prepare).toHaveBeenCalledWith(
      buyer,
      'delivery',
      'placeCustodyOrder',
      expect.arrayContaining([input.positionId, '20', input.location]),
    );
    f.gateway.prepare.mockClear();
    await expect(f.service.prepare('session', { ...input, quantity: '21' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_CUSTODY_STOCK',
    });
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  it('rejects a substituted shipment QR before preparing receipt and distinguishes RPC outages', async () => {
    const f = warehouse(buyer);
    const qrPayload = encodeShipmentQr({
      shipmentId: id('other'),
      kind: 'ingredient',
      chainId: 31337,
      ordersAddress: seller,
      publicAppUrl: 'http://localhost:5173',
    });
    await expect(
      f.service.prepareLogistics('session', {
        action: 'shipment-receive',
        operationId,
        shipmentId: id('intended'),
        kind: 'ingredient',
        quantity: '10',
        occurredAt: now,
        qrPayload,
      }),
    ).rejects.toMatchObject({ code: 'SHIPMENT_QR_INVALID' });
    const sender = warehouse();
    sender.gateway.prepare.mockRejectedValueOnce(
      Object.assign(new Error('revert'), { code: 'CALL_EXCEPTION' }),
    );
    expect(
      (await request(sender.app).post('/api/orders/logistics/prepare').send(road)).body.error.code,
    ).toBe('CUSTODY_TRANSITION_REJECTED');
    sender.gateway.prepare.mockRejectedValueOnce(new Error('RPC unavailable'));
    expect(
      (await request(sender.app).post('/api/orders/logistics/prepare').send(road)).status,
    ).toBe(503);
  });
});
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
      if (method === 'productDeliveryPolicy') return 0;
      if (method === 'fulfilmentPolicy') return 2;
      if (method === 'locationOwner') return actor;
      if (method === 'custodyPolicy' || method === 'reviewPolicy') return 0;
      if (method === 'approvedReceiptPolicy' || method === 'ingredientDeliveryPolicy') return 0;
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
      if (method === 'getInventory')
        return { available: '0', reserved: '0', damaged: '0', rejected: '0' };
      if (method === 'locationTracked') return false;
      if (method === 'productionLocation') return id('factory');
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
      if (method === 'isTransferable') return true;
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
    undefined,
    undefined,
    {
      resolve: vi.fn(async (walletAddress: string) => ({
        active: true,
        companyName:
          walletAddress.toLowerCase() === seller.toLowerCase()
            ? 'Verified Supplier'
            : 'Verified Buyer',
        role: walletAddress.toLowerCase() === seller.toLowerCase() ? CompanyRole.SUPPLIER : role,
        walletAddress,
      })),
      resolveMany: vi.fn(async (wallets: string[]) =>
        wallets.map((walletAddress) => ({
          active: true as const,
          companyName:
            walletAddress.toLowerCase() === seller.toLowerCase()
              ? 'Verified Supplier'
              : 'Verified Buyer',
          role: walletAddress.toLowerCase() === seller.toLowerCase() ? CompanyRole.SUPPLIER : role,
          walletAddress,
        })),
      ),
      list: vi.fn(async () => []),
    } as unknown as StakeholderDirectory,
  );
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(
    '/api/orders',
    createOrdersRouter(() => service, 'session'),
  );
  return { app, gateway, service, store, repository };
}
describe('order API and private metadata', () => {
  it('publishes real product availability, recorded origin and traceability status to Retailers', async () => {
    const f = fixture(buyer, true, CompanyRole.RETAILER);
    const metadata = JSON.stringify({
      batchReference: 'CHOC-2026-01',
      origin: 'Malaysia',
      productName: 'Dark chocolate bar',
    });
    const metadataHash = `0x${createHash('sha256').update(metadata).digest('hex')}`;
    await f.repository.savePrivate('products', {
      cid: 'product-cid',
      contentHash: metadataHash,
      id: batchId,
      owner: seller,
      payload: { ciphertext: metadata },
    });
    const previousRead = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method) => {
      if (method === 'getItem')
        return {
          seller,
          kind: '2',
          unit: encodeBytes32String('each'),
          active: true,
        };
      if (method === 'getProduct')
        return {
          manufacturer: seller,
          metadataHash,
          publicCid: 'product-cid',
          totalQuantity: '123',
          unit: encodeBytes32String('each'),
          status: '1',
          expiresAt: '2000000000',
          producedAt: '1900000000',
        };
      if (method === 'getInventory')
        return { available: '40', reserved: '2', damaged: '0', rejected: '0' };
      if (method === 'locationTracked') return true;
      if (method === 'productionLocation') return id('factory');
      if (method === 'productionRecordedAt') return '1900000010';
      if (method === 'getIngredientLinks') return [];
      if (method === 'isTransferable') return true;
      return previousRead(contract, method);
    });
    const previousEvents = f.gateway.events.getMockImplementation()!;
    f.gateway.events.mockImplementation(async (contract, name) => {
      if (name === 'ProductCreated') return [{ batchId, manufacturer: seller }];
      if (name === 'InventoryInitialized') return [{ productBatchId: batchId }];
      return previousEvents(contract, name);
    });

    const response = await request(f.app).get('/api/orders').expect(200);
    expect(response.body.catalogue[0]).toMatchObject({
      countryOfOrigin: 'Malaysia',
      credentialLabel: 'Linked credentials active',
      credentialStatus: 1,
      name: 'Dark chocolate bar',
      batchDetails: [expect.objectContaining({ manufacturerAvailable: '40' })],
    });
    expect(response.body.catalogue[0].batchDetails[0].manufacturerAvailable).not.toBe('123');
  });

  function deliveryFixture(actor = seller, role = CompanyRole.SUPPLIER, stage = 1) {
    const f = fixture(actor, true, role),
      read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, args) => {
      if (method === 'ingredientDeliveryPolicy' || method === 'approvedReceiptPolicy') return 1;
      if (method === 'get')
        return {
          stage,
          distributor: outsider,
          assignmentDeadline: Math.floor(Date.now() / 1000) + 3600,
          reservedQuantity: '10',
          pickedUpAt: 1,
        };
      if (method === 'requestedBatch') return batchId;
      if (method === 'approvedReceivedQuantity') return '0';
      if (method === 'requestDecision')
        return { ...(await read(contract, method, args)), status: 1, recordedAt: 1 };
      if (method === 'locationOwner') return buyer;
      return read(contract, method, args);
    });
    return f;
  }
  it('exposes delivery records to the exact assigned Distributor and hides them from unrelated companies', async () => {
    const allowed = await deliveryFixture(outsider, CompanyRole.DISTRIBUTOR, 2).service.state(
      'session',
    );
    expect(allowed.orders).toHaveLength(1);
    expect(allowed.orders[0].delivery.stage).toBe(2);
    const denied = await deliveryFixture(
      '0x4000000000000000000000000000000000000004',
      CompanyRole.DISTRIBUTOR,
      2,
    ).service.state('session');
    expect(denied.orders).toEqual([]);
  });
  it('prepares assignment and carrier acceptance for the module, never as an untrusted forwarded actor', async () => {
    const f = deliveryFixture();
    await f.service.prepare('session', {
      action: 'delivery-assign',
      orderId,
      operationId,
      distributor: outsider,
    });
    expect(f.gateway.prepare).toHaveBeenCalledWith(
      seller,
      'delivery',
      'act',
      expect.arrayContaining([1, seller, orderId, outsider]),
    );
    const carrier = deliveryFixture(outsider, CompanyRole.DISTRIBUTOR, 2);
    await carrier.service.prepare('session', {
      action: 'delivery-respond',
      orderId,
      operationId,
      accept: true,
    });
    expect(carrier.gateway.prepare).toHaveBeenCalledWith(
      outsider,
      'delivery',
      'act',
      expect.arrayContaining([2, outsider, orderId]),
    );
    await expect(
      deliveryFixture(buyer, CompanyRole.MANUFACTURER, 2).service.prepare('session', {
        action: 'delivery-respond',
        orderId,
        operationId,
        accept: true,
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_RESPONSE_UNAVAILABLE' });
  });
  it('requires an exact scanned delivery locator before preparing pickup or receipt', async () => {
    const carrier = deliveryFixture(outsider, CompanyRole.DISTRIBUTOR, 3);
    await expect(
      carrier.service.prepare('session', {
        action: 'delivery-pickup',
        orderId,
        operationId,
        occurredAt: 1,
        qrPayload: 'https://attacker.example',
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_QR_INVALID' });
    expect(carrier.gateway.prepare).not.toHaveBeenCalled();
    const manufacturer = deliveryFixture(buyer, CompanyRole.MANUFACTURER, 4);
    await expect(
      manufacturer.service.prepare('session', {
        action: 'approved-receipt',
        orderId,
        operationId,
        quantity: '10',
        location: id('factory'),
        occurredAt: 1,
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_QR_INVALID' });
  });
  it('uses reserved transit stock at receipt instead of requiring the same stock still available at the Supplier', async () => {
    const f = deliveryFixture(buyer, CompanyRole.MANUFACTURER, 4),
      read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, args) =>
      method === 'getBatch'
        ? { ...(await read(contract, method, args)), availableQuantity: '0' }
        : read(contract, method, args),
    );
    const previous = process.env.VITE_PUBLIC_APP_URL;
    process.env.VITE_PUBLIC_APP_URL = 'https://tracechain.example';
    try {
      const qrPayload = encodeIngredientDeliveryQr({
        orderId: orderId as `0x${string}`,
        chainId: 31337,
        ordersAddress: seller,
        publicAppUrl: process.env.VITE_PUBLIC_APP_URL,
      });
      await f.service.prepare('session', {
        action: 'approved-receipt',
        operationId,
        orderId,
        quantity: '10',
        location: id('factory'),
        occurredAt: 1,
        qrPayload,
      });
      expect(f.gateway.prepare).toHaveBeenCalledWith(
        buyer,
        'orders',
        'confirmApprovedIngredientReceipt',
        expect.arrayContaining([orderId, '10']),
      );
    } finally {
      if (previous === undefined) delete process.env.VITE_PUBLIC_APP_URL;
      else process.env.VITE_PUBLIC_APP_URL = previous;
    }
  });
  it('includes demand-adjusted stock only for the authenticated Supplier', async () => {
    const supplier = fixture(seller, true, CompanyRole.SUPPLIER);
    const response = await request(supplier.app).get('/api/orders');
    expect(response.status).toBe(200);
    expect(response.body.supplierStock).toEqual([
      expect.objectContaining({
        batchId,
        availableQuantity: '200000',
        pendingQuantity: '100000',
        remainingAfterRequests: '100000',
      }),
    ]);
    const manufacturer = fixture();
    const buyerResponse = await request(manufacturer.app).get('/api/orders');
    expect(buyerResponse.status).toBe(200);
    expect(buyerResponse.body).not.toHaveProperty('supplierStock');
  });
  it('prepares approved receipt only for the intended Manufacturer and outstanding quantity', async () => {
    const f = fixture(),
      read = f.gateway.read.getMockImplementation()!;
    f.gateway.read.mockImplementation(async (contract, method, args) => {
      if (method === 'approvedReceiptPolicy') return 1;
      if (method === 'requestDecision') return { status: '1', recordedAt: '1' };
      if (method === 'approvedReceivedQuantity') return '99500';
      if (method === 'requestedBatch') return batchId;
      if (method === 'locationOwner') return buyer;
      return read(contract, method, args);
    });
    const input = {
      action: 'approved-receipt' as const,
      operationId,
      orderId,
      quantity: '500',
      location: id('factory'),
      occurredAt: Math.floor(Date.now() / 1000) - 60,
    };
    await f.service.prepare('session', input);
    expect(f.gateway.prepare).toHaveBeenCalledWith(
      buyer,
      'orders',
      'confirmApprovedIngredientReceipt',
      expect.arrayContaining([orderId, '500', id('factory')]),
    );
    f.gateway.prepare.mockClear();
    await expect(f.service.prepare('session', { ...input, quantity: '501' })).rejects.toMatchObject(
      { code: 'RECEIPT_EXCEEDS_APPROVAL' },
    );
    expect(f.gateway.prepare).not.toHaveBeenCalled();
    const unauthorized = fixture(outsider);
    const otherRead = unauthorized.gateway.read.getMockImplementation()!;
    unauthorized.gateway.read.mockImplementation(async (contract, method, args) =>
      method === 'approvedReceiptPolicy' ? 1 : otherRead(contract, method, args),
    );
    await expect(unauthorized.service.prepare('session', input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('reports the required receipt deployment update instead of inventing received stock', async () => {
    const f = fixture();
    await expect(
      f.service.prepare('session', {
        action: 'approved-receipt',
        operationId,
        orderId,
        quantity: '1',
        location: id('factory'),
        occurredAt: 1,
      }),
    ).rejects.toMatchObject({ code: 'APPROVED_RECEIPT_UPGRADE_REQUIRED' });
    expect(f.gateway.prepare).not.toHaveBeenCalled();
  });
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  it('stores and serves an authorized Supplier image without exposing storage references', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER);
    const uploaded = await request(f.app)
      .post(`/api/orders/catalogue/ingredients/${batchId}/image`)
      .send({ data: png, fileName: 'cocoa.png', mimeType: 'image/png' })
      .expect(200);
    expect(uploaded.body.image).toMatchObject({
      mimeType: 'image/png',
      path: `/catalogue/ingredients/${batchId}/image`,
      supplierProvided: true,
      width: 1,
      height: 1,
    });
    expect(JSON.stringify(uploaded.body)).not.toContain('encrypted-cid');
    const image = await request(f.app)
      .get(`/api/orders/catalogue/ingredients/${batchId}/image`)
      .expect(200)
      .expect('Content-Type', 'image/png');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.body).toEqual(Buffer.from(png, 'base64'));
  });

  it('stores and serves an authorized Manufacturer product image without exposing storage references', async () => {
    const f = fixture(buyer, true, CompanyRole.MANUFACTURER);
    const read = f.gateway.read.getMockImplementation()!;
    const events = f.gateway.events.getMockImplementation()!;
    const productBatchId = id('presentation-product');
    const location = id('manufacturer-factory');
    const metadata = JSON.stringify({
      batchReference: 'PRODUCT-001',
      category: 'Confectionery',
      description: 'Manufacturer-provided public catalogue copy.',
      price: '12.00',
      currency: 'MYR',
      productName: 'Finished Chocolate',
      productionLocation: location,
      productionLocationName: 'Shah Alam Chocolate Plant',
    });
    const metadataHash = `0x${createHash('sha256').update(metadata).digest('hex')}`;
    f.gateway.read.mockImplementation(async (contract, method, args) =>
      method === 'getProduct'
        ? {
            manufacturer: buyer,
            status: 1,
            metadataHash,
            publicCid: 'encrypted-cid',
            totalQuantity: '123',
            unit: encodeBytes32String('each'),
            producedAt: 1_790_000_000,
            expiresAt: 2_000_000_000,
          }
        : method === 'getIngredientLinks'
          ? []
          : method === 'productionLocation'
            ? location
            : method === 'productionRecordedAt'
              ? 1_790_000_100
              : read(contract, method, args),
    );
    f.gateway.events.mockImplementation(async (contract, name) =>
      name === 'ProductCreated'
        ? [{ productBatchId, manufacturer: buyer, blockNumber: 50 }]
        : events(contract, name),
    );
    await f.repository.savePrivate('products', {
      cid: 'encrypted-cid',
      contentHash: metadataHash,
      id: productBatchId,
      owner: buyer,
      payload: { ciphertext: metadata },
    });
    const uploaded = await request(f.app)
      .post(`/api/orders/catalogue/products/${productBatchId}/image`)
      .send({ data: png, fileName: 'finished-product.png', mimeType: 'image/png' })
      .expect(200);
    expect(uploaded.body.image).toMatchObject({
      height: 1,
      manufacturerProvided: true,
      mimeType: 'image/png',
      path: `/catalogue/products/${productBatchId}/image`,
      width: 1,
    });
    expect(JSON.stringify(uploaded.body)).not.toContain('encrypted-cid');
    const image = await request(f.app)
      .get(`/api/orders/catalogue/products/${productBatchId}/image`)
      .expect(200)
      .expect('Content-Type', 'image/png');
    expect(image.body).toEqual(Buffer.from(png, 'base64'));
    const state = await f.service.state('session');
    const product = state.catalogue.find((entry) => Number(entry.kind) === 2);
    expect(product, JSON.stringify(state.catalogue, null, 2)).toMatchObject({
      batchReference: 'PRODUCT-001',
      category: 'Confectionery',
      description: 'Manufacturer-provided public catalogue copy.',
      imagePath: `/catalogue/products/${productBatchId}/image`,
      name: 'Finished Chocolate',
      price: '12.00',
      currency: 'MYR',
      productionLocation: location,
      productionLocationName: 'Shah Alam Chocolate Plant',
    });
    expect(JSON.stringify(product)).not.toContain(png);
    expect(JSON.stringify(product)).not.toContain('ciphertext');
  });

  it('rejects an oversized product image and a product image from another Manufacturer', async () => {
    const owner = fixture(buyer, true, CompanyRole.MANUFACTURER);
    const ownerRead = owner.gateway.read.getMockImplementation()!;
    owner.gateway.read.mockImplementation(async (contract, method, args) =>
      method === 'getProduct'
        ? { manufacturer: buyer, status: 1 }
        : ownerRead(contract, method, args),
    );
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
    const invalid = await request(owner.app)
      .post(`/api/orders/catalogue/products/${batchId}/image`)
      .send({ data: oversized, fileName: 'large.png', mimeType: 'image/png' })
      .expect(400);
    expect(invalid.body.error.code).toBe('IMAGE_TOO_LARGE');

    const other = fixture(seller, true, CompanyRole.MANUFACTURER);
    const otherRead = other.gateway.read.getMockImplementation()!;
    other.gateway.read.mockImplementation(async (contract, method, args) =>
      method === 'getProduct'
        ? { manufacturer: buyer, status: 1 }
        : otherRead(contract, method, args),
    );
    await request(other.app)
      .post(`/api/orders/catalogue/products/${batchId}/image`)
      .send({ data: png, fileName: 'product.png', mimeType: 'image/png' })
      .expect(403);
    expect(other.store.encryptAndStore).not.toHaveBeenCalled();
  });

  it('rejects oversized, unsupported, mismatched and corrupt catalogue images', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER);
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
    const cases = [
      {
        body: { data: oversized, fileName: 'large.png', mimeType: 'image/png' },
        code: 'IMAGE_TOO_LARGE',
      },
      {
        body: { data: png, fileName: 'image.svg', mimeType: 'image/svg+xml' },
        code: 'INVALID_REQUEST',
      },
      {
        body: { data: png, fileName: 'image.jpg', mimeType: 'image/png' },
        code: 'IMAGE_TYPE_MISMATCH',
      },
      {
        body: {
          data: Buffer.from('not an image').toString('base64'),
          fileName: 'image.png',
          mimeType: 'image/png',
        },
        code: 'IMAGE_INVALID',
      },
    ];
    for (const entry of cases) {
      const response = await request(f.app)
        .post(`/api/orders/catalogue/ingredients/${batchId}/image`)
        .send(entry.body)
        .expect(400);
      expect(response.body.error.code).toBe(entry.code);
    }
  });

  it('rejects cross-Supplier image updates and cross-company logo updates', async () => {
    const otherSupplier = fixture(outsider, true, CompanyRole.SUPPLIER);
    await request(otherSupplier.app)
      .post(`/api/orders/catalogue/ingredients/${batchId}/image`)
      .send({ data: png, fileName: 'ingredient.png', mimeType: 'image/png' })
      .expect(403);
    expect(otherSupplier.store.encryptAndStore).not.toHaveBeenCalled();

    const company = fixture(buyer, true, CompanyRole.MANUFACTURER);
    await request(company.app)
      .post(`/api/orders/branding/${seller}/logo`)
      .send({ data: png, fileName: 'logo.png', mimeType: 'image/png' })
      .expect(403);
    await request(company.app)
      .post(`/api/orders/branding/${buyer}/logo`)
      .send({ data: png, fileName: 'logo.png', mimeType: 'image/png', wallet: seller })
      .expect(400);
    expect(company.store.encryptAndStore).not.toHaveBeenCalled();
  });

  it('returns only whitelisted catalogue media and verified company presentation fields', async () => {
    const f = fixture(seller, true, CompanyRole.SUPPLIER);
    await request(f.app)
      .post(`/api/orders/catalogue/ingredients/${batchId}/image`)
      .send({ data: png, fileName: 'ingredient.png', mimeType: 'image/png' })
      .expect(200);
    await request(f.app)
      .post(`/api/orders/branding/${seller}/logo`)
      .send({ data: png, fileName: 'logo.png', mimeType: 'image/png' })
      .expect(200);
    const events = f.gateway.events.getMockImplementation()!;
    f.gateway.events.mockImplementation(async (contract, name) =>
      name === 'IngredientBatchRegistered'
        ? [{ batchId, supplier: seller, blockNumber: 42 }]
        : events(contract, name),
    );
    const response = await request(f.app).get('/api/orders').expect(200);
    expect(response.body.catalogue[0]).toMatchObject({
      imagePath: `/catalogue/ingredients/${batchId}/image`,
      sellerLogoPath: `/branding/${seller}/logo`,
      sellerName: 'Verified Supplier',
      sellerRole: CompanyRole.SUPPLIER,
    });
    const serialized = JSON.stringify(response.body.catalogue);
    expect(serialized).not.toContain(png);
    expect(serialized).not.toContain('encrypted-cid');
    expect(serialized).not.toContain('ciphertext');
  });
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
            availableQuantity: '200000',
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
    const previous = gateway.read.getMockImplementation()!;
    gateway.read.mockImplementation(async (contract, method) =>
      method === 'getItem'
        ? { seller, kind: 1, unit: encodeBytes32String('litre') }
        : previous(contract, method),
    );
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
