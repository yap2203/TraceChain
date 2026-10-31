import { ZeroAddress, getAddress } from 'ethers';
import { z } from 'zod';

const ssiBootstrapEnvironmentSchema = z.object({
  BOOTSTRAP_ADMIN_WALLET: z.string().refine((value) => {
    try {
      return getAddress(value) !== ZeroAddress;
    } catch {
      return false;
    }
  }, 'BOOTSTRAP_ADMIN_WALLET must be a non-zero Ethereum address'),
  SEPOLIA_RPC_URL: z.string().url(),
  TRACECHAIN_AUTHORITY_DID_ALIAS: z.string().min(1),
  VERAMO_KMS_SECRET_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, 'VERAMO_KMS_SECRET_KEY must be a 32-byte hexadecimal key'),
});

/** SSI variables are validated only when an SSI/bootstrap command explicitly calls this function. */
export function loadSsiBootstrapEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = ssiBootstrapEnvironmentSchema.parse(environment);
  return {
    adminWalletAddress: getAddress(parsed.BOOTSTRAP_ADMIN_WALLET),
    authorityDidAlias: parsed.TRACECHAIN_AUTHORITY_DID_ALIAS,
    kmsSecretKey: parsed.VERAMO_KMS_SECRET_KEY,
    rpcUrl: parsed.SEPOLIA_RPC_URL,
  };
}
