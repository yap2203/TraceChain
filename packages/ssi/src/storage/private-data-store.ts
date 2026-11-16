import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { VeramoJsonStore, VeramoJsonCache } from '@veramo/data-store-json';
import { createAtomicJsonStore } from './json-file-store.js';

const fields = ['credentials', 'claims', 'presentations', 'messages'] as const;
const aad = Buffer.from('TraceChain private Veramo data v1');
export const privateDataPath = (publicPath: string) =>
  publicPath.replace(/\.json$/i, '') + '.credentials.encrypted.json';

/** Keep IDataStore/bootstrap compatibility, but never persist claims in the public DID metadata file. */
export async function createPrivateDataStores(publicPath: string, kmsSecret: string) {
  const metadata = await createAtomicJsonStore(publicPath);
  const path = privateDataPath(publicPath);
  const key = createHash('sha256')
    .update('tracechain-private-data-v1\0')
    .update(Buffer.from(kmsSecret, 'hex'))
    .digest();
  const decode = (text: string) => {
    const envelope = JSON.parse(text);
    if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm')
      throw new Error('Unsupported encrypted Veramo data store.');
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    cipher.setAAD(aad);
    cipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    return JSON.parse(
      Buffer.concat([
        cipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        cipher.final(),
      ]).toString('utf8'),
    ) as VeramoJsonCache;
  };
  let snapshot: VeramoJsonCache = {};
  try {
    snapshot = decode(await readFile(path, 'utf8'));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(
        'The encrypted Veramo credential store could not be unlocked. Restore its original KMS key and trusted backup.',
      );
  }
  let queue = Promise.resolve();
  const data: VeramoJsonStore = {
    ...snapshot,
    notifyUpdate: async (_old, next) => {
      const serialized = JSON.stringify(next);
      const work = queue.then(async () => {
        const iv = randomBytes(12),
          cipher = createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(aad);
        const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
        const envelope = JSON.stringify({
          version: 1,
          algorithm: 'aes-256-gcm',
          iv: iv.toString('base64'),
          authTag: cipher.getAuthTag().toString('base64'),
          ciphertext: ciphertext.toString('base64'),
        });
        if (JSON.stringify(decode(envelope)) !== serialized)
          throw new Error('Encrypted Veramo store verification failed.');
        await mkdir(dirname(path), { recursive: true });
        const temporary = path + '.' + randomBytes(8).toString('hex') + '.tmp';
        await writeFile(temporary, envelope, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, path);
      });
      queue = work.catch(() => undefined);
      await work;
    },
  };
  if (fields.some((field) => metadata[field] !== undefined)) {
    for (const field of fields) {
      const legacy = metadata[field] as Record<string, unknown> | undefined;
      if (!legacy) continue;
      const merged = { ...((data[field] as Record<string, unknown>) ?? {}) };
      for (const [id, value] of Object.entries(legacy)) {
        if (merged[id] && JSON.stringify(merged[id]) !== JSON.stringify(value))
          throw new Error(
            'Conflicting private Veramo records; migration stopped without removing the original.',
          );
        merged[id] = value;
      }
      Object.assign(data, { [field]: merged });
    }
    // Persist and read back the encrypted copy BEFORE removing any readable record.
    const { notifyUpdate: _, ...next } = data;
    await data.notifyUpdate({}, next);
    decode(await readFile(path, 'utf8'));
    for (const field of fields) delete metadata[field];
    const { notifyUpdate: __, ...clean } = metadata;
    await metadata.notifyUpdate({}, clean);
  }
  return { metadata, data };
}
