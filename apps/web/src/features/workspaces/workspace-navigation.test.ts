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
