import { describe, expect, it } from 'vitest';
import {
  decodeIngredientDeliveryQr,
  encodeIngredientDeliveryQr,
  encodeShipmentQr,
  decodeShipmentQr,
} from './ingredient-delivery-qr.js';
const config = {
  orderId: `0x${'11'.repeat(32)}` as `0x${string}`,
  chainId: 31337,
  ordersAddress: '0x1000000000000000000000000000000000000001',
  publicAppUrl: 'https://tracechain.example',
};
describe('Ingredient delivery locators', () => {
  it('reports an invalid configured origin instead of leaking a URL constructor exception', () => {
    const qr = encodeShipmentQr({ ...config, shipmentId: config.orderId, kind: 'product' });
    for (const publicAppUrl of [undefined, '', 'tracechain.example'])
      expect(() => decodeShipmentQr(qr, { ...config, publicAppUrl: publicAppUrl as any })).toThrow(
        'The public application URL is invalid.',
      );
  });
  it.each(['ingredient', 'product'] as const)(
    'binds modern %s labels to the shipment, kind and deployment',
    (kind) => {
      const expected = { ...config, shipmentId: config.orderId, kind };
      const qr = encodeShipmentQr(expected);
      expect(decodeShipmentQr(qr, expected)).toEqual({ shipmentId: config.orderId, kind });
      for (const invalid of [
        qr + '&kind=' + kind,
        qr + '&shipmentId=' + config.orderId,
        qr.replace('31337', '11155111'),
        qr.replace('tracechain.example', 'attacker.example'),
        qr.replace(config.orderId, `0x${'22'.repeat(32)}`),
        qr.replace(`kind=${kind}`, `kind=${kind === 'ingredient' ? 'product' : 'ingredient'}`),
      ]) {
        expect(() => decodeShipmentQr(invalid, expected)).toThrow();
      }
    },
  );
  it('round trips only public deployment and request identifiers', () => {
    const qr = encodeIngredientDeliveryQr(config);
    expect(decodeIngredientDeliveryQr(qr, config)).toEqual({ orderId: config.orderId });
    expect(qr).not.toContain('credential');
  });
  it('reports shipment, network and contract mismatches separately', () => {
    const expected = { ...config, shipmentId: config.orderId, kind: 'ingredient' as const };
    const qr = encodeShipmentQr(expected);
    expect(() => decodeShipmentQr(qr, { ...expected, shipmentId: `0x${'22'.repeat(32)}` })).toThrow(
      'different shipment',
    );
    expect(() => decodeShipmentQr(qr, { ...expected, chainId: 11_155_111 })).toThrow(
      'different blockchain network',
    );
    expect(() =>
      decodeShipmentQr(qr, {
        ...expected,
        ordersAddress: '0x2000000000000000000000000000000000000002',
      }),
    ).toThrow('different Orders contract');
  });
  it.each([
    (qr: string) => qr.replace('https://tracechain.example', 'https://attacker.example'),
    (qr: string) => qr.replace('31337', '11155111'),
    (qr: string) => qr.replace(config.orderId, `0x${'22'.repeat(32)}`),
    (qr: string) => qr.replace(config.ordersAddress, '0x2000000000000000000000000000000000000002'),
    (qr: string) => qr + '&orderId=' + config.orderId,
    (qr: string) => qr + '&unknown=1',
    (qr: string) => qr + '#secret',
  ])('rejects substituted, duplicate and unrelated locator data', (change) => {
    expect(() =>
      decodeIngredientDeliveryQr(change(encodeIngredientDeliveryQr(config)), config),
    ).toThrow();
  });
});
