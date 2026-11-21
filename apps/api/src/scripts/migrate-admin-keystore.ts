import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import '../config/load-env.js';
import { dataFile } from '../config/data-directory.js';
import {
  decryptAdminKeystore,
  encryptAdminKeystore,
  type AdminKeyBundle,
} from '../modules/admin-keystore/admin-keystore.js';
import { KeystoreInitializationGuard } from '../modules/admin-keystore/admin-keystore.routes.js';

const outputArgument = process.argv.find((value) => value.startsWith('--output='));
const outputPath = resolve(
  process.cwd(),
  outputArgument?.slice('--output='.length) || 'tracechain-admin-keystore.json',
);
const ipfsEncryptionKey = process.env.IPFS_ENCRYPTION_KEY;
const veramoKmsSecretKey = process.env.VERAMO_KMS_SECRET_KEY;
if (!/^[0-9a-fA-F]{64}$/.test(ipfsEncryptionKey ?? ''))
  throw new Error('IPFS_ENCRYPTION_KEY is missing or invalid. Migration stopped without changes.');
if (!/^[0-9a-fA-F]{64}$/.test(veramoKmsSecretKey ?? ''))
  throw new Error(
    'VERAMO_KMS_SECRET_KEY is missing or invalid. Migration stopped without changes.',
  );

let veramoPrivateKeyStore: Record<string, unknown>;
try {
  const value: unknown = JSON.parse(await readFile(dataFile('veramo/private-keys.json'), 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  veramoPrivateKeyStore = value as Record<string, unknown>;
} catch {
  throw new Error(
    'The existing Veramo private-key store is missing or invalid. Migration stopped without changes.',
  );
}

const password = await hiddenPassword('New administrator keystore password (12+ characters): ');
const confirmation = await hiddenPassword('Confirm administrator keystore password: ');
if (password !== confirmation)
  throw new Error('The passwords do not match. No keystore was created.');

const bundle: AdminKeyBundle = {
  ipfsEncryptionKey: ipfsEncryptionKey!,
  veramoKmsSecretKey: veramoKmsSecretKey!,
  veramoPrivateKeyStore,
  createdAt: new Date().toISOString(),
  keyBundleVersion: 1,
};
const keystore = await encryptAdminKeystore(bundle, password);
const verified = await decryptAdminKeystore(keystore, password);
if (
  verified.ipfsEncryptionKey !== bundle.ipfsEncryptionKey ||
  verified.veramoKmsSecretKey !== bundle.veramoKmsSecretKey ||
  JSON.stringify(verified.veramoPrivateKeyStore) !== JSON.stringify(bundle.veramoPrivateKeyStore)
)
  throw new Error('Keystore verification failed. No output was written.');

await writeFile(outputPath, `${JSON.stringify(keystore, null, 2)}\n`, {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o600,
});
await new KeystoreInitializationGuard(dataFile('keystore/initialized.json'), []).markInitialized();
stdout.write(`Encrypted administrator keystore created and verified: ${outputPath}\n`);
stdout.write('The original environment variables and private-key file were not changed.\n');

async function hiddenPassword(prompt: string) {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error('Run this migration command in an interactive terminal.');
  stdout.write(prompt);
  const terminal = createInterface({ input: stdin, output: undefined, terminal: true });
  try {
    const answer = await terminal.question('');
    stdout.write('\n');
    if (answer.length < 12) throw new Error('Use a password of at least 12 characters.');
    return answer;
  } finally {
    terminal.close();
  }
}
