import { describe, expect, it, vi } from 'vitest';
import { encodeBytes32String, id } from 'ethers';
import { readLogistics } from './logistics-state.js';
import type { OrdersGateway } from './orders.gateway.js';
const supplier = '0x1000000000000000000000000000000000000001',
  distributor = '0x2000000000000000000000000000000000000002',
  manufacturer = '0x3000000000000000000000000000000000000003';
const batchId = id('ingredient'),
  location = id('warehouse'),
  positionId = id('position');
function gateway() {
  return {
    chainId: 31337,
    address: supplier,
    prepare: vi.fn(),
    events: vi.fn(
      async (_contract: string, event: string) =>
        ({
          WarehouseRegistered: [{ location }],
          CustodyPositionCreated: [{ positionId }],
          RoadShipmentDispatched: [
            { shipmentId: id('first-leg') },
            { shipmentId: id('second-leg') },
          ],
          TransferCreated: [],
          ProductCreated: [],
        })[event] ?? [],
    ),
    read: vi.fn(async (_contract: string, method: string, args: unknown[] = []) => {
      if (method === 'warehouses') return { distributor, name: 'Actual warehouse' };
      if (method === 'getPosition')
        return {
          position: {
            batchId,
            supplier,
            distributor,
            location,
            unit: encodeBytes32String('litre'),
            quantity: '70',
          },
          reserved: '30',
          available: '40',
        };
      if (method === 'isAuthorized' || method === 'isValidTraceabilitySource') return true;
      if (method === 'getRoadShipment')
        return {
          batchId,
          positionId,
          shipmentId: args[0],
          sender: args[0] === id('first-leg') ? supplier : distributor,
          recipient: args[0] === id('first-leg') ? distributor : manufacturer,
          quantity: '100',
          received: args[0] === id('first-leg') ? '70' : '0',
          unit: encodeBytes32String('litre'),
          status: '2',
          vehicle: 'VAB 1234',
        };
      throw new Error(`Unexpected ${method}`);
    }),
  } satisfies OrdersGateway;
}
describe('on-chain warehouse views', () => {
  it.each([
    { initialized: false, expectedAvailable: '123' },
    { initialized: true, expectedAvailable: '0' },
  ])(
    'reports $expectedAvailable available for a zeroed Manufacturer inventory when initialized=$initialized',
    async ({ initialized, expectedAvailable }) => {
      const f = gateway(),
        events = f.events.getMockImplementation()!,
        read = f.read.getMockImplementation()!;
      const product = id('fresh-product');
      f.events.mockImplementation(async (contract, event) => {
        if (event === 'ProductCreated') return [{ batchId: product, manufacturer }];
        if (event === 'InventoryInitialized')
          return initialized ? [{ productBatchId: product, manufacturer, quantity: '123' }] : [];
        return events(contract, event);
      });
      f.read.mockImplementation(async (contract, method, args) => {
        if (method === 'getProduct')
          return {
            manufacturer,
            producedAt: 1_800_000_000,
            totalQuantity: '123',
            unit: encodeBytes32String('units'),
          };
        if (method === 'getInventory')
          return { available: '0', reserved: '0', damaged: '0', rejected: '0' };
        if (method === 'locationTracked') return false;
        if (method === 'productionLocation') return location;
        return read(contract, method, args);
      });

      expect((await readLogistics(f, manufacturer)).productStock[0]).toMatchObject({
        available: expectedAvailable,
        initialized,
        productionLocation: location,
        quantity: expectedAvailable,
        tracked: false,
      });
    },
  );

  it('keeps reserved/in-transit products out of available physical warehouse quantity', async () => {
    const f = gateway(),
      events = f.events.getMockImplementation()!,
      read = f.read.getMockImplementation()!;
    const product = id('product');
    f.events.mockImplementation(async (contract, event) =>
      event === 'TransferCreated'
        ? [{ transferId: id('product-transfer'), productBatchId: product }]
        : events(contract, event),
    );
    f.read.mockImplementation(async (contract, method, args) => {
      if (method === 'getTransfer')
        return {
          productBatchId: product,
          sender: distributor,
          recipient: manufacturer,
          status: 1,
          quantity: '20',
          usable: '0',
        };
      if (method === 'getProduct')
        return { manufacturer: supplier, unit: encodeBytes32String('each'), totalQuantity: '100' };
      if (method === 'getInventory') return { available: '50', reserved: '20' };
      if (method === 'locationTracked') return true;
      if (method === 'locationStock') return '50';
      if (['dispatchLocation', 'receivingLocation', 'productionLocation'].includes(method))
        return location;
      if (method === 'vehicleRegistration') return 'VAB 1234';
      if (method === 'dispatchConfirmedBy') return distributor;
      if (method === 'reportedDispatchAt') return '1000';
      return read(contract, method, args);
    });
    expect((await readLogistics(f, distributor)).productStock[0]).toMatchObject({
      quantity: '50',
      available: '50',
      reserved: '20',
    });
  });
  it('keeps original units and separates physical, reserved and orderable stock', async () => {
    const state = await readLogistics(gateway(), manufacturer);
    expect(state.positions[0]).toMatchObject({
      quantity: '70',
      reserved: '30',
      available: '40',
      unit: 'litre',
      warehouseName: 'Actual warehouse',
      supplier,
    });
  });
  it('restricts shipment details to participants, while exposing only public custody availability to buyers', async () => {
    expect(
      (await readLogistics(gateway(), manufacturer)).shipments.map((entry) => entry.shipmentId),
    ).toEqual([id('second-leg')]);
    expect((await readLogistics(gateway(), supplier)).shipments).toHaveLength(2);
    expect(
      (await readLogistics(gateway(), '0x4000000000000000000000000000000000000004')).shipments,
    ).toHaveLength(0);
  });
  it('disables ordering when the Distributor is no longer authorized', async () => {
    const f = gateway(),
      previous = f.read.getMockImplementation()!;
    f.read.mockImplementation((contract, method, args) =>
      method === 'isAuthorized' ? Promise.resolve(false) : previous(contract, method, args),
    );
    expect((await readLogistics(f, manufacturer)).positions[0].orderable).toBe(false);
  });
});
