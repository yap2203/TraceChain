import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EncryptedCredentialPayload } from '../ssi/encrypted-credential.store.js';

export interface ReceiptWorkflowRecord {
  actor: string;
  cid: string;
  contentHash: string;
  createdAt: string;
  kind: 'DISCREPANCY' | 'RECEIPT' | 'REJECTION';
  payload: EncryptedCredentialPayload;
  schemaVersion: 1 | 2;
  transferId: string;
}

export interface ReceiptWorkflowReference {
  cid?: string;
  contentHash: string;
  kind: ReceiptWorkflowRecord['kind'];
  transferId: string;
}

export interface ReceiptWorkflowRepository {
  find(reference: ReceiptWorkflowReference): Promise<ReceiptWorkflowRecord | undefined>;
  list(): Promise<ReceiptWorkflowRecord[]>;
  save(record: ReceiptWorkflowRecord): Promise<void>;
}

export class ReceiptWorkflowPersistenceError extends Error {
  readonly code = 'RECEIPT_PERSISTENCE_UNAVAILABLE';

  constructor() {
    super('The persisted receipt workflow is unavailable or corrupted.');
  }
}

export class JsonReceiptWorkflowRepository implements ReceiptWorkflowRepository {
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async find(reference: ReceiptWorkflowReference) {
    return Object.values(await this.read()).find((record) => matches(record, reference));
  }

  async list() {
    return Object.values(await this.read());
  }

  async save(record: ReceiptWorkflowRecord) {
    this.writeQueue = this.writeQueue.then(async () => {
      const state = await this.read();
      state[recordKey(record)] = record;
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.filePath);
    });
    await this.writeQueue;
  }

  private async read(): Promise<Record<string, ReceiptWorkflowRecord>> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as Record<
        string,
        Omit<ReceiptWorkflowRecord, 'schemaVersion'> & { schemaVersion?: 1 | 2 }
      >;
      return Object.fromEntries(
        Object.entries(parsed).map(([key, record]) => [
          key,
          { ...record, schemaVersion: record.schemaVersion === 2 ? 2 : 1 },
        ]),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new ReceiptWorkflowPersistenceError();
    }
  }
}

export class InMemoryReceiptWorkflowRepository implements ReceiptWorkflowRepository {
  private readonly records = new Map<string, ReceiptWorkflowRecord>();
  async find(reference: ReceiptWorkflowReference) {
    return [...this.records.values()].find((record) => matches(record, reference));
  }
  async list() {
    return [...this.records.values()];
  }
  async save(record: ReceiptWorkflowRecord) {
    this.records.set(recordKey(record), record);
  }
}

function recordKey(record: ReceiptWorkflowRecord) {
  return `${record.transferId.toLowerCase()}:${record.kind}:${record.contentHash.toLowerCase()}`;
}

function matches(record: ReceiptWorkflowRecord, reference: ReceiptWorkflowReference) {
  return (
    record.transferId.toLowerCase() === reference.transferId.toLowerCase() &&
    record.kind === reference.kind &&
    record.contentHash.toLowerCase() === reference.contentHash.toLowerCase() &&
    (reference.cid === undefined || record.cid === reference.cid)
  );
}
