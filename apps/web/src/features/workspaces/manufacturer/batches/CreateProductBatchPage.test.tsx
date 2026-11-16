// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  ingredients: vi.fn(),
  orders: vi.fn(),
  prepare: vi.fn(),
  complete: vi.fn(),
}));
vi.mock('../../../production-flow/production-flow.api', () => ({
  listProductionIngredients: mocks.ingredients,
  prepareProduct: mocks.prepare,
}));
vi.mock('../../../production-flow/production-flow.transaction', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../production-flow/production-flow.transaction')
  >()),
  completePreparedWorkflow: mocks.complete,
}));
vi.mock('../../../orders/orders.api', () => ({ getOrders: mocks.orders }));
vi.mock('../../../product-traceability', () => ({ ProductQrDisplay: () => <div>Product QR</div> }));
import { CreateProductBatch } from './CreateProductBatchPage';
import { WorkflowRefreshPendingError } from '../../../production-flow/production-flow.transaction';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.orders.mockResolvedValue({
    actor: 'maker',
    locations: [{ company: 'maker', location: 'factory', label: 'Factory' }],
    catalogue: [
      { name: 'Cocoa', batches: ['cocoa'] },
      { name: 'Milk', batches: ['milk'] },
    ],
  });
  mocks.ingredients.mockResolvedValue({
    batches: [
      {
        accepted: false,
        batchId: 'cocoa',
        availableQuantity: '5000',
        unit: 'g',
        supplier: 'supplier',
        supplierName: 'Supplier',
      },
      {
        accepted: false,
        batchId: 'milk',
        availableQuantity: '3000',
        unit: 'ml',
        supplier: 'supplier',
        supplierName: 'Supplier',
      },
    ],
  });
  mocks.prepare.mockResolvedValue({ batchId: 'product', state: 'COMPLETE' });
  mocks.complete.mockImplementation((prepare: () => Promise<unknown>) => prepare());
});
afterEach(cleanup);
describe('multi-ingredient production', () => {
  const setup = async () => {
    render(<CreateProductBatch onBack={vi.fn()} />);
    await screen.findByRole('option', { name: 'Factory' });
    fireEvent.change(screen.getByLabelText('Production stock location'), {
      target: { value: 'factory' },
    });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    fireEvent.click(screen.getByLabelText('Select Cocoa'));
    fireEvent.change(screen.getByLabelText('Ingredient unit for Cocoa'), {
      target: { value: 'kg' },
    });
    fireEvent.change(screen.getByLabelText('Quantity to use for Cocoa'), {
      target: { value: '1.25' },
    });
  };
  it('previews independent remaining balances and submits multiple exact quantities in registered units', async () => {
    await setup();
    expect(screen.getByText('Remaining after production: 3750 g')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select Milk'));
    fireEvent.change(screen.getByLabelText('Ingredient unit for Milk'), {
      target: { value: 'litre' },
    });
    fireEvent.change(screen.getByLabelText('Quantity to use for Milk'), {
      target: { value: '0.5' },
    });
    expect(screen.getByText('Remaining after production: 2500 ml')).toBeTruthy();
    for (const [label, value] of [
      ['Product name', 'Chocolate'],
      ['Product batch reference', 'CHOC-1'],
      ['Category', 'Food'],
      ['Quantity produced', '50'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
    expect(mocks.ingredients).toHaveBeenCalledWith('factory', 'production');
    fireEvent.click(screen.getByRole('button', { name: 'Create product with MetaMask' }));
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          productionLocation: 'factory',
          unit: 'each',
          ingredientLinks: [
            { batchId: 'cocoa', quantity: '1250' },
            { batchId: 'milk', quantity: '500' },
          ],
        }),
      ),
    );
    await screen.findByText('Remaining ingredient stock');
  });
  it('blocks overspending and clears selections when the production location changes', async () => {
    await setup();
    fireEvent.change(screen.getByLabelText('Quantity to use for Cocoa'), {
      target: { value: '6' },
    });
    expect(screen.getByText('Amount exceeds received stock at this location.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Create product with MetaMask' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(mocks.prepare).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Production stock location'), { target: { value: '' } });
    await waitFor(() => expect(screen.queryByLabelText('Quantity to use for Cocoa')).toBeNull());
  });
  it('allows an exact decimal-unit balance and reports zero remaining stock', async () => {
    await setup();
    fireEvent.change(screen.getByLabelText('Quantity to use for Cocoa'), {
      target: { value: '5' },
    });
    expect(screen.getByText('Remaining after production: 0 g')).toBeTruthy();
    for (const [label, value] of [
      ['Product name', 'Exact Chocolate'],
      ['Product batch reference', 'CHOC-EXACT'],
      ['Category', 'Food'],
      ['Quantity produced', '4'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });

    const create = screen.getByRole('button', { name: 'Create product with MetaMask' });
    expect(create.hasAttribute('disabled')).toBe(false);
    mocks.ingredients.mockResolvedValueOnce({ batches: [] });
    fireEvent.click(create);
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredientLinks: [{ batchId: 'cocoa', quantity: '5000' }],
        }),
      ),
    );
    expect(await screen.findByText('Cocoa: 0 g')).toBeTruthy();
  });
  it('keeps a confirmed product pending refresh and never offers duplicate creation', async () => {
    await setup();
    fireEvent.change(screen.getByLabelText('Quantity to use for Cocoa'), {
      target: { value: '5' },
    });
    for (const [label, value] of [
      ['Product name', 'Exact Chocolate'],
      ['Product batch reference', 'CHOC-PENDING'],
      ['Category', 'Food'],
      ['Quantity produced', '4'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
    mocks.complete.mockRejectedValueOnce(
      new WorkflowRefreshPendingError({ batchId: 'confirmed-product' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create product with MetaMask' }));
    expect(
      await screen.findByText(/product transaction was confirmed.*do not submit/i),
    ).toBeTruthy();
    expect(screen.queryByText(/does not have enough/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create product with MetaMask' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh records' })).toBeTruthy();

    mocks.ingredients.mockResolvedValueOnce({ batches: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
    expect(await screen.findByText('Cocoa: 0 g')).toBeTruthy();
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });
});
