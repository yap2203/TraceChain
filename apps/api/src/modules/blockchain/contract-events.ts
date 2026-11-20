import type { BaseContract, Provider } from 'ethers';

const PAGE_SIZE = 5_000;
const deploymentBlocks = new WeakMap<Provider, Map<string, Promise<number>>>();

/** Read the complete event history without requesting a public chain from genesis. */
export async function queryContractEvents(
  contract: BaseContract,
  event: Parameters<BaseContract['queryFilter']>[0],
) {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error('A blockchain provider is required to read contract events.');
  const latest = await provider.getBlockNumber();
  // Development chains reset at the same addresses: never cache their deployment block.
  const local = (await provider.getNetwork()).chainId === 31337n;
  const address = await contract.getAddress();
  let from = 0;
  const configuredStart = process.env.CHAIN_EVENT_START_BLOCK?.trim();
  if (!local && configuredStart) {
    from = Number(configuredStart);
    if (!/^\d+$/.test(configuredStart) || !Number.isSafeInteger(from) || from > latest) {
      throw new Error(
        'CHAIN_EVENT_START_BLOCK must be a valid block at or before the current chain head.',
      );
    }
  } else if (!local) {
    let cache = deploymentBlocks.get(provider);
    if (!cache) deploymentBlocks.set(provider, (cache = new Map()));
    let lookup = cache.get(address);
    if (!lookup) {
      lookup = findDeploymentBlock(provider, address, latest);
      cache.set(address, lookup);
      // Failed RPC lookups must be retryable after the service recovers.
      void lookup.catch(() => {
        if (cache.get(address) === lookup) cache.delete(address);
      });
    }
    from = await lookup;
  }
  const logs: Awaited<ReturnType<BaseContract['queryFilter']>> = [];
  for (let start = from; start <= latest; start += PAGE_SIZE) {
    logs.push(
      ...(await contract.queryFilter(event, start, Math.min(start + PAGE_SIZE - 1, latest))),
    );
  }
  return logs;
}

async function findDeploymentBlock(provider: Provider, address: string, latest: number) {
  if ((await provider.getCode(address, latest)) === '0x') {
    throw new Error('The configured event contract is not deployed on this network.');
  }
  // Current registries are immutable, non-proxy contracts with no self-destruct.
  // Their code first appears in their creation block. Cache only that lower bound,
  // never event results, so subsequent requests still read new chain events.
  let low = 0;
  let high = latest;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((await provider.getCode(address, middle)) === '0x') low = middle + 1;
    else high = middle;
  }
  return low;
}
