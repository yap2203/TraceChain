import { SDJwtInstance } from '@sd-jwt/core';
import { BrowserProvider, getAddress } from 'ethers';
import {
  WALLET_VP_FORMAT,
  WALLET_HOLDER_BINDING,
  walletProofData,
  type WalletProofContext,
} from '@tracechain/shared';

export async function createWalletPresentation(
  credential: string,
  claims: string[],
  context: WalletProofContext,
) {
  const instance = new SDJwtInstance<Record<string, unknown>>({
    hashAlg: 'sha-256',
    hasher: async (value, algorithm) => {
      if (algorithm !== 'sha-256') throw new Error('Unsupported selective disclosure hash.');
      return new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value),
        ),
      );
    },
  });
  const payload = await instance.getClaims(credential);
  const binding = payload.cnf as { wallet?: string; proof?: string };
  if (
    binding?.proof !== WALLET_HOLDER_BINDING ||
    !binding.wallet ||
    getAddress(binding.wallet) !== getAddress(context.holder)
  )
    throw new Error(
      'This credential requires its original presentation key. Ask its issuer for a wallet-bound replacement.',
    );
  const sdJwt = await instance.present(
    credential,
    Object.fromEntries(claims.map((claim) => [claim, true])) as never,
  );
  return signPresentationContent(sdJwt, context);
}

export async function createFullWalletPresentation(
  credential: string,
  context: WalletProofContext,
) {
  const vc = JSON.parse(credential);
  if (getAddress(vc.credentialSubject?.supplierWallet) !== getAddress(context.holder))
    throw new Error('The signed Ingredient Credential belongs to a different wallet.');
  return signPresentationContent(credential, context);
}

async function signPresentationContent(sdJwt: string, context: WalletProofContext) {
  if (!window.ethereum) throw new Error('Connect MetaMask before sharing.');
  const provider = new BrowserProvider(window.ethereum);
  if ((await provider.getNetwork()).chainId !== BigInt(context.chainId))
    throw new Error('Switch MetaMask to the configured TraceChain network.');
  const signer = await provider.getSigner();
  if (getAddress(await signer.getAddress()) !== getAddress(context.holder))
    throw new Error('Select the authenticated company wallet in MetaMask.');
  const data = walletProofData(sdJwt, context);
  const signature = await signer.signTypedData(data.domain, data.types, data.value);
  return JSON.stringify({
    format: WALLET_VP_FORMAT,
    presentation: sdJwt,
    proof: { context, signature },
  });
}
