function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('VITE_CHAIN_ID must be a positive integer.');
  }
  return parsed;
}

export const chainConfig = {
  chainId: positiveInteger(import.meta.env.VITE_CHAIN_ID, 31_337),
  currencySymbol: import.meta.env.VITE_CHAIN_CURRENCY_SYMBOL ?? 'ETH',
  name: import.meta.env.VITE_CHAIN_NAME ?? 'TraceChain Local',
  rpcUrl: import.meta.env.VITE_CHAIN_RPC_URL ?? 'http://127.0.0.1:8545',
} as const;

export const targetChainId = BigInt(chainConfig.chainId);
export const targetChainHex = `0x${chainConfig.chainId.toString(16)}` as `0x${string}`;
