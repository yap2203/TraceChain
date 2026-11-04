import { getAddress } from 'ethers';

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('VITE_CHAIN_ID must be a positive integer.');
  return parsed;
}

function contractAddress(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} is not configured.`);
  return getAddress(value);
}

export const chainConfig = {
  chainId: positiveInteger(import.meta.env.VITE_CHAIN_ID, 31337),
  currencySymbol: import.meta.env.VITE_CHAIN_CURRENCY_SYMBOL ?? 'ETH',
  name: import.meta.env.VITE_CHAIN_NAME ?? 'TraceChain Local',
  rpcUrl: import.meta.env.VITE_CHAIN_RPC_URL ?? 'http://127.0.0.1:8545',
} as const;

export const contractAddresses = {
  credentialRegistry: contractAddress('VITE_CREDENTIAL_REGISTRY_ADDRESS', import.meta.env.VITE_CREDENTIAL_REGISTRY_ADDRESS),
  custodyTransfer: contractAddress('VITE_CUSTODY_TRANSFER_ADDRESS', import.meta.env.VITE_CUSTODY_TRANSFER_ADDRESS),
  evidenceRegistry: contractAddress('VITE_EVIDENCE_REGISTRY_ADDRESS', import.meta.env.VITE_EVIDENCE_REGISTRY_ADDRESS),
  ingredientRegistry: contractAddress('VITE_INGREDIENT_REGISTRY_ADDRESS', import.meta.env.VITE_INGREDIENT_REGISTRY_ADDRESS),
  productRegistry: contractAddress('VITE_PRODUCT_REGISTRY_ADDRESS', import.meta.env.VITE_PRODUCT_REGISTRY_ADDRESS),
  stakeholderRegistry: contractAddress('VITE_STAKEHOLDER_REGISTRY_ADDRESS', import.meta.env.VITE_STAKEHOLDER_REGISTRY_ADDRESS),
} as const;

export const targetChainId = BigInt(chainConfig.chainId);
export const targetChainHex = `0x${chainConfig.chainId.toString(16)}`;
