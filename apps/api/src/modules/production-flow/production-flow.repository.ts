import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EncryptedCredentialPayload } from '../ssi/encrypted-credential.store.js';

export interface EvidenceWorkflowRecord {
  batchId: string;
  challengeHash: string;
  claimsHash: string;
  dueAt: number;
  operationId: string;
  requestCid: string;
  requestId: string;
  requestPayload: EncryptedCredentialPayload;
  requester: string;
  supplier: string;
  identityProof?: {
    audience: string;
    challenge: string;
    expiresAt: number;
    presenterRole: string;
    presenterWallet: string;
    purpose: string;
    status: 'REQUESTED' | 'PRESENTED' | 'VERIFIED' | 'DECLINED';
    presentationPayload?: EncryptedCredentialPayload;
    verifiedAt?: string;
  };
  response?: {
    credentialId: string;
    presentationCid: string;
    presentationExpiresAt: number;
    presentationHash: string;
    presentationPayload: EncryptedCredentialPayload;
    verification?: {
      state: 'PASSED';
      verifiedAt: string;
    };
  };
}

export interface PrivateWorkflowRecord {
  cid: string;
  id: string;
  owner: string;
  operationHash?: string;
  payload: EncryptedCredentialPayload;
  contentHash: string;
}

interface WorkflowState {
  evidence: Record<string, EvidenceWorkflowRecord>;
  products: Record<string, PrivateWorkflowRecord>;
  transfers: Record<string, PrivateWorkflowRecord>;
}

export interface ProductionFlowRepository {
  findEvidence(requestId: string): Promise<EvidenceWorkflowRecord | undefined>;
  findEvidenceByOperation(
    operationId: string,
    requester: string,
  ): Promise<EvidenceWorkflowRecord | undefined>;
  saveEvidence(record: EvidenceWorkflowRecord): Promise<void>;
  findPrivate(
    kind: 'products' | 'transfers',
    id: string,
  ): Promise<PrivateWorkflowRecord | undefined>;
  savePrivate(kind: 'products' | 'transfers', record: PrivateWorkflowRecord): Promise<void>;
}

export class ProductionFlowPersistenceError extends Error {
  readonly code = 'WORKFLOW_PERSISTENCE_UNAVAILABLE';

  constructor() {
    super('The persisted production workflow is unavailable or corrupted.');
  }
}

export class JsonProductionFlowRepository implements ProductionFlowRepository {
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async findEvidence(requestId: string) {
    return (await this.read()).evidence[requestId.toLowerCase()];
  }

  async findEvidenceByOperation(operationId: string, requester: string) {
    return Object.values((await this.read()).evidence).find(
      (record) =>
        record.operationId === operationId &&
        record.requester.toLowerCase() === requester.toLowerCase(),
    );
  }

  async saveEvidence(record: EvidenceWorkflowRecord) {
    await this.update((state) => {
      state.evidence[record.requestId.toLowerCase()] = record;
    });
  }

  async findPrivate(kind: 'products' | 'transfers', id: string) {
    return (await this.read())[kind][id.toLowerCase()];
  }

  async savePrivate(kind: 'products' | 'transfers', record: PrivateWorkflowRecord) {
    await this.update((state) => {
      state[kind][record.id.toLowerCase()] = record;
    });
  }

  private async update(change: (state: WorkflowState) => void) {
    this.writeQueue = this.writeQueue.then(async () => {
      const state = await this.read();
      change(state);
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

  private async read(): Promise<WorkflowState> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as WorkflowState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { evidence: {}, products: {}, transfers: {} };
      }
      throw new ProductionFlowPersistenceError();
    }
  }
}
