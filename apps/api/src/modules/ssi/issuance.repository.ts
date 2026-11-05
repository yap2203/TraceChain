import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { CompanyRole } from '@tracechain/shared';

import type { EncryptedCredentialPayload } from './encrypted-credential.store.js';

export interface CompanyRoleIssuanceRecord {
  applicantWallet: string;
  applicationId: string;
  companyName: string;
  companyRegistrationNumber: string;
  credentialHash: string;
  credentialId: string;
  encryptedCredentialCid: string;
  encryptedPayload: EncryptedCredentialPayload;
  expiresAt: number;
  issuedAt: string;
  role: CompanyRole;
}

export interface CompanyRoleIssuanceRepository {
  find(applicationId: string): Promise<CompanyRoleIssuanceRecord | undefined>;
  list(): Promise<CompanyRoleIssuanceRecord[]>;
  save(record: CompanyRoleIssuanceRecord): Promise<void>;
}

export class JsonCompanyRoleIssuanceRepository implements CompanyRoleIssuanceRepository {
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async find(applicationId: string) {
    return (await this.read())[applicationId.toLowerCase()];
  }

  async list() {
    return Object.values(await this.read());
  }

  async save(record: CompanyRoleIssuanceRecord) {
    this.writeQueue = this.writeQueue.then(async () => {
      const state = await this.read();
      const key = record.applicationId.toLowerCase();
      if (state[key] && state[key].credentialId !== record.credentialId) {
        throw new Error('An issuance workflow already exists for this application.');
      }
      state[key] = record;
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    await this.writeQueue;
  }

  private async read(): Promise<Record<string, CompanyRoleIssuanceRecord>> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as Record<string, CompanyRoleIssuanceRecord>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}
