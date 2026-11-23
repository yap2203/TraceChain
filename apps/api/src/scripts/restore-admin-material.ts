import { chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { decryptAdminKeystore, parseAdminKeystoreJson } from './admin-bundle.js';
import { validateIssuerMaterial } from '../config/backend-runtime.js';

/** Offline only. This module is not imported by the app or exposed through HTTP. */
export async function restoreAdminMaterial(input: {
  bundlePath: string;
  metadataPath: string;
  password: string;
  dataDirectory: string;
  backendEnvironmentPath: string;
  authorityAlias: string;
  restore?: boolean;
  environment?: NodeJS.ProcessEnv;
}) {
  const serialized = await readFile(input.bundlePath, 'utf8');
  const bundle = await decryptAdminKeystore(parseAdminKeystoreJson(serialized), input.password);
  const metadataText = await readFile(input.metadataPath, 'utf8');
  const metadata = JSON.parse(metadataText);
  const verified = await validateIssuerMaterial(
    metadata,
    bundle.veramoPrivateKeyStore,
    bundle.veramoKmsSecretKey,
    input.authorityAlias,
  );
  const environment = input.environment ?? process.env;
  for (const [name, original] of [
    ['IPFS_ENCRYPTION_KEY', bundle.ipfsEncryptionKey],
    ['VERAMO_KMS_SECRET_KEY', bundle.veramoKmsSecretKey],
  ]) {
    if (
      /^[a-f0-9]{64}$/i.test(environment[name] ?? '') &&
      environment[name]!.toLowerCase() !== original!.toLowerCase()
    )
      throw new Error(
        'The bundle secrets differ from configured secrets. Recovery stopped without writes. Select the matching bundle and original environment configuration; do not rotate keys.',
      );
  }
  const target = resolve(input.dataDirectory),
    privatePath = join(target, 'veramo/private-keys.json'),
    publicPath = join(target, 'veramo/public-data.json');
  let current: Record<string, any> = {};
  try {
    current = JSON.parse(await readFile(privatePath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
  const keys = bundle.veramoPrivateKeyStore.privateKeys as Record<string, unknown>;
  if (Object.keys(current.privateKeys ?? {}).some((key) => !keys[key]))
    throw new Error(
      'Saved issuer keys are absent from this bundle. Recovery stopped to prevent a downgrade. Find the latest matching bundle and metadata.',
    );
  try {
    const existing = JSON.parse(await readFile(publicPath, 'utf8'));
    if (Object.keys(existing.keys ?? {}).some((key) => !metadata.keys[key]))
      throw new Error('The proposed metadata would remove existing issuer keys. Recovery stopped.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
  const additions = Object.keys(keys).filter((key) => !current.privateKeys?.[key]).length;
  const changed = Object.entries(keys).filter(
    ([key, value]) =>
      current.privateKeys?.[key] &&
      JSON.stringify(current.privateKeys[key]) !== JSON.stringify(value),
  ).length;
  const result = {
    checked: true,
    restored: false,
    privateKeyCount: verified.privateKeyCount,
    publicKeyCount: verified.publicKeyCount,
    addedPrivateKeys: additions,
    changedEncryptedEntries: changed,
    backupDirectory: undefined as string | undefined,
  };
  if (!input.restore) return result;
  const backup = join(
    target,
    'recovery',
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID(),
  );
  await mkdir(backup, { recursive: true, mode: 0o700 });
  for (const [path, name] of [
    [privatePath, 'private-keys.json'],
    [publicPath, 'public-data.json'],
    [input.backendEnvironmentPath, 'backend.env.runtime'],
  ]) {
    try {
      await copyFile(path!, join(backup, name!));
      await chmod(join(backup, name!), 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await copyFile(input.bundlePath, join(backup, 'tracechain-admin-keystore.json'));
  await chmod(join(backup, 'tracechain-admin-keystore.json'), 0o600);
  // Copy only DID/key metadata; never put readable VC/VP caches into the restored public file.
  const publicMetadata = { dids: metadata.dids, keys: metadata.keys };
  await atomic(privatePath, JSON.stringify(bundle.veramoPrivateKeyStore, null, 2));
  await atomic(publicPath, JSON.stringify(publicMetadata, null, 2));
  let backendText = '';
  try {
    backendText = await readFile(input.backendEnvironmentPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  backendText = backendText.replace(
    /^(?:IPFS_ENCRYPTION_KEY|VERAMO_KMS_SECRET_KEY)\s*=.*\r?\n?/gm,
    '',
  );
  await atomic(
    input.backendEnvironmentPath,
    backendText +
      '\n# Backend-only restored secrets. Keep this ignored file protected.\n' +
      `IPFS_ENCRYPTION_KEY=${bundle.ipfsEncryptionKey}\nVERAMO_KMS_SECRET_KEY=${bundle.veramoKmsSecretKey}\n`,
  );
  return { ...result, restored: true, backupDirectory: backup };
}
async function atomic(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, contents + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
