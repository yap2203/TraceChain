// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ShipmentList } from './ShipmentList';

afterEach(cleanup);

const shipment = (index: number) => ({
  shipmentId: `0x${String(index).padStart(64, '0')}`,
  kind: 'ingredient',
  batchId: 'batch',
  itemName: `Item ${index}`,
  senderName: 'Supplier Co',
  recipientName: 'Distributor Co',
  quantity: '12',
  unit: 'g',
  fromLocation: 'from',
  toLocation: 'to',
  vehicle: 'VAB123',
  dispatchedAt: 1_800_000_000 + index,
  expectedAt: 1_800_100_000,
  status: 1,
});

it('pages long shipment lists and opens a shipment by clicking its card', () => {
  const onOpen = vi.fn();
  render(
    <ShipmentList
      shipments={Array.from({ length: 12 }, (_, index) => shipment(index + 1)) as never}
      catalogue={[]}
      locationName={(id) => (id === 'from' ? 'Supplier site' : 'Warehouse A')}
      statusLabel={() => 'In transit'}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText('12 shipments')).toBeTruthy();
  // Newest first, ten per page.
  const cards = document.querySelectorAll('.shipment-card');
  expect(cards).toHaveLength(10);
  expect(within(cards[0] as HTMLElement).getByText('Item 12')).toBeTruthy();
  expect(screen.getByLabelText('Table pagination')).toBeTruthy();
  // Journey reads origin → destination with names, not raw location IDs.
  const journey = within(cards[0] as HTMLElement).getByLabelText('Shipment journey');
  expect(journey.textContent).toContain('Supplier site');
  expect(journey.textContent).toContain('Warehouse A');
  fireEvent.click(within(cards[0] as HTMLElement).getByText('Supplier site'));
  expect(onOpen).toHaveBeenCalledWith(shipment(12).shipmentId);
});

it('counts a received custody shipment as completed', () => {
  render(
    <ShipmentList
      shipments={[shipment(1)] as never}
      catalogue={[]}
      locationName={() => 'Warehouse A'}
      statusLabel={() => 'Received'}
      onOpen={vi.fn()}
    />,
  );
  expect(document.querySelector('.shipment-card.is-completed')).toBeTruthy();
  expect(screen.getByText('No action required')).toBeTruthy();
});
