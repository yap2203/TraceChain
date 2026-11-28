// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
vi.mock('./manufacturer', () => ({
  CreateProductBatch: ({
    onBack,
    onViewProduct,
  }: {
    onBack: () => void;
    onViewProduct: (id: string) => void;
  }) => (
    <>
      <button onClick={() => onViewProduct('new-batch')}>View product</button>
      <button onClick={onBack}>Back to products</button>
    </>
  ),
  ProductBatchDetail: ({ batchId }: { batchId: string }) => <h2>Product {batchId}</h2>,
  ProductBatches: () => <h2>Product list</h2>,
  ManufacturerOverview: () => null,
  ManufacturerCredential: () => null,
}));
import { WorkspaceScreen } from './WorkspaceScreen';
afterEach(cleanup);
function Screen() {
  const location = useLocation(),
    navigate = useNavigate();
  return (
    <>
      <output aria-label="Current URL">{location.pathname + location.search}</output>
      <button onClick={() => navigate(-1)}>Browser Back</button>
      <WorkspaceScreen role="manufacturer" page="products" />
    </>
  );
}
it('uses distinct existing detail/list URLs and supports browser Back from a newly created product', () => {
  render(
    <MemoryRouter initialEntries={['/manufacturer/product-batches?view=products-new']}>
      <Screen />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'View product' }));
  expect(screen.getByRole('heading', { name: 'Product new-batch' })).toBeTruthy();
  expect(screen.getByLabelText('Current URL').textContent).toBe(
    '/manufacturer/product-batches?view=product-detail&id=new-batch',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Browser Back' }));
  expect(screen.getByRole('button', { name: 'View product' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to products' }));
  expect(screen.getByRole('heading', { name: 'Product list' })).toBeTruthy();
  expect(screen.getByLabelText('Current URL').textContent).toBe('/manufacturer/product-batches');
});
