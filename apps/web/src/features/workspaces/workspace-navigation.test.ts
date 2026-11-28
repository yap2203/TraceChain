import { expect, it } from 'vitest';
import { workspaceNavigationGroups, workspaceSection } from './workspace-navigation';

it('shows Distributor warehouse arrivals as the first tab of Deliveries', () => {
  const deliveries = workspaceSection('distributor', 'arrivals');
  expect(deliveries?.label).toBe('Deliveries');
  expect(deliveries?.pages.map(([id]) => id)).toEqual([
    'arrivals',
    'shipments',
    'product-shipments',
  ]);
  // One sidebar entry for all three pages, linking to the first.
  const logistics = workspaceNavigationGroups('distributor').find(
    (group) => group.label === 'Logistics',
  );
  const ids = logistics!.items.map(([id]) => id);
  expect(ids).toContain('arrivals');
  expect(ids).not.toContain('shipments');
  expect(ids).not.toContain('product-shipments');
});

// Old standalone transfer URLs use the retained order-based Product deliveries screen.
it('routes legacy Distributor transfer links to Product deliveries', async () => {
  const { workspacePage } = await import('./workspace-paths');
  expect(workspacePage('distributor', 'transfers')).toBe('product-shipments');
});

it('names the actual counterparties while preserving existing destination IDs', () => {
  expect(workspaceSection('manufacturer', 'orders')?.pages).toEqual([
    ['orders', 'Ingredient requests to Suppliers'],
    ['product-orders', 'Product requests from Retailers'],
  ]);
  expect(workspaceSection('manufacturer', 'product-shipments')?.pages).toEqual([
    ['shipments', 'Ingredients arriving'],
    ['product-shipments', 'Products leaving'],
  ]);
  expect(workspaceSection('distributor', 'arrivals')?.pages).toEqual([
    ['arrivals', 'Arriving at warehouses'],
    ['shipments', 'Ingredients to Manufacturers'],
    ['product-shipments', 'Products to Retailers'],
  ]);
  expect(workspaceSection('retailer', 'shipments')?.pages).toEqual([
    ['shipments', 'Products arriving'],
    ['history', 'Products received'],
  ]);
});
