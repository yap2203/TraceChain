import type { StoredEncryptedCredential } from '../ssi/encrypted-credential.store.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ApplicationMetadata {
  applicationId: string;
  applicantWallet?: string;
  companyName: string;
  companyRegistrationNumber: string;
  registrationCountry?: string;
  profileHash: string;
  initialLocationName?: string;
  initialLocationDetails?: StoredEncryptedCredential;
  submissionDigest?: string;
}

export interface ApplicationMetadataRepository {
  find(applicationId: string): Promise<ApplicationMetadata | undefined>;
  save(record: ApplicationMetadata): Promise<void>;
}

export class ApplicationMetadataConflictError extends Error {
  readonly code = 'APPLICATION_METADATA_CONFLICT';

  constructor() {
    super('This application ID was already used for different registration details.');
  }
}

const repositoryWrites = new Map<string, Promise<void>>();

export class JsonApplicationMetadataRepository implements ApplicationMetadataRepository {
  constructor(private readonly path: string) {}

  async find(applicationId: string) {
    return (await this.read())[applicationId.toLowerCase()];
  }

  async save(record: ApplicationMetadata) {
    await withRepositoryWrite(this.path, async () => {
      const records = await this.read();
      const key = record.applicationId.toLowerCase();
      const existing = records[key];
      if (existing) {
        if (
          !existing.submissionDigest ||
          !record.submissionDigest ||
          existing.submissionDigest.toLowerCase() !== record.submissionDigest.toLowerCase() ||
          existing.applicantWallet?.toLowerCase() !== record.applicantWallet?.toLowerCase()
        )
          throw new ApplicationMetadataConflictError();
        return;
      }
      records[key] = record;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(records, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.path);
    });
  }

  private async read(): Promise<Record<string, ApplicationMetadata>> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, ApplicationMetadata>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
}

async function withRepositoryWrite<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = repositoryWrites.get(path) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  repositoryWrites.set(path, tail);
  try {
    return await result;
  } finally {
    if (repositoryWrites.get(path) === tail) repositoryWrites.delete(path);
  }
}
