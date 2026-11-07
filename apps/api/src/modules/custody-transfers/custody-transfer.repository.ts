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
  transferId: string;
}

export interface ReceiptWorkflowRepository {
  find(
    transferId: string,
    kind?: ReceiptWorkflowRecord['kind'],
  ): Promise<ReceiptWorkflowRecord | undefined>;
  list(): Promise<ReceiptWorkflowRecord[]>;
  save(record: ReceiptWorkflowRecord): Promise<void>;
}

export class JsonReceiptWorkflowRepository implements ReceiptWorkflowRepository {
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async find(transferId: string, kind?: ReceiptWorkflowRecord['kind']) {
    const records = Object.values(await this.read()).filter(
      (record) => record.transferId.toLowerCase() === transferId.toLowerCase(),
    );
    if (kind) return records.find((record) => record.kind === kind);
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  async list() {
    return Object.values(await this.read());
  }

  async save(record: ReceiptWorkflowRecord) {
    this.writeQueue = this.writeQueue.then(async () => {
      const state = await this.read();
      state[recordKey(record.transferId, record.kind)] = record;
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
      return JSON.parse(await readFile(this.filePath, 'utf8')) as Record<
        string,
        ReceiptWorkflowRecord
      >;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}

export class InMemoryReceiptWorkflowRepository implements ReceiptWorkflowRepository {
  private readonly records = new Map<string, ReceiptWorkflowRecord>();
  async find(transferId: string, kind?: ReceiptWorkflowRecord['kind']) {
    if (kind) return this.records.get(recordKey(transferId, kind));
    return [...this.records.values()]
      .filter((record) => record.transferId.toLowerCase() === transferId.toLowerCase())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }
  async list() {
    return [...this.records.values()];
  }
  async save(record: ReceiptWorkflowRecord) {
    this.records.set(recordKey(record.transferId, record.kind), record);
  }
}

function recordKey(transferId: string, kind: ReceiptWorkflowRecord['kind']) {
  return `${transferId.toLowerCase()}:${kind}`;
}
