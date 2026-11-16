import type { ChainRecord, OrdersGateway } from './orders.gateway.js';

const same = (left?: string, right?: string) =>
  !!left && !!right && left.toLowerCase() === right.toLowerCase();

type ProductRecord = ChainRecord & {
  manufacturer?: string;
  totalQuantity?: string;
};

export interface ProductInventorySnapshot {
  available: string;
  initialized: boolean;
  inventory: ChainRecord;
  productionLocation: string;
  tracked: boolean;
}

const positive = (value: unknown) => BigInt(String(value ?? 0)) > 0n;

/**
 * Reads product stock without mutating the chain. A zeroed inventory is considered fresh only when
 * the initialization event query succeeds and no other contract state proves initialization.
 */
export async function readProductInventorySnapshot(
  gateway: OrdersGateway,
  batchId: string,
  holder: string,
  product: ProductRecord,
  knownInitializationEvents?: readonly ChainRecord[],
): Promise<ProductInventorySnapshot> {
  const [inventory, tracked, productionLocation] = await Promise.all([
    gateway.read('custody', 'getInventory', [batchId, holder]),
    gateway.read('custody', 'locationTracked', [batchId, holder]),
    gateway.read('products', 'productionLocation', [batchId]),
  ]);
  const stateProvesInitialization =
    Boolean(tracked) ||
    positive(inventory.available) ||
    positive(inventory.reserved) ||
    positive(inventory.damaged) ||
    positive(inventory.rejected);
  const initializationEvents = stateProvesInitialization
    ? []
    : (knownInitializationEvents ?? (await gateway.events('custody', 'InventoryInitialized')));
  const initialized =
    stateProvesInitialization ||
    initializationEvents.some((event) => same(event.productBatchId ?? event.batchId, batchId));
  const freshManufacturerBatch = !initialized && same(product.manufacturer, holder);

  return {
    available: freshManufacturerBatch
      ? String(product.totalQuantity ?? '0')
      : String(inventory.available ?? '0'),
    initialized,
    inventory,
    productionLocation: String(productionLocation),
    tracked: Boolean(tracked),
  };
}

export async function readProductAvailableAtLocation(
  gateway: OrdersGateway,
  batchId: string,
  holder: string,
  location: string,
  product: ProductRecord,
): Promise<ProductInventorySnapshot> {
  const snapshot = await readProductInventorySnapshot(gateway, batchId, holder, product);
  const available = snapshot.tracked
    ? await gateway.read('custody', 'locationStock', [batchId, holder, location])
    : same(product.manufacturer, holder) && same(snapshot.productionLocation, location)
      ? snapshot.available
      : '0';
  return { ...snapshot, available: String(available) };
}
