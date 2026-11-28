// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  ingredients: vi.fn(),
  orders: vi.fn(),
  prepare: vi.fn(),
  complete: vi.fn(),
  imagePayload: vi.fn(),
  uploadImage: vi.fn(),
  back: vi.fn(),
  view: vi.fn(),
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
vi.mock('../../../orders/orders.api', () => ({
  getOrders: mocks.orders,
  imageFilePayload: mocks.imagePayload,
  uploadProductCatalogueImage: mocks.uploadImage,
}));
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
  mocks.imagePayload.mockResolvedValue({
    data: 'safe-image',
    fileName: 'product.png',
    mimeType: 'image/png',
  });
  mocks.uploadImage.mockResolvedValue({ image: { path: '/catalogue/products/product/image' } });
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:product-preview'),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('multi-ingredient production', () => {
  it('shows only the current step and validates a forward header jump with focus', async () => {
    render(<CreateProductBatch onBack={mocks.back} onViewProduct={mocks.view} />);
    expect(screen.getByRole('heading', { name: '1. Product details' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '2. Product presentation' })).toBeNull();
    const review = screen.getByRole('button', { name: /Review and create/ });
    expect(review.getAttribute('type')).toBe('button');
    fireEvent.click(review);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/^Product name/)),
    );
    expect(screen.queryByRole('button', { name: 'Create product batch' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: '1. Product details' })).toBeTruthy();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  const setup = async () => {
    render(<CreateProductBatch onBack={mocks.back} onViewProduct={mocks.view} />);
    for (const [label, value] of [
      ['Product name', 'Chocolate'],
      ['Product batch reference', 'CHOC-1'],
      ['Quantity produced', '50'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('option', { name: 'Factory' });
    fireEvent.change(screen.getByLabelText('Production stock location'), {
      target: { value: 'factory' },
    });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
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
      ['Product category', 'Food'],
      ['Quantity produced', '50'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
    expect(mocks.ingredients).toHaveBeenCalledWith('factory', 'production');
    fireEvent.click(screen.getByRole('button', { name: /Review and create/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create product batch' }));
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
    expect(screen.getAllByRole('heading', { name: 'Product batch created' })).toHaveLength(1);
    expect(screen.getByText('Product summary')).toBeTruthy();
    expect(screen.getByText('CHOC-1')).toBeTruthy();
    expect(screen.getByText('Factory')).toBeTruthy();
    expect(screen.getByText('50 each')).toBeTruthy();
    expect(screen.queryByText(/Production occurred:/)).toBeNull();
    expect(screen.getByText('Technical details').closest('details')?.open).toBe(false);
    expect(screen.getByRole('button', { name: 'View product' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to products' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View product' }));
    expect(mocks.view).toHaveBeenCalledWith('product');
    expect(mocks.back).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to products' }));
    expect(mocks.back).toHaveBeenCalledOnce();
    expect(mocks.view).toHaveBeenCalledTimes(1);
  });
  it('reopens and focuses an invalid earlier field on final validation without signing', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: /Review and create/ }));
    fireEvent.change(screen.getByLabelText(/^Product name/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create product batch' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText(/^Product name/)),
    );
    expect(screen.getByRole('heading', { name: '1. Product details' })).toBeTruthy();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('blocks overspending and clears selections when the production location changes', async () => {
    await setup();
    fireEvent.change(screen.getByLabelText('Quantity to use for Cocoa'), {
      target: { value: '6' },
    });
    expect(screen.getByText('Amount exceeds received stock at this location.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.queryByRole('button', { name: 'Create product batch' })).toBeNull();
    expect(mocks.prepare).not.toHaveBeenCalled();
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
      ['Product category', 'Food'],
      ['Quantity produced', '4'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });

    fireEvent.click(screen.getByRole('button', { name: /Review and create/ }));
    const create = screen.getByRole('button', { name: 'Create product batch' });
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
    expect(await screen.findByText('0 g')).toBeTruthy();
    expect(screen.getByText('Cocoa', { selector: '.product-success__stock dt' })).toBeTruthy();
  });
  it('keeps a confirmed product pending refresh and never offers duplicate creation', async () => {
    await setup();
    fireEvent.change(screen.getByLabelText('Quantity to use for Cocoa'), {
      target: { value: '5' },
    });
    for (const [label, value] of [
      ['Product name', 'Exact Chocolate'],
      ['Product batch reference', 'CHOC-PENDING'],
      ['Product category', 'Food'],
      ['Quantity produced', '4'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
    mocks.complete.mockRejectedValueOnce(
      new WorkflowRefreshPendingError({ batchId: 'confirmed-product' }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Review and create/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create product batch' }));
    expect(
      await screen.findByText(/product transaction was confirmed.*do not submit/i),
    ).toBeTruthy();
    expect(screen.queryByText(/does not have enough/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create product batch' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh records' })).toBeTruthy();

    mocks.ingredients.mockResolvedValueOnce({ batches: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
    expect(await screen.findByText('0 g')).toBeTruthy();
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it('reviews and saves optional presentation metadata and the selected product image', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: /Product presentation/ }));
    for (const [label, value] of [
      ['Product name', 'Presented Chocolate'],
      ['Product batch reference', 'CHOC-PRESENTED'],
      ['Product category', 'Confectionery'],
      ['Country of manufacture', 'Malaysia'],
      ['Product description', 'A finished cocoa product for the catalogue.'],
      ['Quantity produced', '20'],
      ['Indicative price', '12'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });

    const first = new File(['first'], 'first.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Product image'), { target: { files: [first] } });
    expect(screen.getByAltText('Product image preview').getAttribute('src')).toBe(
      'blob:product-preview',
    );
    expect(screen.getAllByText('first.png')).toHaveLength(2);

    const replacement = new File(['replacement'], 'replacement.webp', { type: 'image/webp' });
    fireEvent.change(screen.getByLabelText('Product image'), {
      target: { files: [replacement] },
    });
    expect(screen.getAllByText('replacement.webp')).toHaveLength(2);
    expect(screen.queryByText('first.png')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Review and create/ }));
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: '2. Product presentation' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit ingredients' }));
    expect(screen.getByLabelText('Step 2 complete')).toBeTruthy();
    expect((screen.getByLabelText('Quantity to use for Cocoa') as HTMLInputElement).value).toBe(
      '1.25',
    );
    fireEvent.click(screen.getByRole('button', { name: /Review and create/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit presentation' }));
    expect(screen.getByRole('button', { name: 'Next' }).getAttribute('type')).toBe('button');
    expect(
      screen.getByText('replacement.webp', {
        selector: '[data-product-step="1"] .ingredient-photo-review__filename',
      }),
    ).toBeTruthy();
    expect((screen.getByLabelText('Production stock location') as HTMLSelectElement).value).toBe(
      'factory',
    );
    fireEvent.click(screen.getByRole('button', { name: /Review and create/ }));
    expect(screen.getByText('MYR 12.00 / each')).toBeTruthy();
    expect(screen.getAllByText('Factory').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Create product batch' }));
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'Confectionery',
          origin: 'Malaysia',
          description: 'A finished cocoa product for the catalogue.',
          price: '12',
          currency: 'MYR',
          productionLocation: 'factory',
          productionLocationName: 'Factory',
        }),
      ),
    );
    expect(mocks.imagePayload).toHaveBeenCalledWith(replacement);
    expect(mocks.uploadImage).toHaveBeenCalledWith('product', expect.any(Object));
  });

  it('allows no optional presentation and supports removing or rejecting an image', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: /Product presentation/ }));
    const unsupported = new File(['svg'], 'product.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByLabelText('Product image'), {
      target: { files: [unsupported] },
    });
    expect(screen.getByText('Choose a PNG, JPEG or WebP image.')).toBeTruthy();

    const selected = new File(['image'], 'product.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Product image'), { target: { files: [selected] } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.getAllByText('No image selected').length).toBeGreaterThan(0);

    for (const [label, value] of [
      ['Product name', 'Plain Chocolate'],
      ['Product batch reference', 'CHOC-PLAIN'],
      ['Quantity produced', '20'],
      ['Production date', '2026-01-01'],
      ['Expiry date', '2099-01-01'],
    ])
      fireEvent.change(screen.getByLabelText(new RegExp('^' + label)), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: /Review and create/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create product batch' }));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalled());
    expect(mocks.uploadImage).not.toHaveBeenCalled();
  });
});
