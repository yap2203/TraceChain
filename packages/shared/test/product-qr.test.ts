import { decodeProductQrPayload, encodeProductQrPayload, ProductQrError } from '../src/index.js';
import { describe, expect, it } from 'vitest';

const REGISTRY = '0x1000000000000000000000000000000000000001';
const BATCH_ID = `0x${'ab'.repeat(32)}` as `0x${string}`;
const canonical = () =>
  encodeProductQrPayload({
    batchId: BATCH_ID,
    chainId: 31_337,
    productRegistryAddress: REGISTRY,
    publicAppUrl: 'https://tracechain.example/',
    version: 1,
  });

describe('product traceability QR codec', () => {
  it('creates a canonical phone-compatible HTTPS URL and decodes it', () => {
    const value = canonical();
    expect(value).toBe(
      `https://tracechain.example/trace/product?v=1&chainId=31337&registry=${REGISTRY}&batchId=${BATCH_ID}`,
    );
    expect(decodeProductQrPayload(value)).toEqual({
      batchId: BATCH_ID,
      chainId: 31_337,
      productRegistryAddress: REGISTRY,
      version: 1,
    });
  });

  it.each([
    ['missing', `https://tracechain.example/trace/product?v=1&chainId=31337&registry=${REGISTRY}`],
    ['duplicate', `${canonical()}&batchId=${BATCH_ID}`],
    ['unknown', `${canonical()}&rpc=https://evil.example`],
    ['malformed', 'javascript:alert(1)'],
  ])('rejects %s parameters or locations', (_label, value) => {
    expect(() => decodeProductQrPayload(value)).toThrow(ProductQrError);
  });

  it('allows localhost HTTP only as an explicit development exception', () => {
    expect(
      encodeProductQrPayload({
        batchId: BATCH_ID,
        chainId: 31_337,
        productRegistryAddress: REGISTRY,
        publicAppUrl: 'http://localhost:5173',
        version: 1,
      }),
    ).toMatch(/^http:\/\/localhost:5173\/trace\/product\?/);
    expect(() =>
      encodeProductQrPayload({
        batchId: BATCH_ID,
        chainId: 31_337,
        productRegistryAddress: REGISTRY,
        publicAppUrl: 'http://tracechain.example',
        version: 1,
      }),
    ).toThrow(ProductQrError);
  });
});
