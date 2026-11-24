// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeIngredientDeliveryQr } from '@tracechain/shared';
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  submit: vi.fn(),
  identity: vi.fn(),
  image: vi.fn(),
}));
vi.mock('../custody-transfers/qr-reader', () => ({
  ZxingTransferQrReader: class {
    decodeImage(file: File) {
      return mocks.image(file);
    }
  },
  cameraErrorMessage: (cause: Error) => cause.message,
  qrImageErrorMessage: (cause: Error) => cause.message,
}));
vi.mock('./orders.api', () => ({
  prepareOrder: mocks.prepare,
  prepareLogistics: mocks.prepare,
  deliveryIdentity: mocks.identity,
  getPickupPlan: vi.fn(async () => ({
    plan: {
      pickupAt: Math.floor(Date.now() / 1000) + 300,
      arrangedAt: new Date().toISOString(),
      distributor: 'test-distributor',
    },
  })),
  savePickupPlan: vi.fn(),
}));
vi.mock('../production-flow/production-flow.transaction', () => ({
  submitProductionTransaction: mocks.submit,
}));
vi.mock('../product-traceability/ProductQrDisplay', () => ({
  ProductQrDisplay: ({ labelTitle }: { labelTitle: string }) => (
    <section aria-label={labelTitle}>Print package label</section>
  ),
}));
import { IngredientDeliveryPanel } from './IngredientDeliveryPanel';
import type { OrdersState } from './orders.api';
const supplier = '0x2000000000000000000000000000000000000002',
  buyer = '0x3000000000000000000000000000000000000003',
  carrier = '0x4000000000000000000000000000000000000004';
const orderId = `0x${'11'.repeat(32)}` as `0x${string}`,
  ordersAddress = '0x1000000000000000000000000000000000000001';
