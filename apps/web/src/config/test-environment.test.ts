import { describe, expect, it } from 'vitest';

import { loadTransferQrConfiguration } from '../features/custody-transfers/transfer-qr';
import { loadProductQrConfiguration } from '../features/product-traceability/product-qr';
import { chainConfig } from './network';

describe('frontend test environment', () => {
  it('uses safe local public defaults without a private root environment file', () => {
    expect(chainConfig).toEqual({
      chainId: 31_337,
      currencySymbol: 'ETH',
      name: 'TraceChain Local',
      rpcUrl: 'http://127.0.0.1:8545',
    });
    expect(loadProductQrConfiguration()).toEqual({
      chainId: 31_337,
      productRegistryAddress: '0x1000000000000000000000000000000000000001',
      publicAppUrl: 'http://localhost:5173',
    });
    expect(loadTransferQrConfiguration()).toEqual({
      chainId: 31_337,
      contractAddress: '0x4000000000000000000000000000000000000004',
      publicAppUrl: 'http://localhost:5173',
    });
  });
});
