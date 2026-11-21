import { createCipheriv, createDecipheriv, randomBytes, scrypt as nodeScrypt } from 'node:crypto';

import type { VeramoJsonCache, VeramoJsonStore } from '@veramo/data-store-json';
import { z } from 'zod';

const FORMAT = 'tracechain-admin-keystore' as const;
const VERSION = 1 as const;
const PURPOSE = 'TraceChain system administrator key bundle' as const;
const MAX_KEYSTORE_BYTES = 2 * 1024 * 1024;
const KDF = { blockSize: 8, cost: 16_384, parallelization: 1 } as const;
const SAFE_INVALID_MESSAGE = 'Incorrect password or invalid keystore file.';

const envelopeSchema = z
  .object({
    format: z.literal(FORMAT),
    version: z.literal(VERSION),
    kdf: z
      .object({
        name: z.literal('scrypt'),
        salt: z.string().max(128),
        cost: z.literal(KDF.cost),
        blockSize: z.literal(KDF.blockSize),
        parallelization: z.literal(KDF.parallelization),
      })
      .strict(),
    cipher: z
      .object({
        name: z.literal('aes-256-gcm'),
        iv: z.string().max(128),
        authTag: z.string().max(128),
      })
      .strict(),
    ciphertext: z
      .string()
      .min(1)
      .max(MAX_KEYSTORE_BYTES * 2),
  })
  .strict();

const payloadSchema = z
  .object({
    ipfsEncryptionKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
    veramoKmsSecretKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
    veramoPrivateKeyStore: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime(),
    keyBundleVersion: z.literal(1),
  })
  .strict();

export type AdminKeystoreEnvelope = z.infer<typeof envelopeSchema>;
export type AdminKeyBundle = z.infer<typeof payloadSchema>;

export class AdminKeystoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class KeystoreLockedError extends AdminKeystoreError {
  constructor() {
    super(
      'KEYSTORE_LOCKED',
      'The TraceChain administrator keystore is locked. Ask the System Admin to unlock it.',
      423,
    );
  }
}

export async function encryptAdminKeystore(bundleValue: AdminKeyBundle, password: string) {
  const bundle = payloadSchema.parse(bundleValue);
  validatePassword(password);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, KDF);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(authenticatedMetadata());
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(bundle), 'utf8'),
      cipher.final(),
    ]);
    return {
      format: FORMAT,
      version: VERSION,
      kdf: {
        name: 'scrypt' as const,
        salt: salt.toString('base64'),
        ...KDF,
      },
      cipher: {
        name: 'aes-256-gcm' as const,
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
      },
      ciphertext: ciphertext.toString('base64'),
    } satisfies AdminKeystoreEnvelope;
  } finally {
    key.fill(0);
  }
}

export async function decryptAdminKeystore(value: unknown, password: string) {
  try {
    validatePassword(password);
    const envelope = envelopeSchema.parse(value);
    const salt = strictBase64(envelope.kdf.salt, 16);
    const iv = strictBase64(envelope.cipher.iv, 12);
    const authTag = strictBase64(envelope.cipher.authTag, 16);
    const ciphertext = strictBase64(envelope.ciphertext);
    if (ciphertext.length > MAX_KEYSTORE_BYTES) throw new Error('oversized');
    const key = await deriveKey(password, salt, envelope.kdf);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(authenticatedMetadata(envelope.format, envelope.version));
      decipher.setAuthTag(authTag);
      return payloadSchema.parse(
        JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')),
      );
    } finally {
      key.fill(0);
    }
  } catch {
    throw new AdminKeystoreError('INVALID_KEYSTORE', SAFE_INVALID_MESSAGE, 400);
  }
}

export function parseAdminKeystoreJson(serialized: string) {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_KEYSTORE_BYTES)
    throw new AdminKeystoreError('INVALID_KEYSTORE', SAFE_INVALID_MESSAGE, 400);
  try {
    return envelopeSchema.parse(JSON.parse(serialized));
  } catch {
    throw new AdminKeystoreError('INVALID_KEYSTORE', SAFE_INVALID_MESSAGE, 400);
  }
}

export class AdminKeystoreManager {
  private bundle?: AdminKeyBundle;
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  status() {
    return this.bundle ? ('Unlocked' as const) : ('Locked' as const);
  }

  currentGeneration() {
    return this.generation;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async unlock(value: unknown, password: string) {
    this.replace(await decryptAdminKeystore(value, password));
  }

  async initialize(password: string) {
    const bundle: AdminKeyBundle = {
      ipfsEncryptionKey: randomBytes(32).toString('hex'),
      veramoKmsSecretKey: randomBytes(32).toString('hex'),
      veramoPrivateKeyStore: {},
      createdAt: new Date().toISOString(),
      keyBundleVersion: 1,
    };
    this.replace(bundle);
    return encryptAdminKeystore(bundle, password);
  }

  async export(password: string) {
    return encryptAdminKeystore(this.requireBundle(), password);
  }

  lock() {
    this.clearBundle();
    this.bundle = undefined;
    this.generation += 1;
    this.notify();
  }

  ipfsEncryptionKey() {
    return Buffer.from(this.requireBundle().ipfsEncryptionKey, 'hex');
  }

  veramoKmsSecretKey() {
    return this.requireBundle().veramoKmsSecretKey;
  }

  createVeramoPrivateKeyStore(): VeramoJsonStore {
    const generation = this.generation;
    const initial = serializableSnapshot(this.requireBundle().veramoPrivateKeyStore);
    return {
      ...initial,
      notifyUpdate: async (_oldState, newState) => {
        const bundle = this.requireBundle();
        if (generation !== this.generation) throw new KeystoreLockedError();
        bundle.veramoPrivateKeyStore = serializableSnapshot(newState);
      },
    } as VeramoJsonStore;
  }

  private requireBundle() {
    if (!this.bundle) throw new KeystoreLockedError();
    return this.bundle;
  }

  private replace(bundle: AdminKeyBundle) {
    this.clearBundle();
    this.bundle = payloadSchema.parse(structuredClone(bundle));
    this.generation += 1;
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private clearBundle() {
    if (!this.bundle) return;
    this.bundle.ipfsEncryptionKey = '0'.repeat(64);
    this.bundle.veramoKmsSecretKey = '0'.repeat(64);
    this.bundle.veramoPrivateKeyStore = {};
  }
}

function validatePassword(password: string) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024)
    throw new Error('invalid password');
}

function authenticatedMetadata(format = FORMAT, version = VERSION) {
  return Buffer.from(JSON.stringify({ format, version, purpose: PURPOSE }), 'utf8');
}

function strictBase64(value: string, expectedLength?: number) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (expectedLength && bytes.length !== expectedLength))
    throw new Error('invalid base64');
  return bytes;
}

function serializableSnapshot(value: Partial<VeramoJsonCache> | Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function deriveKey(
  password: string,
  salt: Buffer,
  parameters: { cost: number; blockSize: number; parallelization: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      32,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => (error ? reject(error) : resolve(Buffer.from(key))),
    );
  });
}
