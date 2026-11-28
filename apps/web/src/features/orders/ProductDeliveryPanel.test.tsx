// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeShipmentQr } from '@tracechain/shared';
const m = vi.hoisted(() => ({ prepare: vi.fn(), sign: vi.fn(), decode: vi.fn() }));
vi.mock('./orders.api', () => ({
  prepareLogistics: m.prepare,
  deliveryIdentity: vi.fn(async () => ({ status: 'NOT_REQUESTED' })),
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
  submitProductionTransaction: m.sign,
}));
vi.mock('../product-traceability/ProductQrDisplay', () => ({
  ProductQrDisplay: () => <p>Printable product order QR</p>,
}));
vi.mock('../custody-transfers/qr-reader', () => ({
  ZxingTransferQrReader: class {
    decodeImage() {
      return m.decode();
    }
  },
  cameraErrorMessage: (e: Error) => e.message,
  qrImageErrorMessage: (e: Error) => e.message,
}));
import { ProductDeliveryPanel } from './ProductDeliveryPanel';
import type { OrdersState } from './orders.api';
const manufacturer = '0x1000000000000000000000000000000000000001',
  distributor = '0x2000000000000000000000000000000000000002',
  retailer = '0x3000000000000000000000000000000000000003';
const orderId = `0x${'11'.repeat(32)}` as `0x${string}`;
const base: OrdersState = {
  actor: manufacturer,
  role: 'MANUFACTURER',
  chainId: 31337,
  ordersAddress: manufacturer,
  productDeliverySupported: true,
  companies: [{ wallet: distributor, role: 'DISTRIBUTOR', companyName: 'Actual Distributor' }],
  catalogue: [],
  orders: [],
  shipments: [],
  locations: [
    { company: manufacturer, location: 'factory', label: 'Factory' },
    { company: retailer, location: 'shop', label: 'Retail shop' },
  ],
};
const order = {
  orderId,
  seller: manufacturer,
  buyer: retailer,
  requested: '10',
  requestedBatch: 'product',
  decision: { status: 1 },
  details: { receivingLocation: 'shop' },
  expiresAt: Math.floor(Date.now() / 1000) + 10000,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_PUBLIC_APP_URL', 'http://localhost:5173');
  m.prepare.mockResolvedValue({
    transaction: { chainId: 31337, to: manufacturer, data: '0x', value: '0x0' },
  });
  m.sign.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
describe('Manufacturer Distributor Retailer product delivery', () => {
  it('requires explicit Manufacturer selection and blocks custody without sufficient stock', async () => {
    render(
      <ProductDeliveryPanel
        data={base}
        order={order}
        item={{ kind: 2, name: 'Actual product', unit: 'each', storageLocations: [] }}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText('Delivery Distributor'), {
      target: { value: distributor },
    });
    fireEvent.change(screen.getByLabelText('Manufacturer pickup location'), {
      target: { value: 'factory' },
    });
    expect(m.prepare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Request Distributor delivery' }));
    await waitFor(() =>
      expect(m.prepare).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'product-order-select',
          mode: 1,
          orderId,
          distributor,
          toLocation: 'shop',
        }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Product delivery mode'), { target: { value: '2' } });
    expect(
      (
        screen.getByRole('button', {
          name: 'Confirm product delivery from custody',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/No selected Distributor warehouse has enough/)).toBeTruthy();
  });
  it('gives only the assigned carrier accept/decline actions and no Manufacturer controls', async () => {
    const r = { ...order, productDelivery: { stage: 2, mode: 1, distributor } };
    render(
      <ProductDeliveryPanel
        data={{ ...base, actor: distributor, role: 'DISTRIBUTOR' }}
        order={r}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByLabelText('Product delivery mode')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Decline product delivery' }));
    await waitFor(() =>
      expect(m.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'product-order-respond', accept: false }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Request Manufacturer company evidence' }));
    expect(await screen.findByRole('dialog', { name: /Request company evidence/ })).toBeTruthy();
  });
  it.each([true, false])(
    'unlocks direct pickup only after scanning the exact QR image and explicit physical confirmation (configured origin: %s)',
    async (configured) => {
      const publicAppUrl = configured ? 'http://localhost:5173' : window.location.origin;
      if (!configured) vi.stubEnv('VITE_PUBLIC_APP_URL', undefined);
      const qr = encodeShipmentQr({
        shipmentId: orderId,
        kind: 'product',
        chainId: 31337,
        ordersAddress: manufacturer,
        publicAppUrl,
      });
      m.decode.mockResolvedValue(qr);
      render(
        <ProductDeliveryPanel
          data={{ ...base, actor: distributor, role: 'DISTRIBUTOR' }}
          order={{ ...order, productDelivery: { stage: 3, mode: 1, distributor } }}
          onChanged={vi.fn().mockResolvedValue(undefined)}
        />,
      );
      const button = (await screen.findByRole('button', {
        name: 'Confirm product pickup & dispatch',
      })) as HTMLButtonElement;
      fireEvent.change(screen.getByLabelText(/Vehicle registration/), {
        target: { value: 'VAB 1234' },
      });
      fireEvent.click(screen.getByRole('checkbox'));
      expect(button.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('Upload product pickup QR image'), {
        target: { files: [new File(['qr'], 'qr.png', { type: 'image/png' })] },
      });
      await screen.findByText('Correct product-order label scanned.');
      fireEvent.click(screen.getByRole('checkbox'));
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      await waitFor(() =>
        expect(m.prepare).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'product-order-dispatch', qrPayload: qr }),
        ),
      );
    },
  );
});
