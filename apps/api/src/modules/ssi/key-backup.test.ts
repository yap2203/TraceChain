import { expect, it } from 'vitest';
import { encryptStorageKeyBackup, restoreStorageKeyBackup } from './key-backup.js';
it('restores both backend encryption secrets separately from the Pinata token and wallet keys', () => {
  const keys = { IPFS_ENCRYPTION_KEY: 'a'.repeat(64), VERAMO_KMS_SECRET_KEY: 'b'.repeat(64) };
  const backup = encryptStorageKeyBackup(keys, 'test-only-long-password');
  expect(JSON.stringify(backup)).not.toContain(keys.IPFS_ENCRYPTION_KEY);
  expect(restoreStorageKeyBackup(backup, 'test-only-long-password')).toEqual(keys);
  expect(() => restoreStorageKeyBackup(backup, 'wrong-password')).toThrow('incorrect');
  backup.ciphertext = 'AAAA';
  expect(() => restoreStorageKeyBackup(backup, 'test-only-long-password')).toThrow('damaged');
});
