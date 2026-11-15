// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogueBrowser } from './CatalogueBrowser';
afterEach(cleanup);
describe('Manufacturer requests with Supplier-selected fulfilment', () => {
  it('requires a receiving location without forcing the buyer to choose warehouse stock', () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const item = {
      itemId: 'item',
      batches: ['batch'],
      name: 'Actual flour',
      kind: 1,
      seller: 'supplier',
      sellerName: 'Supplier Company',
      active: true,
      unit: 'kg',
      batchDetails: [{ batchId: 'batch', supplierAvailable: '1000' }],
      custodyPositions: [
        {
          positionId: 'position',
          batchId: 'batch',
          warehouseName: 'Warehouse A',
          quantity: '50',
          reserved: '30',
          available: '20',
          orderable: true,
        },
      ],
    };
    render(
      <CatalogueBrowser
        actor="manufacturer"
        role="manufacturer"
        items={[item]}
        busy={false}
        onQuantityRequest={request}
        onEvidenceRequest={vi.fn()}
        onOpenEvidence={vi.fn()}
        locations={[{ location: 'factory', label: 'My factory' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Request quantity' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Requested quantity/), {
      target: { value: '21' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Response deadline/), {
      target: { value: '2099-01-01T12:00' },
    });
    const submit = within(dialog).getByRole('button', {
      name: 'Submit request',
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(within(dialog).queryByLabelText(/Distributor warehouse/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Your receiving location/), {
      target: { value: 'factory' },
    });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(request).toHaveBeenCalledWith(
      item,
      expect.objectContaining({
        location: 'factory',
        quantity: '21',
      }),
    );
    expect(request.mock.calls[0][1]).not.toHaveProperty('positionId');
  });
});
