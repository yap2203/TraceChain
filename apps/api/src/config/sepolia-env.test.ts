import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { dataDirectory, dataFile } from './data-directory.js';
import { loadTraceChainSsiEnvironment } from './ssi-env.js';

afterEach(() => vi.unstubAllEnvs());
const configuration = {
  VERAMO_KMS_SECRET_KEY: '7'.repeat(64),
  TRACECHAIN_AUTHORITY_DID_ALIAS: 'test-authority',
};
describe('Sepolia configuration and isolated storage', () => {
  it('reuses the active Sepolia RPC for SSI without a duplicate URL', () => {
    const result = loadTraceChainSsiEnvironment({
      ...configuration,
      CHAIN_ID: '11155111',
      CHAIN_RPC_URL: 'https://example.invalid/sepolia',
      TRACECHAIN_DATA_DIR: '.tracechain/sepolia',
    });
    expect(result.config.chainId).toBe(11155111);
    expect(result.config.rpcUrl).toBe('https://example.invalid/sepolia');
    expect(result.storageDirectory).toBe(
      resolve(dataDirectory({ TRACECHAIN_DATA_DIR: '.tracechain/sepolia' }), 'veramo'),
    );
  });
  it('never uses the local contract RPC for Sepolia DID resolution', () => {
    expect(() =>
      loadTraceChainSsiEnvironment({
        ...configuration,
        CHAIN_ID: '31337',
        CHAIN_RPC_URL: 'http://127.0.0.1:8545',
      }),
    ).toThrow();
    expect(
      loadTraceChainSsiEnvironment({
        ...configuration,
        CHAIN_ID: '31337',
        CHAIN_RPC_URL: 'http://127.0.0.1:8545',
        SEPOLIA_RPC_URL: 'https://example.invalid/did-resolver',
      }).config.rpcUrl,
    ).toBe('https://example.invalid/did-resolver');
  });
  it('keeps existing local state separate and resolves every runtime file in the selected directory', () => {
    const local = dataDirectory({});
    const sepolia = dataDirectory({ TRACECHAIN_DATA_DIR: '.tracechain/sepolia' });
    expect(local).not.toBe(sepolia);
    vi.stubEnv('TRACECHAIN_DATA_DIR', '.tracechain/sepolia');
    expect(dataFile('didcomm/state.json')).toBe(resolve(sepolia, 'didcomm/state.json'));
    expect(dataFile('applications/documents.encrypted.json')).toBe(
      resolve(sepolia, 'applications/documents.encrypted.json'),
    );
    expect(dataFile('issuance/ingredient-batches.json')).toBe(
      resolve(sepolia, 'issuance/ingredient-batches.json'),
    );
  });
});
