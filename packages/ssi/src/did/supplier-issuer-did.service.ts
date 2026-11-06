import { getAddress } from 'ethers';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import { createOrGetAuthorityDid } from './authority-did.service.js';

export async function createOrGetSupplierIssuerDid(agent: TraceChainAgent, supplierWallet: string) {
  const wallet = getAddress(supplierWallet);
  const alias = `tracechain-supplier-${wallet.toLowerCase()}`;
  const result = await createOrGetAuthorityDid(agent, alias);
  return { ...result, alias, supplierWallet: wallet };
}
