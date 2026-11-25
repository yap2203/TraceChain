import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventLog, Log, type BaseContract, type Provider } from 'ethers';
import { countRead } from './read-timing.js';

const DEFAULT_PAGE_SIZE = 5_000;
const deploymentBlocks = new WeakMap<Provider, Map<string, Promise<number>>>();
const contractIndexes = new WeakMap<Provider, Map<string, ContractIndex>>();

/** Plain, JSON-safe copy of a confirmed log; public chain data only. */
interface StoredLog {
  address: string;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  index: number;
  data: string;
  topics: string[];
  removed: boolean;
}

/** One index per contract: every event type shares the same paged scan. */
interface ContractIndex {
  checkpointHash?: string;
  fromBlock: number;
  lastProcessedBlock: number;
  logs: StoredLog[];
  pending?: Promise<void>;
  restored?: Promise<void>;
  saving?: Promise<void>;
}

let storeDirectory: string | undefined;

/** Enables the on-disk index so API restarts do not rescan history. Unset keeps it in memory. */
export function configureEventIndexStore(directory: string | undefined) {
  storeDirectory = directory;
}

/**
 * Read complete confirmed event history through an incremental per-contract index.
 * All filters on a contract share one scan; matching happens locally on the stored topics.
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
  const key = `${network.chainId}-${address.toLowerCase()}-${fromBlock}`;
  let providerIndexes = contractIndexes.get(provider);
  if (!providerIndexes) contractIndexes.set(provider, (providerIndexes = new Map()));
  let index = providerIndexes.get(key);
  if (!index) {
    index = { fromBlock, lastProcessedBlock: fromBlock - 1, logs: [] };
    if (!local && storeDirectory) index.restored = restoreIndex(index, key, storeDirectory);
    providerIndexes.set(key, index);
  }
  await index.restored;
  if (!index.pending) {
    const operation = refreshContractIndex(contract, provider, index, confirmedHead, local, key);
    index.pending = operation;
    void operation.then(
      () => clearPending(index, operation),
      () => clearPending(index, operation),
    );
  }
  await index.pending;
  return matchingEvents(contract, provider, index.logs, await topicFilter(event));
}

function clearPending(index: ContractIndex, operation: Promise<void>) {
  if (index.pending === operation) index.pending = undefined;
}

async function latestBlockNumber(provider: Provider) {
  const transport = provider as Provider & {
    send?: (method: string, params: unknown[]) => Promise<unknown>;
  };
  if (transport.send) return Number(BigInt(String(await transport.send('eth_blockNumber', []))));
  return provider.getBlockNumber();
}

async function refreshContractIndex(
  contract: BaseContract,
  provider: Provider,
  index: ContractIndex,
  confirmedHead: number,
  local: boolean,
  key: string,
) {
  if (confirmedHead < index.lastProcessedBlock) resetIndex(index);
  if (index.lastProcessedBlock >= index.fromBlock && index.checkpointHash) {
    const checkpoint = await provider.getBlock(index.lastProcessedBlock);
    if (!checkpoint?.hash || checkpoint.hash !== index.checkpointHash) resetIndex(index);
  }
  if (confirmedHead < index.fromBlock) return;
  const start = Math.max(index.fromBlock, index.lastProcessedBlock + 1);
  if (start > confirmedHead) return;
  const pageSize = integerEnvironment('CHAIN_EVENT_PAGE_SIZE', DEFAULT_PAGE_SIZE, 1, 100_000);
  const additions: StoredLog[] = [];
  for (let pageStart = start; pageStart <= confirmedHead; pageStart += pageSize) {
    countRead('scans');
    const page = await contract.queryFilter(
      '*',
      pageStart,
      Math.min(pageStart + pageSize - 1, confirmedHead),
    );
    additions.push(...page.map(storedLog));
  }
  const checkpoint = await provider.getBlock(confirmedHead);
  if (!checkpoint?.hash && !local)
    throw new Error('The RPC provider did not return a confirmed block hash.');
  index.logs = deduplicateLogs([...index.logs, ...additions]);
  index.lastProcessedBlock = confirmedHead;
  index.checkpointHash = checkpoint?.hash ?? `local:${confirmedHead}`;
  if (!local && storeDirectory) persistIndex(index, key, storeDirectory);
}

function storedLog(log: Log | EventLog): StoredLog {
  return {
    address: log.address,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    index: log.index,
    data: log.data,
    topics: [...(log.topics ?? [])],
    removed: Boolean(log.removed),
  };
}

async function topicFilter(event: Parameters<BaseContract['queryFilter']>[0]) {
  const candidate = event as unknown as {
    getTopicFilter?: () => Promise<Array<null | string | string[]>>;
    topics?: Array<null | string | string[]>;
  };
  return candidate.getTopicFilter ? await candidate.getTopicFilter() : (candidate.topics ?? []);
}

function sameTopic(left: string | undefined, right: string) {
  return !!left && left.toLowerCase() === right.toLowerCase();
}

function matchingEvents(
  contract: BaseContract,
  provider: Provider,
  logs: StoredLog[],
  filter: Array<null | string | string[]>,
) {
  return logs
    .filter((log) =>
      filter.every((expected, position) =>
        expected == null
          ? true
          : Array.isArray(expected)
            ? expected.some((topic) => sameTopic(log.topics[position], topic))
            : sameTopic(log.topics[position], expected),
      ),
    )
    .map((stored) => {
      const log = new Log(stored as never, provider);
      // Mirrors ethers' queryFilter: undecodable logs are returned as plain logs.
      try {
        const fragment = contract.interface.getEvent(stored.topics[0]!);
        return fragment ? new EventLog(log, contract.interface, fragment) : log;
      } catch {
        return log;
      }
    });
}

async function restoreIndex(index: ContractIndex, key: string, directory: string) {
  try {
    const saved = JSON.parse(await readFile(indexFile(directory, key), 'utf8')) as Partial<
      ContractIndex & { version: number }
    >;
    if (
      saved.version !== 1 ||
      saved.fromBlock !== index.fromBlock ||
      !Number.isSafeInteger(saved.lastProcessedBlock) ||
      typeof saved.checkpointHash !== 'string' ||
      !Array.isArray(saved.logs)
    )
      return;
    // The checkpoint is re-verified against the chain before the next scan; a reorg rebuilds.
    index.lastProcessedBlock = saved.lastProcessedBlock!;
    index.checkpointHash = saved.checkpointHash;
    index.logs = saved.logs;
  } catch {
    // Missing or unreadable files rebuild from the chain.
  }
}

function persistIndex(index: ContractIndex, key: string, directory: string) {
  const snapshot = JSON.stringify({
    version: 1,
    fromBlock: index.fromBlock,
    lastProcessedBlock: index.lastProcessedBlock,
    checkpointHash: index.checkpointHash,
    logs: index.logs,
  });
  index.saving = (index.saving ?? Promise.resolve())
    .then(async () => {
      const file = indexFile(directory, key);
      await mkdir(join(directory, 'event-index'), { recursive: true });
      await writeFile(`${file}.tmp`, snapshot);
      await rename(`${file}.tmp`, file);
    })
    .catch(() => {
      // A failed save only costs a rescan after the next restart.
    });
}

function indexFile(directory: string, key: string) {
  return join(directory, 'event-index', `${key}.json`);
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

function deduplicateLogs(logs: StoredLog[]) {
  const seen = new Set<string>();
  return logs
    .sort((left, right) =>
      left.blockNumber === right.blockNumber
        ? left.index - right.index
        : left.blockNumber - right.blockNumber,
    )
    .filter((log) => {
      const key = `${log.blockHash}:${log.transactionHash}:${log.index}:${log.blockNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function resetIndex(index: ContractIndex) {
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
