import type { BaseContract, EventLog, Log, Provider } from 'ethers';
import { countRead } from './read-timing.js';

const DEFAULT_PAGE_SIZE = 5_000;
const deploymentBlocks = new WeakMap<Provider, Map<string, Promise<number>>>();
const eventIndexes = new WeakMap<Provider, Map<string, EventIndex>>();

interface EventIndex {
  checkpointHash?: string;
  fromBlock: number;
  lastProcessedBlock: number;
  logs: Array<EventLog | Log>;
  pending?: Promise<Array<EventLog | Log>>;
}

/**
 * Read complete confirmed event history through an incremental process-local index.
 * A restart safely rebuilds the index; later requests fetch only newly confirmed blocks.
 */
export async function queryContractEvents(
  contract: BaseContract,
  event: Parameters<BaseContract['queryFilter']>[0],
) {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error('A blockchain provider is required to read contract events.');
  const [rawHead, network, address] = await Promise.all([
    latestBlockNumber(provider),
    provider.getNetwork(),
    contract.getAddress(),
  ]);
  const local = network.chainId === 31_337n;
  const confirmations = local ? 0 : integerEnvironment('CHAIN_EVENT_CONFIRMATIONS', 2, 0, 1_000);
  const confirmedHead = Math.max(0, rawHead - confirmations);
  const fromBlock = await eventStartBlock(provider, address, rawHead, confirmedHead, local);
  const key = `${network.chainId}:${address.toLowerCase()}:${fromBlock}:${await filterKey(event)}`;
  let providerIndexes = eventIndexes.get(provider);
  if (!providerIndexes) eventIndexes.set(provider, (providerIndexes = new Map()));
  let index = providerIndexes.get(key);
  if (!index) {
    index = { fromBlock, lastProcessedBlock: fromBlock - 1, logs: [] };
    providerIndexes.set(key, index);
  }
  if (index.pending) return index.pending;
  const operation = refreshEventIndex(contract, event, provider, index, confirmedHead, local);
  index.pending = operation;
  try {
    return await operation;
  } finally {
    if (index.pending === operation) index.pending = undefined;
  }
}

async function latestBlockNumber(provider: Provider) {
  const transport = provider as Provider & {
    send?: (method: string, params: unknown[]) => Promise<unknown>;
  };
  if (transport.send) return Number(BigInt(String(await transport.send('eth_blockNumber', []))));
  return provider.getBlockNumber();
}

async function refreshEventIndex(
  contract: BaseContract,
  event: Parameters<BaseContract['queryFilter']>[0],
  provider: Provider,
  index: EventIndex,
  confirmedHead: number,
  local: boolean,
) {
  if (confirmedHead < index.lastProcessedBlock) resetIndex(index);
  if (index.lastProcessedBlock >= index.fromBlock && index.checkpointHash) {
    const checkpoint = await provider.getBlock(index.lastProcessedBlock);
    if (!checkpoint?.hash || checkpoint.hash !== index.checkpointHash) resetIndex(index);
  }
  if (confirmedHead < index.fromBlock) return [...index.logs];
  const start = Math.max(index.fromBlock, index.lastProcessedBlock + 1);
  if (start > confirmedHead) return [...index.logs];
  const pageSize = integerEnvironment('CHAIN_EVENT_PAGE_SIZE', DEFAULT_PAGE_SIZE, 1, 100_000);
  const additions: Array<EventLog | Log> = [];
  for (let pageStart = start; pageStart <= confirmedHead; pageStart += pageSize) {
    countRead('scans');
    additions.push(
      ...(await contract.queryFilter(
        event,
        pageStart,
        Math.min(pageStart + pageSize - 1, confirmedHead),
      )),
    );
  }
  const checkpoint = await provider.getBlock(confirmedHead);
  if (!checkpoint?.hash && !local)
    throw new Error('The RPC provider did not return a confirmed block hash.');
  index.logs = deduplicateLogs([...index.logs, ...additions]);
  index.lastProcessedBlock = confirmedHead;
  index.checkpointHash = checkpoint?.hash ?? `local:${confirmedHead}`;
  return [...index.logs];
}

async function eventStartBlock(
  provider: Provider,
  address: string,
  rawHead: number,
  confirmedHead: number,
  local: boolean,
) {
  if (local) return 0;
  const configuredStart = process.env.CHAIN_EVENT_START_BLOCK?.trim();
  if (configuredStart) {
    const from = Number(configuredStart);
    if (!/^\d+$/.test(configuredStart) || !Number.isSafeInteger(from) || from > rawHead)
      throw new Error(
        'CHAIN_EVENT_START_BLOCK must be a valid block at or before the current chain head.',
      );
    return from;
  }
  let cache = deploymentBlocks.get(provider);
  if (!cache) deploymentBlocks.set(provider, (cache = new Map()));
  let lookup = cache.get(address);
  if (!lookup) {
    lookup = findDeploymentBlock(provider, address, confirmedHead);
    cache.set(address, lookup);
    void lookup.catch(() => {
      if (cache.get(address) === lookup) cache.delete(address);
    });
  }
  return lookup;
}

async function findDeploymentBlock(provider: Provider, address: string, latest: number) {
  if ((await provider.getCode(address, latest)) === '0x')
    throw new Error('The configured event contract is not deployed on this network.');
  let low = 0;
  let high = latest;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((await provider.getCode(address, middle)) === '0x') low = middle + 1;
    else high = middle;
  }
  return low;
}

async function filterKey(event: Parameters<BaseContract['queryFilter']>[0]) {
  const candidate = event as unknown as {
    args?: unknown[];
    fragment?: { topicHash?: string };
    getTopicFilter?: () => Promise<unknown[]>;
    topics?: unknown[];
  };
  const topics = candidate.getTopicFilter
    ? await candidate.getTopicFilter()
    : (candidate.args ?? candidate.topics ?? []);
  return JSON.stringify([candidate.fragment?.topicHash ?? String(event), topics]);
}

function deduplicateLogs(logs: Array<EventLog | Log>) {
  const seen = new Set<string>();
  return logs
    .sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? Number(left.index ?? 0) - Number(right.index ?? 0)
        : left.blockNumber - right.blockNumber,
    )
    .filter((log) => {
      const key = `${log.blockHash ?? ''}:${log.transactionHash ?? ''}:${log.index ?? ''}:${log.blockNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resetIndex(index: EventIndex) {
  index.checkpointHash = undefined;
  index.lastProcessedBlock = index.fromBlock - 1;
  index.logs = [];
}

function integerEnvironment(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}
