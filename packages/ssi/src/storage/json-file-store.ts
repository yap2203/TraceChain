import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { VeramoJsonCache, VeramoJsonStore } from '@veramo/data-store-json';

type PersistedJsonStore = Omit<VeramoJsonStore, 'notifyUpdate'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadJson(filePath: string): Promise<PersistedJsonStore> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error(`Veramo store must contain a JSON object: ${filePath}`);
    return parsed as PersistedJsonStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function serializableSnapshot(value: Partial<VeramoJsonCache>): PersistedJsonStore {
  return JSON.parse(JSON.stringify(value)) as PersistedJsonStore;
}

async function replaceFileAtomically(filePath: string, data: PersistedJsonStore): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

/**
 * Loads a Veramo JSON tree and persists every mutation in order. Writing a complete
 * temporary file before rename prevents readers from observing a partially written tree.
 */
export async function createAtomicJsonStore(filePath: string): Promise<VeramoJsonStore> {
  const state = await loadJson(filePath);
  let pendingWrite = Promise.resolve();

  const store: VeramoJsonStore = {
    ...state,
    notifyUpdate: async (_oldState, newState) => {
      const snapshot = serializableSnapshot(newState);
      pendingWrite = pendingWrite.then(() => replaceFileAtomically(filePath, snapshot));
      await pendingWrite;
    },
  };

  return store;
}
