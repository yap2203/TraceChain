// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ShipmentList } from './ShipmentList';
import { shipmentStatusVariant } from '../workspaces/shared/shipment-status';

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

it('lists arranged pickups as "Waiting for pickup" and filters them', () => {
  const pickup = { ...shipment(2), status: undefined, vehicle: '', pickupOfferId: 'offer' };
  render(
    <ShipmentList
      shipments={[pickup, shipment(1)] as never}
      catalogue={[]}
      locationName={() => 'Warehouse A'}
      statusLabel={(entry) => (entry.pickupOfferId ? 'Waiting for pickup' : 'In transit')}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText('2 shipments')).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: /Waiting for pickup/ })[0]!);
  expect(screen.getByText('1 shipment')).toBeTruthy();
  expect(screen.getByText('Item 2')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'View details' })).toBeTruthy();
  expect(screen.getByText(/prints the label and confirms the handoff/)).toBeTruthy();
});

it('colours shipment statuses by the shared meaning of each colour', () => {
  const colour = (label: string) => shipmentStatusVariant(label);
  // amber waiting / needs action
  expect(colour('Awaiting Distributor review')).toBe('pending');
  expect(colour('Waiting for pickup')).toBe('pending');
  // purple moving
  expect(colour('In transit')).toBe('moving');
  expect(colour('Dispatched')).toBe('moving');
  expect(colour('Sent to manufacturer')).toBe('moving');
  // teal ready to check
  expect(colour('Awaiting receipt')).toBe('shared');
  expect(colour('Awaiting Receipt')).toBe('shared');
  // green done, red failed, grey void
  expect(colour('Received')).toBe('verified');
  expect(colour('Received by manufacturer')).toBe('verified');
  expect(colour('Rejected — return pending')).toBe('rejected');
  expect(colour('Discrepancy')).toBe('rejected');
  expect(colour('Cancelled')).toBe('expired');
});
