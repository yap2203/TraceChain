import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  onEventIndexUpdate,
  type EventIndexUpdate,
  type StoredLog,
} from '../blockchain/contract-events.js';
import type { ChainRecord, OrdersGateway } from './orders.gateway.js';

/**
 * Local read model for order pages: public contract view results kept in memory (and in one
 * JSON file) and dropped only when a newly confirmed event names one of their identifiers.
 * Private payloads never pass through here; writes and checks always read the live chain.
 */

// shortcut: on-chain views that change with time alone (no event) can lag up to this; lower it if one does.
const MAX_AGE_MS = 10 * 60_000;
const SYNC_INTERVAL_MS = 5_000;
const SAVE_DELAY_MS = 1_000;

interface Entry {
  value: unknown;
  at: number;
  /** Identifier words (32-byte hex) in the call arguments; none means any new event drops it. */
  args: string[];
  /** bytes32 identifiers in the result, so a dropped transfer also drops reads about its batch. */
  results: string[];
}

const entries = new Map<string, Entry>();
const indexBlocks: Record<string, number> = {};
let epoch = 0;
let storeFile: string | undefined;
let scope: string | undefined;
let saveTimer: NodeJS.Timeout | undefined;

onEventIndexUpdate(applyIndexUpdate);

/** Loads the saved read model; call once at startup, before any event index is opened. */
export function configureReadModelStore(directory: string | undefined) {
  storeFile = directory ? join(directory, 'read-model', 'orders.json') : undefined;
  if (!storeFile) return;
  try {
    const saved = JSON.parse(readFileSync(storeFile, 'utf8'));
    if (saved.version !== 1 || typeof saved.scope !== 'string') return;
    scope = saved.scope;
    Object.assign(indexBlocks, saved.indexBlocks);
    for (const [key, entry] of saved.entries) entries.set(key, entry);
  } catch {
    // Missing or unreadable files rebuild from the chain.
  }
}

export function clearReadModel() {
  entries.clear();
  for (const key of Object.keys(indexBlocks)) delete indexBlocks[key];
  epoch++;
  scheduleSave();
}

/** Exported for tests; production updates arrive from the event index listener. */
export function applyIndexUpdate({ key, kind, block, logs }: EventIndexUpdate) {
  if (kind === 'reset') {
    entries.clear();
    epoch++;
    delete indexBlocks[key];
    return scheduleSave();
  }
  const known = indexBlocks[key];
  indexBlocks[key] = block;
  if (kind === 'restore') {
    // Entries saved before this index was ever seen cannot be checked against it.
    if (known === undefined) {
      if (entries.size) {
        entries.clear();
        epoch++;
      }
      return scheduleSave();
    }
    logs = logs.filter((log) => log.blockNumber > known);
  }
  if (logs.length) invalidate(logs);
  scheduleSave();
}

function invalidate(logs: readonly StoredLog[]) {
  epoch++; // reads still in flight may predate these events, so they are not stored
  const words = new Set<string>();
  for (const log of logs) {
    for (const topic of log.topics.slice(1)) words.add(topic.toLowerCase());
    for (let at = 2; at + 64 <= log.data.length; at += 64)
      words.add(`0x${log.data.slice(at, at + 64).toLowerCase()}`);
  }
  const related = new Set<string>();
  for (const [key, entry] of entries)
    if (!entry.args.length || entry.args.some((word) => words.has(word))) {
      entries.delete(key);
      for (const word of entry.results) related.add(word);
    }
  for (const [key, entry] of entries)
    if (entry.args.some((word) => related.has(word))) entries.delete(key);
}

function scheduleSave() {
  if (!storeFile || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    const file = storeFile!;
    try {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(
        `${file}.tmp`,
        JSON.stringify({ version: 1, scope, indexBlocks, entries: [...entries] }),
      );
      renameSync(`${file}.tmp`, file);
    } catch {
      // A failed save only costs re-reading after the next restart.
    }
  }, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

function identifier(value: unknown) {
  if (typeof value !== 'string') return undefined;
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  if (/^0x[0-9a-fA-F]{40}$/.test(value))
    return `0x${'0'.repeat(24)}${value.slice(2).toLowerCase()}`;
  return undefined;
}

function resultIdentifiers(value: unknown, found = new Set<string>()) {
  if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value))
    found.add(value.toLowerCase());
  else if (value && typeof value === 'object')
    for (const child of Object.values(value)) resultIdentifiers(child, found);
  return found;
}

type Mode = 'cached' | 'refresh';

/** Wraps the live gateway; only reads inside display() use the read model. */
export class ReadModelGateway implements OrdersGateway {
  private mode = new AsyncLocalStorage<Mode>();
  private inflight = new Map<string, Promise<unknown>>();
  private synced?: { at: number; promise: Promise<void> };

  constructor(private inner: OrdersGateway & { syncEvents(): Promise<void> }) {
    const current = `${inner.chainId}:${inner.address.toLowerCase()}`;
    if (scope !== current) {
      if (scope !== undefined) clearReadModel();
      scope = current;
    }
  }
  get chainId() {
    return this.inner.chainId;
  }
  get address() {
    return this.inner.address;
  }
  assertDeployment() {
    return this.inner.assertDeployment?.() ?? Promise.resolve();
  }
  events(contract: string, event: string): Promise<ChainRecord[]> {
    return this.inner.events(contract, event);
  }
  prepare(actor: string, contract: string, method: string, args: unknown[]) {
    return this.inner.prepare(actor, contract, method, args);
  }

  async display<T>(build: () => Promise<T>, refresh = false): Promise<T> {
    try {
      await this.sync();
    } catch {
      return build(); // cannot confirm the cache is current, so read the live chain
    }
    return this.mode.run(refresh ? 'refresh' : 'cached', build);
  }

  private sync() {
    if (!this.synced || Date.now() - this.synced.at > SYNC_INTERVAL_MS) {
      const promise = this.inner.syncEvents();
      this.synced = { at: Date.now(), promise };
      promise.catch(() => {
        if (this.synced?.promise === promise) this.synced = undefined;
      });
    }
    return this.synced.promise;
  }

  async read(contract: string, method: string, args: unknown[] = []) {
    const mode = this.mode.getStore();
    if (!mode) return this.inner.read(contract, method, args);
    const key = `${contract}.${method}:${JSON.stringify(args, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    )}`;
    const entry = entries.get(key);
    if (mode === 'cached' && entry && Date.now() - entry.at < MAX_AGE_MS)
      return structuredClone(entry.value);
    let pending = mode === 'cached' ? this.inflight.get(key) : undefined;
    if (!pending) {
      const started = epoch;
      const read = this.inner.read(contract, method, args).then((value) => {
        if (started === epoch) {
          entries.set(key, {
            value,
            at: Date.now(),
            args: args.map(identifier).filter((word): word is string => !!word),
            results: [...resultIdentifiers(value)],
          });
          scheduleSave();
        }
        return value;
      });
      pending = read;
      this.inflight.set(key, read);
      void read.then(
        () => this.inflight.get(key) === read && this.inflight.delete(key),
        () => this.inflight.get(key) === read && this.inflight.delete(key),
      );
    }
    return structuredClone(await pending);
  }
}
