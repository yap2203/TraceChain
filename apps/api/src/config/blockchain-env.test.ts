import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBlockchainEnvironment } from './blockchain-env.js';

const address = '0x0000000000000000000000000000000000000001';
function required() {
  for (const name of [
    'CUSTODY_TRANSFER_ADDRESS',
    'EVIDENCE_REGISTRY_ADDRESS',
    'INGREDIENT_REGISTRY_ADDRESS',
    'PRODUCT_REGISTRY_ADDRESS',
    'CREDENTIAL_REGISTRY_ADDRESS',
    'STAKEHOLDER_REGISTRY_ADDRESS',
  ])
    vi.stubEnv(name, address);
}

describe('blockchain RPC environment', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps legacy single-provider configuration working', () => {
    required();
    vi.stubEnv('CHAIN_RPC_URL', 'http://127.0.0.1:8545');
    vi.stubEnv('CHAIN_RPC_PRIMARY_URL', '');
    expect(loadBlockchainEnvironment().CHAIN_RPC_URL).toBe('http://127.0.0.1:8545');
  });

  it('uses the explicit primary and accepts blank optional endpoints', () => {
    required();
    vi.stubEnv('CHAIN_RPC_URL', 'http://127.0.0.1:8545');
    vi.stubEnv('CHAIN_RPC_PRIMARY_URL', 'https://primary.example/rpc');
    vi.stubEnv('CHAIN_RPC_SECONDARY_URL', '');
    vi.stubEnv('CHAIN_RPC_EMERGENCY_URL', '');
    vi.stubEnv('CHAIN_LOG_RPC_URL', '');
    vi.stubEnv('CHAIN_LOG_FALLBACK_URL', '');
    vi.stubEnv('CHAIN_EVENT_START_BLOCK', '');
    const result = loadBlockchainEnvironment();
    expect(result.CHAIN_RPC_URL).toBe('https://primary.example/rpc');
    expect(result.CHAIN_EVENT_START_BLOCK).toBeUndefined();
  });

  it('rejects startup without a primary or legacy RPC URL', () => {
    required();
    vi.stubEnv('CHAIN_RPC_URL', '');
    vi.stubEnv('CHAIN_RPC_PRIMARY_URL', '');
    expect(() => loadBlockchainEnvironment()).toThrow('CHAIN_RPC_PRIMARY_URL');
  });
});
