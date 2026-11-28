// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { encodeShipmentQr } from '@tracechain/shared';
import {
  parseShipmentReceiptLink,
  safeShipmentReturnTo,
  shipmentAppOrigin,
} from './shipment-receipt-link';
afterEach(() => vi.unstubAllEnvs());
it('supports deployed HTTPS links and preserves their complete query on login return', () => {
  vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://app.example/');
  const qr = encodeShipmentQr({
    publicAppUrl: 'https://app.example',
    chainId: 31337,
    ordersAddress: '0x1000000000000000000000000000000000000001',
    shipmentId: ('0x' + '11'.repeat(32)) as `0x${string}`,
    kind: 'product',
  });
  expect(shipmentAppOrigin()).toBe('https://app.example');
  const path = new URL(qr).pathname + new URL(qr).search;
  expect(parseShipmentReceiptLink(qr).href).toBe(qr);
  expect(safeShipmentReturnTo(path)).toBe(path);
  expect(safeShipmentReturnTo(qr.replace('app.example', 'evil.example'))).toBeNull();
  expect(safeShipmentReturnTo('//evil.example' + path)).toBeNull();
  expect(safeShipmentReturnTo('/admin')).toBeNull();
  expect(safeShipmentReturnTo('javascript:alert(1)')).toBeNull();
});
it('uses the current trusted localhost origin only when configuration is omitted', () => {
  vi.stubEnv('VITE_PUBLIC_APP_URL', undefined);
  expect(shipmentAppOrigin()).toBe(window.location.origin);
  vi.stubEnv('VITE_PUBLIC_APP_URL', 'app.example');
  expect(() => shipmentAppOrigin()).toThrow('VITE_PUBLIC_APP_URL must be');
});
