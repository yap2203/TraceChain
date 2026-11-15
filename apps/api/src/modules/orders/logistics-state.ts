import { decodeBytes32String } from 'ethers';
import { encodeShipmentQr } from '@tracechain/shared';
import type { OrdersGateway, ChainRecord } from './orders.gateway.js';
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
) {
  const [warehouseEvents, positionEvents, shipmentEvents, productEvents] = await Promise.all([
    gateway.events('delivery', 'WarehouseRegistered'),
    gateway.events('delivery', 'CustodyPositionCreated'),
    gateway.events('delivery', 'RoadShipmentDispatched'),
    gateway.events('custody', 'TransferCreated'),
  ]);
  const warehouses: ChainRecord[] = await Promise.all(
    warehouseEvents.map(async (entry) => ({
      ...(await gateway.read('delivery', 'warehouses', [entry.location])),
      location: entry.location,
    })),
  );
  const positions = await Promise.all(
    positionEvents.map(async (entry) => {
      const result = await gateway.read('delivery', 'getPosition', [entry.positionId]);
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
  for (const event of productEvents) {
    const record = await gateway.read('custody', 'getTransfer', [event.transferId]);
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
  const products = await gateway.events('products', 'ProductCreated');
  products
    .filter((entry) => same(entry.manufacturer, actor))
    .forEach((entry) => productBatches.add(entry.batchId ?? entry.productBatchId));
  const productStock = await Promise.all(
    [...productBatches].map(async (batchId) => {
      const batch = await gateway.read('products', 'getProduct', [batchId]),
        stock = await gateway.read('custody', 'getInventory', [batchId, actor]);
      const tracked = await gateway.read('custody', 'locationTracked', [batchId, actor]);
      const available =
        !tracked &&
        !productEvents.some((event) => (event.productBatchId ?? event.batchId) === batchId) &&
        same(batch.manufacturer, actor)
          ? batch.totalQuantity
          : stock.available;
      const locationIds = [
        ...new Set(
          shipments
            .filter((entry) => entry.kind === 'product' && entry.batchId === batchId)
            .map((entry) => (same(entry.recipient, actor) ? entry.toLocation : entry.fromLocation)),
        ),
      ];
      return {
        batchId,
        productionLocation: await gateway.read('products', 'productionLocation', [batchId]),
        producedAt: batch.producedAt,
        unit: unit(batch.unit),
        available,
        reserved: stock.reserved,
        quantity: available,
        tracked,
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
