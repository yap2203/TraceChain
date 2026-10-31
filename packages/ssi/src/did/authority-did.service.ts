import type { IIdentifier } from '@veramo/core';

import { TRACECHAIN_ETHR_PROVIDER, type TraceChainAgent } from '../agent/tracechain-agent.js';

export interface AuthorityDidResult {
  created: boolean;
  identifier: IIdentifier;
}

export async function createOrGetAuthorityDid(
  agent: TraceChainAgent,
  alias: string,
): Promise<AuthorityDidResult> {
  const existing = await agent.didManagerFind({ alias, provider: TRACECHAIN_ETHR_PROVIDER });
  if (existing[0]) return { created: false, identifier: existing[0] };

  const identifier = await agent.didManagerCreate({
    alias,
    kms: 'local',
    options: { keyType: 'Secp256k1' },
    provider: TRACECHAIN_ETHR_PROVIDER,
  });

  return { created: true, identifier };
}
