import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventLog, Log, type BaseContract, type Provider } from 'ethers';
import { countRead } from './read-timing.js';
import { isLogRangeLimit, RpcServiceUnavailableError } from './rpc-provider.js';

const DEFAULT_PAGE_SIZE = 5_000;
const deploymentBlocks = new WeakMap<Provider, Map<string, Promise<number>>>();
const scanners = new WeakMap<Provider, ProviderScanner>();

/** All contract indexes on one provider advance together through one multi-address log scan. */
interface ProviderScanner {
  indexes: Map<string, ContractIndex>;
  head?: { at: number; value: Promise<number> };
  scan?: Promise<void>;
}

/** Plain, JSON-safe copy of a confirmed log; public chain data only. */
export interface StoredLog {
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
  address: string;
  key: string;
  local: boolean;
  ready: boolean;
  /** False after a disk restore until its checkpoint is re-checked against the chain. */
  verified: boolean;
  checkpointHash?: string;
  fromBlock: number;
  lastProcessedBlock: number;
  logs: StoredLog[];
  restored?: Promise<void>;
  saving?: Promise<void>;
}

let storeDirectory: string | undefined;

/** scan: newly confirmed logs; restore: the whole index loaded from disk; reset: history dropped. */
export interface EventIndexUpdate {
  key: string;
  kind: 'scan' | 'restore' | 'reset';
  block: number;
  logs: readonly StoredLog[];
}
const indexListeners = new Set<(update: EventIndexUpdate) => void>();

/** Lets read caches drop entries that newly confirmed events touch. */
export function onEventIndexUpdate(listener: (update: EventIndexUpdate) => void) {
  indexListeners.add(listener);
  return () => indexListeners.delete(listener);
}

function notifyIndex(update: EventIndexUpdate) {
  for (const listener of indexListeners)
    try {
      listener(update);
    } catch {
      // A failing cache listener must never break the event index itself.
    }
}

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
  const index = await syncContractEvents(contract);
  return matchingEvents(contract, contract.runner!.provider!, index.logs, await topicFilter(event));
}

/** Brings a contract's index up to the confirmed head without decoding any events. */
export async function syncContractEvents(contract: BaseContract) {
  const provider = contract.runner?.provider;
  if (!provider) throw new Error('A blockchain provider is required to read contract events.');
  let scanner = scanners.get(provider);
  if (!scanner) scanners.set(provider, (scanner = { indexes: new Map() }));
  const [network, address] = await Promise.all([provider.getNetwork(), contract.getAddress()]);
  const local = network.chainId === 31_337n;
  const rawHead = await latestBlockNumber(provider, scanner, local);
  const confirmations = local ? 0 : integerEnvironment('CHAIN_EVENT_CONFIRMATIONS', 2, 0, 1_000);
  const confirmedHead = Math.max(0, rawHead - confirmations);
  const fromBlock = await eventStartBlock(provider, address, rawHead, confirmedHead, local);
  const key = `${network.chainId}-${address.toLowerCase()}-${fromBlock}`;
  let index = scanner.indexes.get(key);
  if (!index) {
    const created: ContractIndex = {
      address: address.toLowerCase(),
      key,
      local,
      ready: false,
      verified: true,
      fromBlock,
      lastProcessedBlock: fromBlock - 1,
      logs: [],
    };
    created.restored = (
      !local && storeDirectory ? restoreIndex(created, key, storeDirectory) : Promise.resolve()
    ).then(() => {
      created.ready = true;
    });
    scanner.indexes.set(key, (index = created));
  }
  await index.restored;
  // Join a running scan when there is one; otherwise start a scan covering every ready index.
  while (!current(index, confirmedHead)) {
    if (!scanner.scan) {
      const operation = scanAll(provider, scanner, confirmedHead);
      scanner.scan = operation;
      void operation.then(
        () => clearScan(scanner, operation),
        () => clearScan(scanner, operation),
      );
    }
    await scanner.scan;
  }
  return index;
}

/** Local chains can restart below the index, so they must match the head exactly. */
function current(index: ContractIndex, confirmedHead: number) {
  if (!index.verified) return false;
  return index.local
    ? index.lastProcessedBlock === confirmedHead
    : index.lastProcessedBlock >= Math.max(confirmedHead, index.fromBlock - 1);
}

function clearScan(scanner: ProviderScanner, operation: Promise<void>) {
  if (scanner.scan === operation) scanner.scan = undefined;
}

