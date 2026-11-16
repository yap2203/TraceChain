import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ApplicationMetadataConflictError,
  JsonApplicationMetadataRepository,
  type ApplicationMetadata,
} from './application-metadata.repository.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('JSON application metadata repository', () => {
  it('keeps two applications saved concurrently through the full read-modify-write cycle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-application-metadata-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'metadata.json');
    const firstRepository = new JsonApplicationMetadataRepository(path);
    const secondRepository = new JsonApplicationMetadataRepository(path);
    const first = record('11', 'aa');
    const second = record('22', 'bb');

    await Promise.all([firstRepository.save(first), secondRepository.save(second)]);

    const reader = new JsonApplicationMetadataRepository(path);
    expect(await reader.find(first.applicationId)).toEqual(first);
    expect(await reader.find(second.applicationId)).toEqual(second);
  });

  it('does not duplicate an identical retry and rejects conflicting data with the same profile hash', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-application-metadata-'));
    temporaryDirectories.push(directory);
    const repository = new JsonApplicationMetadataRepository(join(directory, 'metadata.json'));
    const original = record('33', 'cc');
    await repository.save(original);
    await repository.save({ ...original });

    await expect(
      repository.save({
        ...original,
        companyName: 'Changed Company',
        submissionDigest: `0x${'dd'.repeat(32)}`,
      }),
    ).rejects.toBeInstanceOf(ApplicationMetadataConflictError);
    expect(await repository.find(original.applicationId)).toEqual(original);
  });
});

function record(applicationByte: string, digestByte: string): ApplicationMetadata {
  return {
    applicationId: `0x${applicationByte.repeat(32)}`,
    applicantWallet: `0x${applicationByte.repeat(20)}`,
    companyName: `Company ${applicationByte}`,
    companyRegistrationNumber: `REG-${applicationByte}`,
    initialLocationName: 'Main location',
    profileHash: `0x${'44'.repeat(32)}`,
    submissionDigest: `0x${digestByte.repeat(32)}`,
  };
}
