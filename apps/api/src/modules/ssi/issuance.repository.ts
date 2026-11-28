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
  registrationCountry?: string;
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

export class IssuanceJournalError extends Error {
  readonly code = 'ISSUANCE_JOURNAL_UNAVAILABLE';

  constructor(cause?: unknown) {
    super(
      'The company credential issuance journal is unreadable. Ask the API operator to restore it before retrying.',
      { cause },
    );
  }
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
    const write = this.writeQueue.then(async () => {
      const state = await this.read();
      const key = record.applicationId.toLowerCase();
      if (state[key] && state[key].credentialId !== record.credentialId) {
        throw new Error('An issuance workflow already exists for this application.');
      }
      state[key] = record;
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        flush: true,
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    });
    this.writeQueue = write.catch(() => {});
    await write;
  }

  private async read(): Promise<Record<string, CompanyRoleIssuanceRecord>> {
    try {
      const state: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (state === null || typeof state !== 'object' || Array.isArray(state)) {
        throw new IssuanceJournalError();
      }
      for (const [key, record] of Object.entries(state)) {
        if (
          !record ||
          typeof record !== 'object' ||
          typeof record.applicationId !== 'string' ||
          record.applicationId.toLowerCase() !== key ||
          typeof record.credentialId !== 'string' ||
          !record.credentialId
        ) {
          throw new IssuanceJournalError();
        }
      }
      return state as Record<string, CompanyRoleIssuanceRecord>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error instanceof IssuanceJournalError ? error : new IssuanceJournalError(error);
    }
  }
}