/** One head lookup serves every contract for a short window, so a page build asks once. */
async function latestBlockNumber(provider: Provider, scanner: ProviderScanner, local: boolean) {
  const ttl = local ? 0 : integerEnvironment('CHAIN_EVENT_HEAD_CACHE_MS', 3_000, 0, 60_000);
  if (ttl && scanner.head && Date.now() - scanner.head.at < ttl) return scanner.head.value;
  const transport = provider as Provider & {
    send?: (method: string, params: unknown[]) => Promise<unknown>;
  };
  const value = transport.send
    ? transport.send('eth_blockNumber', []).then((raw) => Number(BigInt(String(raw))))
    : provider.getBlockNumber();
  const head = { at: Date.now(), value };
  scanner.head = head;
  void value.catch(() => {
    if (scanner.head === head) scanner.head = undefined;
  });
  return value;
}

async function scanAll(provider: Provider, scanner: ProviderScanner, confirmedHead: number) {
  const members = [...scanner.indexes.values()].filter(
    (index) => index.ready && !current(index, confirmedHead),
  );
  const reset = (index: ContractIndex) => {
    resetIndex(index);
    notifyIndex({ key: index.key, kind: 'reset', block: index.lastProcessedBlock, logs: [] });
  };
  for (const index of members) if (confirmedHead < index.lastProcessedBlock) reset(index);
  // Indexes scanned together share a checkpoint, so one block lookup verifies all of them.
  const checkpoints = new Map<number, Promise<string | null | undefined>>();
  for (const index of members)
    if (index.lastProcessedBlock >= index.fromBlock && index.checkpointHash)
      if (!checkpoints.has(index.lastProcessedBlock))
        checkpoints.set(
          index.lastProcessedBlock,
          provider.getBlock(index.lastProcessedBlock).then((block) => block?.hash),
        );
  for (const index of members)
    if (index.lastProcessedBlock >= index.fromBlock && index.checkpointHash) {
      const hash = await checkpoints.get(index.lastProcessedBlock);
      if (!hash || hash !== index.checkpointHash) reset(index);
    }
  for (const index of members) index.verified = true;
  // Indexes at the same position share one multi-address scan; a newly seen one catches up alone.
  const groups = new Map<number, ContractIndex[]>();
  for (const index of members) {
    const start = Math.max(index.fromBlock, index.lastProcessedBlock + 1);
    if (start > confirmedHead) continue;
    groups.set(start, [...(groups.get(start) ?? []), index]);
  }
  if (!groups.size) return;
  const pageSize = integerEnvironment('CHAIN_EVENT_PAGE_SIZE', DEFAULT_PAGE_SIZE, 1, 100_000);
  // Commit each complete page so a later outage does not discard successful catch-up work.
  for (const [start, indexes] of groups) {
    for (let from = start; from <= confirmedHead; from += pageSize) {
      const to = Math.min(confirmedHead, from + pageSize - 1);
      const logs = await readLogRange(
        provider,
        indexes.map((index) => index.address),
        from,
        to,
      );
      const checkpoint = await provider.getBlock(to);
      if (!checkpoint?.hash && !indexes[0]!.local)
        throw new Error('The RPC provider did not return a confirmed block hash.');
      for (const index of indexes) {
        const additions = logs.filter((log) => log.address.toLowerCase() === index.address);
        index.logs = deduplicateLogs([...index.logs, ...additions]);
        index.lastProcessedBlock = to;
        index.checkpointHash = checkpoint?.hash ?? `local:${to}`;
        notifyIndex({ key: index.key, kind: 'scan', block: to, logs: additions });
        if (!index.local && storeDirectory) persistIndex(index, index.key, storeDirectory);
      }
    }
  }
}

/** Halves a range the provider rejects for returning too many results. */
async function readLogRange(
  provider: Provider,
  addresses: string[],
  from: number,
  to: number,
): Promise<StoredLog[]> {
  countRead('scans');
  try {
    const page = await provider.getLogs({
      address: addresses.length === 1 ? addresses[0] : addresses,
      fromBlock: from,
      toBlock: to,
    });
    return page.map(storedLog);
  } catch (cause) {
    if (to <= from || !isLogRangeLimit(cause))
      throw cause instanceof RpcServiceUnavailableError
        ? cause
        : new RpcServiceUnavailableError(cause);
    const middle = Math.floor((from + to) / 2);
    return [
      ...(await readLogRange(provider, addresses, from, middle)),
      ...(await readLogRange(provider, addresses, middle + 1, to)),
    ];
  }
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
    index.verified = false;
    index.logs = saved.logs;
    notifyIndex({ key, kind: 'restore', block: index.lastProcessedBlock, logs: index.logs });
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
