import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ApplicationMetadata {
  applicationId: string;
  companyName: string;
  companyRegistrationNumber: string;
  profileHash: string;
}

export interface ApplicationMetadataRepository {
  find(applicationId: string): Promise<ApplicationMetadata | undefined>;
  save(record: ApplicationMetadata): Promise<void>;
}

export class JsonApplicationMetadataRepository implements ApplicationMetadataRepository {
  constructor(private readonly path: string) {}

  async find(applicationId: string) { return (await this.read())[applicationId.toLowerCase()]; }

  async save(record: ApplicationMetadata) {
    const records = await this.read();
    const key = record.applicationId.toLowerCase();
    const existing = records[key];
    if (existing && existing.profileHash.toLowerCase() !== record.profileHash.toLowerCase()) throw new Error('Application metadata conflicts with the persisted profile hash.');
    records[key] = record;
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
  }

  private async read(): Promise<Record<string, ApplicationMetadata>> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, ApplicationMetadata>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  }
}
