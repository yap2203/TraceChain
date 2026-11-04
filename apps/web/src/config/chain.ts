import { getAddress } from 'ethers';

export { chainConfig, targetChainHex, targetChainId } from './network';

function contractAddress(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} is not configured.`);
  return getAddress(value);
}

export const contractAddresses = {
  credentialRegistry: contractAddress(
    'VITE_CREDENTIAL_REGISTRY_ADDRESS',
    import.meta.env.VITE_CREDENTIAL_REGISTRY_ADDRESS,
  ),
  custodyTransfer: contractAddress(
    'VITE_CUSTODY_TRANSFER_ADDRESS',
    import.meta.env.VITE_CUSTODY_TRANSFER_ADDRESS,
  ),
  evidenceRegistry: contractAddress(
    'VITE_EVIDENCE_REGISTRY_ADDRESS',
    import.meta.env.VITE_EVIDENCE_REGISTRY_ADDRESS,
  ),
  ingredientRegistry: contractAddress(
    'VITE_INGREDIENT_REGISTRY_ADDRESS',
    import.meta.env.VITE_INGREDIENT_REGISTRY_ADDRESS,
  ),
  productRegistry: contractAddress(
    'VITE_PRODUCT_REGISTRY_ADDRESS',
    import.meta.env.VITE_PRODUCT_REGISTRY_ADDRESS,
  ),
  stakeholderRegistry: contractAddress(
    'VITE_STAKEHOLDER_REGISTRY_ADDRESS',
    import.meta.env.VITE_STAKEHOLDER_REGISTRY_ADDRESS,
  ),
} as const;
