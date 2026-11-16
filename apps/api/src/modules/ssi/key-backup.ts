import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
export interface StorageKeys {
  IPFS_ENCRYPTION_KEY: string;
  VERAMO_KMS_SECRET_KEY: string;
}
function validate(keys: StorageKeys) {
  if (
    !keys ||
    !/^[a-f0-9]{64}$/i.test(keys.IPFS_ENCRYPTION_KEY) ||
    !/^[a-f0-9]{64}$/i.test(keys.VERAMO_KMS_SECRET_KEY)
  )
    throw new Error(
      'Both storage encryption secrets must be configured as 32-byte hexadecimal keys.',
    );
}
const aad = Buffer.from('TraceChain storage-key backup v1');
export function encryptStorageKeyBackup(keys: StorageKeys, password: string) {
  validate(keys);
  if (password.length < 12) throw new Error('Use a backup password of at least 12 characters.');
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = scryptSync(password, salt, 32),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  try {
    const ciphertext = Buffer.concat([
      cipher.update(
        JSON.stringify({
          IPFS_ENCRYPTION_KEY: keys.IPFS_ENCRYPTION_KEY,
          VERAMO_KMS_SECRET_KEY: keys.VERAMO_KMS_SECRET_KEY,
        }),
        'utf8',
      ),
      cipher.final(),
    ]);
    return {
      version: 1,
      protection: 'scrypt-aes-256-gcm',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}
export function restoreStorageKeyBackup(value: unknown, password: string): StorageKeys {
  try {
    const backup = value as ReturnType<typeof encryptStorageKeyBackup>;
    if (
      backup.version !== 1 ||
      backup.protection !== 'scrypt-aes-256-gcm' ||
      Buffer.from(backup.salt, 'base64').length !== 16
    )
      throw new Error();
    const key = scryptSync(password, Buffer.from(backup.salt, 'base64'), 32);
    try {
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(backup.iv, 'base64'));
      cipher.setAAD(aad);
      cipher.setAuthTag(Buffer.from(backup.authTag, 'base64'));
      const keys = JSON.parse(
        Buffer.concat([
          cipher.update(Buffer.from(backup.ciphertext, 'base64')),
          cipher.final(),
        ]).toString('utf8'),
      );
      validate(keys);
      return keys;
    } finally {
      key.fill(0);
    }
  } catch {
    throw new Error(
      'The backup password is incorrect or the encrypted storage-key backup is damaged.',
    );
  }
}
