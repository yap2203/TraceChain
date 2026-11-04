import { getAddress } from 'ethers';
import { z } from 'zod';

const blockchainEnvironmentSchema = z.object({
  CHAIN_RPC_URL: z.string().url(),
  STAKEHOLDER_REGISTRY_ADDRESS: z.string().transform((value, context) => {
    try {
      return getAddress(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Must be a valid Ethereum address' });
      return z.NEVER;
    }
  }),
});

export function loadBlockchainEnvironment() {
  return blockchainEnvironmentSchema.parse(process.env);
}
