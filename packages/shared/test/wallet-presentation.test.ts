import { Wallet, ZeroHash, id } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  WALLET_VP_FORMAT,
  verifyWalletPresentation,
  walletProofData,
  type WalletProofContext,
} from '../src/index.js';

const holder = Wallet.createRandom();
const verifier = Wallet.createRandom().address;
const signedAt = 1_800_000_000;
const deadline = signedAt + 2 * 3600;
const context: WalletProofContext = {
  chainId: 11155111,
  verifyingContract: '0x1000000000000000000000000000000000000001',
  requestId: id('request'),
  verifier,
  holder: holder.address,
  purpose: 'Verify company identity',
  challenge: 'challenge',
  batchId: ZeroHash,
  issuedAt: signedAt,
  expiresAt: deadline,
};
async function presentation() {
  const data = walletProofData('sd-jwt', context);
  return {
    format: WALLET_VP_FORMAT,
    presentation: 'sd-jwt',
    proof: { context, signature: await holder.signTypedData(data.domain, data.types, data.value) },
  };
}
const expected = (now: number) => ({
  chainId: context.chainId,
  verifyingContract: context.verifyingContract,
  requestId: context.requestId,
  verifier,
  holder: holder.address,
  purpose: context.purpose,
  challenge: context.challenge,
  batchId: ZeroHash,
  now,
  expiresAt: deadline,
});

describe('wallet presentation lifetime', () => {
  it('stays valid until the requester deadline, not 5 minutes after signing', async () => {
    const value = await presentation();
    expect(() => verifyWalletPresentation(value, expected(signedAt + 10 * 60))).not.toThrow();
    expect(() => verifyWalletPresentation(value, expected(deadline - 1))).not.toThrow();
  });
  it('expires at the requester deadline and rejects future signing times', async () => {
    const value = await presentation();
    expect(() => verifyWalletPresentation(value, expected(deadline))).toThrow(/expired/);
    expect(() => verifyWalletPresentation(value, expected(signedAt - 60))).toThrow(/signing time/);
  });
});