const now = Math.floor(Date.now() / 1000);
const qr = encodeIngredientDeliveryQr({
  orderId,
  chainId: 31337,
  ordersAddress,
  publicAppUrl: 'http://localhost:5173',
});
const state: OrdersState = {
  actor: supplier,
  role: 'SUPPLIER',
  chainId: 31337,
  ordersAddress,
  ingredientDeliverySupported: true,
  distributors: [{ wallet: carrier, companyName: 'Delivery Company' }],
  orders: [],
  catalogue: [],
  shipments: [],
  locations: [{ company: buyer, location: 'factory', label: 'Production factory' }],
};
const order = {
  orderId,
  seller: supplier,
  buyer,
  sellerName: 'Supplier Company',
  buyerName: 'Manufacturer Company',
  requested: '10',
  approvedReceivedQuantity: '0',
  expiresAt: now + 86400,
  deliveryQr: qr,
  delivery: {
    stage: 1,
    assignmentDeadline: now + 3600,
    distributor: carrier,
    distributorName: 'Delivery Company',
    pickedUpAt: now - 60,
    acceptedAt: now - 120,
  },
};
const mount = (actor = supplier, stage = 1) =>
  render(
    <MemoryRouter>
      <IngredientDeliveryPanel
        data={{ ...state, actor }}
        order={{ ...order, delivery: { ...order.delivery, stage } }}
        item={{ name: 'Registered cocoa', unit: 'g' }}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({
    transaction: { chainId: 31337, to: ordersAddress, data: '0x', value: '0x0' },
  });
  mocks.submit.mockResolvedValue({});
  mocks.identity.mockResolvedValue({ status: 'NOT_REQUESTED' });
});
afterEach(cleanup);
describe('Ingredient delivery handoff', () => {
  it('selects only sufficient owned exact-batch custody after explicit Supplier confirmation', async () => {
    const position = {
      positionId: 'enough',
      batchId: 'batch',
      supplier,
      unit: 'g',
      available: '10',
      orderable: true,
      warehouseName: 'Warehouse A',
    };
    render(
      <MemoryRouter>
        <IngredientDeliveryPanel
          data={{
            ...state,
            fulfilmentSupported: true,
            logistics: {
              warehouses: [],
              shipments: [],
              productStock: [],
              positions: [
                position,
                { ...position, positionId: 'short', available: '9' },
                { ...position, positionId: 'foreign', supplier: buyer },
                { ...position, positionId: 'other-batch', batchId: 'different' },
              ],
            },
          }}
          order={{ ...order, requestedBatch: 'batch', details: { receivingLocation: 'factory' } }}
          item={{ name: 'Ingredient', unit: 'g' }}
          onChanged={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>,
    );
    const select = screen.getByLabelText('Custody stock for this order');
    expect(select.querySelectorAll('option')).toHaveLength(2);
    const button = screen.getByRole('button', {
      name: 'Confirm delivery from custody',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'enough' } });
    expect(button.disabled).toBe(false);
    expect(mocks.prepare).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'arrange-from-custody',
          orderId,
          positionId: 'enough',
          receivingLocation: 'factory',
        }),
      ),
    );
  });
  it('keeps direct delivery available when no custody warehouse can cover the order', () => {
    mount();
    expect(
      (screen.getByRole('button', { name: 'Confirm delivery from custody' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/No warehouse has enough unreserved stock/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Request Distributor' })).toBeTruthy();
  });
  it('prompts printing after approval and requests the selected authorized carrier explicitly', async () => {
    mount();
    expect(screen.getByRole('region', { name: 'Ingredient Delivery QR' })).toBeTruthy();
    expect(
      screen.getByRole('list', { name: 'Supplier to Distributor to Manufacturer' }),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Choose Distributor'), { target: { value: carrier } });
    fireEvent.click(screen.getByRole('button', { name: 'Request Distributor' }));
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delivery-assign', orderId, distributor: carrier }),
      ),
    );
  });
  it('lets only the assigned Distributor respond without showing receipt controls', async () => {
    mount(carrier, 2);
    expect(screen.queryByRole('button', { name: 'Confirm receipt with MetaMask' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Request Supplier company evidence' }));
    expect(await screen.findByRole('dialog', { name: /Request company evidence/ })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept delivery' }));
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'delivery-respond', accept: true }),
      ),
    );
  });
  it('requires a matching scanned label, actual quantities, location and explicit physical receipt declaration', async () => {
    mount(buyer, 4);
    const confirm = screen.getByRole('button', { name: 'Confirm receipt with MetaMask' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    mocks.image.mockResolvedValueOnce(qr.replace('31337', '11155111'));
    fireEvent.change(screen.getByLabelText('Upload delivery QR image'), {
      target: { files: [new File(['qr'], 'bad.png', { type: 'image/png' })] },
    });
    expect(await screen.findByText(/different request, chain or registry/)).toBeTruthy();
    mocks.image.mockResolvedValueOnce(qr);
    fireEvent.change(screen.getByLabelText('Upload delivery QR image'), {
      target: { files: [new File(['qr'], 'good.png', { type: 'image/png' })] },
    });
    await screen.findByText(/Label matches this request/);
    fireEvent.change(screen.getByLabelText('Receiving / production location'), {
      target: { value: 'factory' },
    });
    fireEvent.change(screen.getByLabelText('Quantity physically received (g)'), {
      target: { value: '10' },
    });
    const when = new Date((now - 10) * 1000);
    when.setMinutes(when.getMinutes() - when.getTimezoneOffset());
    fireEvent.change(screen.getByLabelText('Actual receipt date and time'), {
      target: { value: when.toISOString().slice(0, 19) },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'approved-receipt',
          orderId,
          quantity: '10',
          location: 'factory',
          qrPayload: qr,
        }),
      ),
    );
  });
  it('hides assignment and print actions when the assignment deadline is missed', () => {
    render(
      <MemoryRouter>
        <IngredientDeliveryPanel
          data={state}
          order={{ ...order, delivery: { ...order.delivery, assignmentDeadline: now - 1 } }}
          onChanged={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request Distributor' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Ingredient Delivery QR' })).toBeNull();
  });
});
