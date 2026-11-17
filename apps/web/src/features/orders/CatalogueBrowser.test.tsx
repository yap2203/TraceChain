// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogueBrowser } from './CatalogueBrowser';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Retailer product catalogue data', () => {
  it('shows orderable inventory, recorded origin and current linked-credential status', () => {
    render(
      <CatalogueBrowser
        actor="retailer"
        role="retailer"
        items={[
          {
            itemId: 'product-item',
            batches: ['product-batch'],
            name: 'Dark chocolate bar',
            kind: 2,
            seller: 'manufacturer',
            sellerName: 'Actual Manufacturer',
            active: true,
            countryOfOrigin: 'Malaysia',
            credentialStatus: 1,
            credentialLabel: 'Linked credentials active',
            unit: 'each',
            batchDetails: [{ batchId: 'product-batch', manufacturerAvailable: '42' }],
          },
        ]}
        busy={false}
        onQuantityRequest={vi.fn()}
        onEvidenceRequest={vi.fn()}
        onOpenEvidence={vi.fn()}
        locations={[]}
      />,
    );

    const card = screen.getByText('Dark chocolate bar').closest('.catalogue-card') as HTMLElement;
    expect(within(card).getByText('Malaysia')).toBeTruthy();
    expect(within(card).getByText('42 each')).toBeTruthy();
    expect(within(card).getByText('Linked credentials active')).toBeTruthy();
    expect(card.textContent).not.toContain('Not published');
  });
});
const manufacturerPresentation = {
  hideIntro: true,
  resultNoun: { singular: 'ingredient', plural: 'ingredients' },
  ingredientStockLabels: { supplier: 'At supplier', distributor: 'At distributor' },
};
describe('Manufacturer requests with Supplier-selected fulfilment', () => {
  it('uses a compact, action-first request modal with a portrait image and long values', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    window.dispatchEvent(new Event('resize'));
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:portrait-ingredient'),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(new Blob(['portrait'], { type: 'image/webp' }), { status: 200 }),
        ),
    );
    const item = {
      itemId: 'portrait-item',
      batches: ['batch'],
      name: 'Single Origin Fermented Cocoa Powder With A Long Ingredient Name',
      kind: 1,
      seller: 'supplier',
      sellerName: 'Highland Sustainable Ingredients Cooperative With A Long Name',
      sellerRole: 'SUPPLIER',
      sellerLogoPath: undefined,
      imagePath: '/catalogue/portrait-item/image',
      active: true,
      credentialStatus: 1,
      evidenceAvailability:
        'Active credential with Supplier-provided evidence available through the existing request workflow',
      category: 'Cocoa and chocolate ingredients',
      countryOfOrigin: 'Malaysia',
      batchReference: 'COCOA-PORTRAIT-2026-LONG-REFERENCE',
      price: '50.00',
      currency: 'MYR',
      unit: 'kg',
      batchDetails: [
        {
          batchId: 'batch',
          supplierAvailable: '100',
          totalQuantity: '125',
          producedAt: '2000000000',
          expiresAt: '2100000000',
        },
      ],
      custodyPositions: [],
    };
    render(
      <CatalogueBrowser
        actor="manufacturer"
        role="manufacturer"
        items={[item]}
        busy={false}
        onQuantityRequest={vi.fn()}
        onEvidenceRequest={vi.fn()}
        onOpenEvidence={vi.fn()}
        locations={[{ location: 'factory', label: 'My factory' }]}
        presentation={manufacturerPresentation}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Request quantity' }));
    const dialog = screen.getByRole('dialog');
    const photo = await within(dialog).findByAltText(`Supplier-provided image of ${item.name}`);
    expect(photo.classList.contains('catalogue-image--large')).toBe(true);
    expect(within(dialog).getByText(item.sellerName)).toBeTruthy();
    expect(within(dialog).getByText('MYR 50.00 / kg')).toBeTruthy();
    const stock = dialog.querySelector('.catalogue-stock-section') as HTMLElement;
    expect(within(stock).getByText('At supplier').nextElementSibling?.textContent).toBe('100 kg');
    expect(within(stock).getByText('At distributor').nextElementSibling?.textContent).toBe(
      'No stock',
    );
    expect(within(stock).getAllByText('No stock')).toHaveLength(1);
    const quantity = within(dialog).getByLabelText(/Requested quantity \(kg\)/);
    const batchDetails = within(dialog).getByRole('heading', { name: 'Batch details' });
    expect(
      quantity.compareDocumentPosition(batchDetails) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(dialog).getByText(item.batchReference)).toBeTruthy();
    expect(within(dialog).getByText(item.evidenceAvailability)).toBeTruthy();
  });

  it('keeps Supplier, Distributor and unavailable stock balances separate', () => {
    const items = [
      {
        itemId: 'without-custody',
        batches: ['batch-a'],
        name: 'Cocoa powder',
        kind: 1,
        seller: 'supplier',
        active: true,
        unit: 'kg',
        batchDetails: [{ batchId: 'batch-a', supplierAvailable: '100' }],
        custodyPositions: [],
      },
      {
        itemId: 'with-custody',
        batches: ['batch-b'],
        name: 'Rice flour',
        kind: 1,
        seller: 'supplier',
        active: true,
        unit: 'kg',
        batchDetails: [{ batchId: 'batch-b', supplierAvailable: '75' }],
        custodyPositions: [
          { batchId: 'batch-b', available: '12', orderable: true },
          { batchId: 'batch-b', available: '8', orderable: true },
        ],
      },
      {
        itemId: 'stock-unavailable',
        batches: ['batch-c'],
        name: 'Unknown stock ingredient',
        kind: 1,
        seller: 'supplier',
        active: true,
        unit: 'kg',
        batchDetails: [{ batchId: 'batch-c' }],
      },
    ];
    const { container } = render(
      <CatalogueBrowser
        actor="manufacturer"
        role="manufacturer"
        items={items}
        busy={false}
        onQuantityRequest={vi.fn()}
        onEvidenceRequest={vi.fn()}
        onOpenEvidence={vi.fn()}
        presentation={manufacturerPresentation}
      />,
    );

    expect(screen.getByText('3 ingredients')).toBeTruthy();
    const noCustody = screen.getByText('Cocoa powder').closest('.catalogue-card') as HTMLElement;
    expect(within(noCustody).getByText('At supplier').nextElementSibling?.textContent).toBe(
      '100 kg',
    );
    expect(within(noCustody).getByText('At distributor').nextElementSibling?.textContent).toBe(
      'No stock',
    );
    const positiveCustody = screen
      .getByText('Rice flour')
      .closest('.catalogue-card') as HTMLElement;
    expect(
      within(positiveCustody).getByText('At distributor').nextElementSibling?.textContent,
    ).toBe('20 kg');
    const unavailable = screen
      .getByText('Unknown stock ingredient')
      .closest('.catalogue-card') as HTMLElement;
    expect(within(unavailable).getAllByText('Stock unavailable')).toHaveLength(2);
    expect(container.textContent).not.toContain('Supplier:');
  });

  it('shows the conditional no-custody message without removing View details', () => {
    render(
      <CatalogueBrowser
        actor="manufacturer"
        role="manufacturer"
        items={[
          {
            itemId: 'item',
            batches: ['batch'],
            name: 'Warehouse-only ingredient',
            kind: 1,
            seller: 'supplier',
            active: true,
            unit: 'kg',
            batchDetails: [{ batchId: 'batch', supplierAvailable: '100' }],
            custodyPositions: [],
          },
        ]}
        busy={false}
        onQuantityRequest={vi.fn()}
        onEvidenceRequest={vi.fn()}
        onOpenEvidence={vi.fn()}
        presentation={{ ...manufacturerPresentation, distributorStockRequired: true }}
      />,
    );
    expect(screen.getByText('Not yet available to request')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View details' })).toBeTruthy();
  });

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
    expect(within(dialog).getByRole('img', { name: 'Ingredient image placeholder' })).toBeTruthy();
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
