import { getAddress, id, keccak256, toUtf8Bytes, verifyTypedData, ZeroHash } from 'ethers';

export const WALLET_VP_FORMAT = 'TRACECHAIN_EIP712_VP_V1' as const;
export const WALLET_HOLDER_BINDING = 'tracechain:eip712:holder:v1' as const;
export interface WalletProofContext {
  chainId: number;
  verifyingContract: string;
  requestId: string;
  verifier: string;
  holder: string;
  purpose: string;
  challenge: string;
  batchId: string;
  issuedAt: number;
  expiresAt: number;
}
export interface WalletPresentation {
  format: typeof WALLET_VP_FORMAT;
  presentation: string;
  proof: { context: WalletProofContext; signature: string };
}
export const walletProofTypes = {
  HolderProof: [
    { name: 'proofVersion', type: 'uint256' },
    { name: 'presentationDigest', type: 'bytes32' },
    { name: 'requestId', type: 'bytes32' },
    { name: 'holder', type: 'address' },
    { name: 'verifier', type: 'address' },
    { name: 'purposeHash', type: 'bytes32' },
    { name: 'challengeHash', type: 'bytes32' },
    { name: 'batchId', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
};
export function walletProofData(sdJwt: string, context: WalletProofContext) {
  return {
    domain: {
      name: 'TraceChain Holder Presentation',
      version: '1',
      chainId: context.chainId,
      verifyingContract: getAddress(context.verifyingContract),
    },
    types: walletProofTypes,
    value: {
      proofVersion: 1,
      presentationDigest: keccak256(toUtf8Bytes(sdJwt)),
      requestId: context.requestId,
      holder: getAddress(context.holder),
      verifier: getAddress(context.verifier),
      purposeHash: id(context.purpose),
      challengeHash: id(context.challenge),
      batchId: context.batchId || ZeroHash,
      issuedAt: context.issuedAt,
      expiresAt: context.expiresAt,
    },
  };
}
export function parseWalletPresentation(value: string): WalletPresentation | undefined {
  if (!value.trimStart().startsWith('{')) return undefined;
  const parsed = JSON.parse(value) as WalletPresentation;
  if (!parsed || parsed.format === undefined) return undefined;
  if (Object.keys(parsed).some((key) => !['format', 'presentation', 'proof'].includes(key)))
    throw new Error('Unexpected unsigned presentation fields.');
  if (
    parsed.format !== WALLET_VP_FORMAT ||
    typeof parsed.presentation !== 'string' ||
    !parsed.proof?.context ||
    typeof parsed.proof.signature !== 'string'
  )
    throw new Error('Unsupported wallet presentation structure.');
  if (
    Object.keys(parsed.proof).some((key) => !['context', 'signature'].includes(key)) ||
    Object.keys(parsed.proof.context).some(
      (key) =>
        ![
          'chainId',
          'verifyingContract',
          'requestId',
          'verifier',
          'holder',
          'purpose',
          'challenge',
          'batchId',
          'issuedAt',
          'expiresAt',
        ].includes(key),
    )
  )
    throw new Error('Unexpected unsigned proof fields.');
  return parsed;
}
export function presentationSdJwt(value: string) {
  return parseWalletPresentation(value)?.presentation ?? value;
}
export function verifyWalletPresentation(
  value: WalletPresentation,
  expected: Omit<WalletProofContext, 'issuedAt' | 'expiresAt'> & { now: number; expiresAt: number },
) {
  const c = value.proof.context;
  if (
    !Number.isSafeInteger(c.issuedAt) ||
    !Number.isSafeInteger(c.expiresAt) ||
    // Signed no later than now; its lifetime is bounded by the request deadline (expected.expiresAt),
    // and the single-use challenge prevents replay, so no separate signing-age limit applies.
    c.issuedAt > expected.now + 30 ||
    c.expiresAt <= expected.now ||
    c.expiresAt <= c.issuedAt ||
    c.expiresAt > expected.expiresAt
  )
    throw new Error('Wallet presentation expired or has an invalid signing time.');
  for (const key of ['requestId', 'purpose', 'challenge', 'batchId'] as const)
    if (c[key] !== expected[key]) throw new Error(`Wallet presentation ${key} mismatch.`);
  if (
    c.chainId !== expected.chainId ||
    getAddress(c.verifyingContract) !== getAddress(expected.verifyingContract) ||
    getAddress(c.verifier) !== getAddress(expected.verifier) ||
    getAddress(c.holder) !== getAddress(expected.holder)
  )
    throw new Error('Wallet presentation domain, holder or intended verifier mismatch.');
  const data = walletProofData(value.presentation, c);
  if (
    getAddress(verifyTypedData(data.domain, data.types, data.value, value.proof.signature)) !==
    getAddress(expected.holder)
  )
    throw new Error('Wallet holder signature does not match its issuer-signed binding.');
}
