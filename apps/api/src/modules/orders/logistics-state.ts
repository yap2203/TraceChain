import { decodeBytes32String } from 'ethers';
import { encodeShipmentQr } from '@tracechain/shared';
import type { OrdersGateway, ChainRecord } from './orders.gateway.js';
import { readProductInventorySnapshot } from './product-inventory.js';
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const unit = (value: string) => {
  try {
    return decodeBytes32String(value);
  } catch {
    return value;
  }
};
export async function readLogistics(
  gateway: OrdersGateway,
  actor: string,
  admin = false,
  reviewSupported = false,
  productDeliverySupported = false,
  positionsOnly = false,
  view: 'workspace' | 'inventory' | 'shipments' = 'workspace',
  inventoryKind?: 'ingredient' | 'product',
) {
  const [warehouseEvents, positionEvents, shipmentEvents, productEvents, inventoryEvents] =
    await Promise.all([
      gateway.events('delivery', 'WarehouseRegistered'),
      view === 'inventory' && inventoryKind === 'product'
        ? []
        : gateway.events('delivery', 'CustodyPositionCreated'),
      positionsOnly || view === 'inventory'
        ? []
        : gateway.events('delivery', 'RoadShipmentDispatched'),
      positionsOnly || (view === 'inventory' && inventoryKind === 'ingredient')
        ? []
        : gateway.events('custody', 'TransferCreated'),
      positionsOnly ||
      view === 'shipments' ||
      (view === 'inventory' && inventoryKind === 'ingredient')
        ? []
        : gateway.events('custody', 'InventoryInitialized'),
    ]);
  const warehouses: ChainRecord[] = await Promise.all(
    warehouseEvents.map(async (entry) => ({
      ...(await gateway.read('delivery', 'warehouses', [entry.location])),
      location: entry.location,
    })),
  );
  const positionRecords = await Promise.all(
    positionEvents.map(async (entry) => {
      const result = await gateway.read('delivery', 'getPosition', [entry.positionId]);
      if (
        (positionsOnly || view === 'inventory') &&
        !admin &&
        !same(result.position.supplier, actor) &&
        !same(result.position.distributor, actor)
      )
        return null;
      return {
        ...result.position,
        positionId: entry.positionId,
        reserved: result.reserved,
        available: result.available,
        unit: unit(result.position.unit),
        orderable:
          !!(await gateway.read('ingredients', 'isValidTraceabilitySource', [
            result.position.batchId,
          ])) &&
          !!(await gateway.read('stakeholders', 'isAuthorized', [result.position.distributor, 4])),
        warehouseName: warehouses.find(
          (warehouse) => warehouse.location === result.position.location,
        )?.name,
      };
    }),
  );
  const positions = positionRecords.filter((position) => position !== null);
  if (positionsOnly)
    return { warehouses, positions, shipments: [], productStock: [], productPositions: [] };
  const shipments: ChainRecord[] = [];
  const qr = (shipmentId: `0x${string}`, kind: 'ingredient' | 'product') => {
    try {
      return encodeShipmentQr({
        shipmentId,
        kind,
        chainId: gateway.chainId,
        ordersAddress: gateway.address,
        publicAppUrl: process.env.VITE_PUBLIC_APP_URL ?? '',
      });
    } catch {
      return undefined;
    }
  };
  for (const event of shipmentEvents) {
    const record = await gateway.read('delivery', 'getRoadShipment', [event.shipmentId]);
    const position = positions.find((entry) => entry.positionId === record.positionId);
    if (
      !admin &&
      !same(record.sender, actor) &&
      !same(record.recipient, actor) &&
      !same(position?.supplier, actor)
    )
      continue;
    shipments.push({
      ...record,
      ...(reviewSupported && Number(record.leg) === 1
        ? {
            custodyDecision: await gateway.read('delivery', 'warehouseDecision', [
              event.shipmentId,
            ]),
            delivery: await gateway.read('delivery', 'get', [event.shipmentId]),
            expiresAt: (await gateway.read('ingredients', 'getBatch', [record.batchId])).expiresAt,
          }
        : {}),
      kind: 'ingredient',
      shipmentId: event.shipmentId,
      unit: unit(record.unit),
      qrPayload: qr(event.shipmentId, 'ingredient'),
      warehouseName: position?.warehouseName,
      supplier: position?.supplier,
    });
  }
  const productBatches = new Set<string>();
  const productPositions: ChainRecord[] = [];
  const seenPositions = new Set<string>();
  const productOwners = new Map<string, string>();
  for (const event of productEvents) {
    const record = await gateway.read('custody', 'getTransfer', [event.transferId]);
    if (
      view === 'inventory' &&
      !admin &&
      !same(record.sender, actor) &&
      !same(record.recipient, actor)
    ) {
      if (inventoryKind !== 'product') continue;
      // The original Manufacturer may follow its stock after a warehouse-to-warehouse move.
      let owner = productOwners.get(record.productBatchId);
      if (!owner) {
        owner = (await gateway.read('products', 'getProduct', [record.productBatchId]))
          .manufacturer;
        productOwners.set(record.productBatchId, owner!);
      }
      if (!same(owner, actor)) continue;
    }
    if (Number(record.status) === 2) {
      const location = await gateway.read('custody', 'receivingLocation', [event.transferId]);
      const warehouse = warehouses.find(
        (entry) => same(entry.location, location) && same(entry.distributor, record.recipient),
      );
      const key = `${record.productBatchId}:${record.recipient}:${location}`.toLowerCase();
      if (warehouse && !seenPositions.has(key)) {
        seenPositions.add(key);
        const available = await gateway.read('custody', 'locationStock', [
          record.productBatchId,
          record.recipient,
          location,
        ]);
        if (BigInt(available) > 0n)
          productPositions.push({
            batchId: record.productBatchId,
            distributor: record.recipient,
            location,
            warehouseName: warehouse.name,
            available,
          });
      }
    }
    if (view === 'inventory') {
      if (same(record.recipient, actor) || same(record.sender, actor))
        productBatches.add(record.productBatchId);
      continue;
    }
    const carrier = productDeliverySupported
      ? await gateway.read('custody', 'productDeliveryCarrier', [event.transferId])
      : undefined;
    if (
      !admin &&
      !same(record.sender, actor) &&
      !same(record.recipient, actor) &&
      !same(carrier, actor)
    )
      continue;
    productBatches.add(record.productBatchId);
    const vehicle = await gateway.read('custody', 'vehicleRegistration', [event.transferId]);
    shipments.push({
      ...record,
      kind: 'product',
      carrier,
      shipmentId: event.transferId,
      batchId: record.productBatchId,
      received: record.usable,
      fromLocation: await gateway.read('custody', 'dispatchLocation', [event.transferId]),
      toLocation: await gateway.read('custody', 'receivingLocation', [event.transferId]),
      vehicle,
      confirmedBy: await gateway.read('custody', 'dispatchConfirmedBy', [event.transferId]),
      recordedAt: record.dispatchedAt,
      dispatchedAt: await gateway.read('custody', 'reportedDispatchAt', [event.transferId]),
      legacy: !vehicle,
      qrPayload: vehicle ? qr(event.transferId, 'product') : undefined,
    });
  }
  if (view === 'shipments' || (view === 'inventory' && inventoryKind === 'ingredient'))
    return { warehouses, positions, shipments, productStock: [], productPositions };
  const products = view === 'inventory' ? [] : await gateway.events('products', 'ProductCreated');
  products
    .filter((entry) => same(entry.manufacturer, actor))
    .forEach((entry) => productBatches.add(entry.batchId ?? entry.productBatchId));
  const productStock = await Promise.all(
    [...productBatches].map(async (batchId) => {
      const batch = await gateway.read('products', 'getProduct', [batchId]);
      const inventory = await readProductInventorySnapshot(
        gateway,
        batchId,
        actor,
        batch,
        inventoryEvents,
      );
      const locationIds = [
        ...new Set([
          ...productPositions
            .filter((p) => same(p.batchId, batchId) && same(p.distributor, actor))
            .map((p) => p.location),
          ...shipments
            .filter((entry) => entry.kind === 'product' && entry.batchId === batchId)
            .map((entry) => (same(entry.recipient, actor) ? entry.toLocation : entry.fromLocation)),
        ]),
      ];
      return {
        batchId,
        productionLocation: inventory.productionLocation,
        producedAt: batch.producedAt,
        unit: unit(batch.unit),
        available: inventory.available,
        initialized: inventory.initialized,
        reserved: inventory.inventory.reserved,
        quantity: inventory.available,
        tracked: inventory.tracked,
        locations: await Promise.all(
          locationIds.map(async (location) => ({
            location,
            available: await gateway.read('custody', 'locationStock', [batchId, actor, location]),
          })),
        ),
      };
    }),
  );
  return { warehouses, positions, shipments, productStock, productPositions };
}
