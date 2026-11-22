// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Wallet, id } from 'ethers';
import { webcrypto } from 'node:crypto';
import { createFullWalletPresentation } from './wallet-presentation';
import {
  parseWalletPresentation,
  verifyWalletPresentation,
  type WalletProofContext,
} from '@tracechain/shared';

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.ethereum;
});
it('signs the exact previewed full credential with the connected MetaMask account', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const wallet = new Wallet('0x' + '11'.repeat(32)),
    now = Math.floor(Date.now() / 1000);
  const context: WalletProofContext = {
    chainId: 31337,
    verifyingContract: new Wallet('0x' + '22'.repeat(32)).address,
    holder: wallet.address,
    verifier: new Wallet('0x' + '33'.repeat(32)).address,
    requestId: id('request'),
    batchId: id('batch'),
    purpose: 'Review ingredient origin',
    challenge: id('fresh'),
    issuedAt: now,
    expiresAt: now + 240,
  };
  const calls: string[] = [];
  window.ethereum = {
    request: async ({ method, params }: any) => {
      calls.push(method);
      if (method === 'eth_chainId') return '0x7a69';
      if (method === 'eth_accounts') return [wallet.address];
      if (method === 'eth_signTypedData_v4') {
        const data = JSON.parse(params[1]);
        delete data.types.EIP712Domain;
        return wallet.signTypedData(data.domain, data.types, data.message);
      }
      throw new Error('Unexpected wallet method: ' + method);
    },
  };
  const source = JSON.stringify({
    credentialSubject: { supplierWallet: wallet.address, origin: 'Ghana' },
  });
  const signed = parseWalletPresentation(await createFullWalletPresentation(source, context))!;
  expect(signed.presentation).toBe(source);
  expect(() => verifyWalletPresentation(signed, { ...context, now })).not.toThrow();
  expect(calls.filter((method) => method === 'eth_signTypedData_v4')).toHaveLength(1);
  expect(calls).not.toContain('eth_sendTransaction');
  window.ethereum.request = async ({ method }: any) => {
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'eth_accounts') return [wallet.address];
    throw Object.assign(new Error('User rejected sharing'), { code: 4001 });
  };
  await expect(createFullWalletPresentation(source, context)).rejects.toMatchObject({
    code: 'ACTION_REJECTED',
  });
  await expect(
    createFullWalletPresentation(source, {
      ...context,
      holder: new Wallet('0x' + '44'.repeat(32)).address,
    }),
  ).rejects.toThrow(/different wallet/);
});
