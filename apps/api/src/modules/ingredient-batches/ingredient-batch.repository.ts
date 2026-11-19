import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EncryptedCredentialPayload } from '../ssi/encrypted-credential.store.js';

export interface IngredientBatchWorkflowRecord {
  operationId?: string;
  certificationDocumentIds?: string[];
  price?: string;
  currency?: string;
  priceBasis?: string;
  batchId: string;
  credentialHash: string;
  credentialId: string;
  encryptedCid: string;
  encryptedPayload: EncryptedCredentialPayload;
  expiresAt: number;
  issuerDid: string;
  metadataHash: string;
  producedAt: number;
  quantity: string;
  supplierWallet: string;
  unit: string;
  credentialFormat?: 'JWT_VC' | 'SD_JWT_VC';
  holderDid?: string;
}

export interface IngredientBatchWorkflowRepository {
  findAttachment?(id: string): Promise<CertificationFileRecord | undefined>;
  saveAttachment?(record: CertificationFileRecord): Promise<void>;
  find(batchId: string): Promise<IngredientBatchWorkflowRecord | undefined>;
  listForSupplier(supplierWallet: string): Promise<IngredientBatchWorkflowRecord[]>;
  save(record: IngredientBatchWorkflowRecord): Promise<void>;
}
export interface CertificationFileRecord {
  id: string;
  operationId: string;
  certificationId: string;
  supplierWallet: string;
  sha256: string;
  cid: string;
  payload: EncryptedCredentialPayload;
}

export class JsonIngredientBatchWorkflowRepository implements IngredientBatchWorkflowRepository {
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}
  async findAttachment(id: string): Promise<CertificationFileRecord | undefined> {
    return (await this.attachments())[id];
  }
  private async attachments(): Promise<Record<string, CertificationFileRecord>> {
    try {
      return JSON.parse(await readFile(this.filePath + '.attachments', 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  async saveAttachment(record: CertificationFileRecord) {
    const operation = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const state = await this.attachments();
        if (
          state[record.id] &&
          (state[record.id]!.sha256 !== record.sha256 ||
            state[record.id]!.supplierWallet !== record.supplierWallet)
        )
          throw new Error('Document ID already used.');
        state[record.id] = record;
        await mkdir(dirname(this.filePath), { recursive: true });
        const temp = this.filePath + '.attachments.' + randomUUID() + '.tmp';
        await writeFile(temp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
        await rename(temp, this.filePath + '.attachments');
      });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  async find(batchId: string) {
    return (await this.read())[batchId.toLowerCase()];
  }

  async listForSupplier(supplierWallet: string) {
    return Object.values(await this.read()).filter(
      (record) => record.supplierWallet.toLowerCase() === supplierWallet.toLowerCase(),
    );
  }

  async save(record: IngredientBatchWorkflowRecord) {
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const state = await this.read();
        const current = state[record.batchId.toLowerCase()];
        if (current && current.credentialId !== record.credentialId) {
          throw new Error('A different workflow already exists for this ingredient batch.');
        }
        state[record.batchId.toLowerCase()] = record;
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

  private async read(): Promise<Record<string, IngredientBatchWorkflowRecord>> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as Record<
        string,
        IngredientBatchWorkflowRecord
      >;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}
