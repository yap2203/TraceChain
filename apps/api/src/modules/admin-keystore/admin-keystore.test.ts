import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CompanyRole } from '@tracechain/shared';
import { createTraceChainAgent } from '@tracechain/ssi';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AuthService } from '../auth/auth.service.js';
import type { BlockchainGateway } from '../blockchain/blockchain-gateway.service.js';
import { IpfsEncryptedCredentialStore } from '../ssi/encrypted-credential.store.js';
import { createApp } from '../../app.js';
import {
  AdminKeystoreError,
  AdminKeystoreManager,
  decryptAdminKeystore,
  encryptAdminKeystore,
  parseAdminKeystoreJson,
  type AdminKeyBundle,
} from './admin-keystore.js';
import { createAdminKeystoreRouter, KeystoreInitializationGuard } from './admin-keystore.routes.js';

const ADMIN = '0x00000000000000000000000000000000000000A1';
const COMPANY = '0x00000000000000000000000000000000000000B2';
const PASSWORD = 'test-only-admin-keystore-password';
const bundle: AdminKeyBundle = {
  ipfsEncryptionKey: 'a'.repeat(64),
  veramoKmsSecretKey: 'b'.repeat(64),
  veramoPrivateKeyStore: {
    privateKeys: [{ kid: 'encrypted-record', privateKeyHex: 'ciphertext' }],
  },
  createdAt: '2026-11-21T00:00:00.000Z',
  keyBundleVersion: 1,
};
const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('portable administrator keystore', () => {
  it('round-trips all keys without exposing the password or raw material', async () => {
    const encrypted = await encryptAdminKeystore(bundle, PASSWORD);
    const serialized = JSON.stringify(encrypted);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(bundle.ipfsEncryptionKey);
    expect(serialized).not.toContain(bundle.veramoKmsSecretKey);
    expect(serialized).not.toContain('encrypted-record');
    await expect(decryptAdminKeystore(encrypted, PASSWORD)).resolves.toEqual(bundle);
  });

  it.each(['password', 'ciphertext', 'authTag', 'metadata'] as const)(
    'rejects modified or incorrect %s with one safe error',
    async (kind) => {
      const encrypted: any = await encryptAdminKeystore(bundle, PASSWORD);
      let password = PASSWORD;
      if (kind === 'password') password = 'incorrect-password-value';
      if (kind === 'ciphertext') encrypted.ciphertext = flip(encrypted.ciphertext);
      if (kind === 'authTag') encrypted.cipher.authTag = flip(encrypted.cipher.authTag);
      if (kind === 'metadata') encrypted.format = 'changed-purpose';
      await expect(decryptAdminKeystore(encrypted, password)).rejects.toMatchObject({
        code: 'INVALID_KEYSTORE',
        message: 'Incorrect password or invalid keystore file.',
      });
    },
  );

  it('rejects invalid and oversized JSON before decryption', () => {
    expect(() => parseAdminKeystoreJson('{invalid')).toThrow('Incorrect password');
    expect(() => parseAdminKeystoreJson('x'.repeat(2 * 1024 * 1024 + 1))).toThrow(
      'Incorrect password',
    );
  });

  it('keeps keys only in one manager process and captures Veramo store updates in exports', async () => {
    const encrypted = await encryptAdminKeystore(bundle, PASSWORD);
    const manager = new AdminKeystoreManager();
    expect(manager.status()).toBe('Locked');
    expect(() => manager.ipfsEncryptionKey()).toThrow('locked');
    await manager.unlock(encrypted, PASSWORD);
    expect(manager.backupRequired()).toBe(false);
    const store = manager.createVeramoPrivateKeyStore();
    await store.notifyUpdate?.(store, { ...store, privateKeys: [{ kid: 'new-key' }] });
    expect(manager.backupRequired()).toBe(true);
    expect(() => manager.lock()).toThrowError(
      expect.objectContaining({ code: 'KEYSTORE_BACKUP_REQUIRED' }),
    );
    const exported = await manager.export(PASSWORD);
    expect(manager.backupRequired()).toBe(false);
    expect((await decryptAdminKeystore(exported, PASSWORD)).veramoPrivateKeyStore).toMatchObject({
      privateKeys: [{ kid: 'new-key' }],
    });
    manager.lock();
    expect(manager.status()).toBe('Locked');
    expect(new AdminKeystoreManager().status()).toBe('Locked');
  });

  it('decrypts existing IPFS content after exporting and importing the migrated key', async () => {
    let pinned = '';
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const file = (init.body as FormData).get('file') as Blob;
        pinned = await file.text();
        return new Response(JSON.stringify({ IpfsHash: `Qm${'a'.repeat(44)}` }), { status: 200 });
      }
      return new Response(pinned, { status: 200 });
    });
    const original = new IpfsEncryptedCredentialStore(
      Buffer.from(bundle.ipfsEncryptionKey, 'hex'),
      'https://pin.example/upload',
      'test-token',
      'https://gateway.example/ipfs',
    );
    const stored = await original.encryptAndStore('existing encrypted content', 'record');
    const manager = new AdminKeystoreManager();
    await manager.unlock(await encryptAdminKeystore(bundle, PASSWORD), PASSWORD);
    const restored = new IpfsEncryptedCredentialStore(
      manager.ipfsEncryptionKey(),
      'https://pin.example/upload',
      'test-token',
      'https://gateway.example/ipfs',
    );
    await expect(restored.retrieveAndDecrypt!(`ipfs://${stored.cid}`)).resolves.toBe(
      'existing encrypted content',
    );
  });

  it('uses migrated Veramo private-key material to sign again with the same issuer DID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-issuer-'));
    directories.push(directory);
    const publicStorePath = join(directory, 'public.json');
    const privateKeyStorePath = join(directory, 'private.json');
    const config = {
      chainId: 11_155_111 as const,
      kmsSecretKey: bundle.veramoKmsSecretKey,
      networkName: 'sepolia' as const,
      privateKeyStorePath,
      publicStorePath,
      resolverOverrides: {
        ethr: async () => ({
          didDocument: null,
          didDocumentMetadata: {},
          didResolutionMetadata: {},
        }),
      },
      rpcUrl: 'https://rpc.example.test',
    };
    const original = await createTraceChainAgent(config);
    const identity = await original.didManagerCreate({
      alias: 'portable-authority',
      provider: 'did:ethr:sepolia',
    });
    const privateStore = JSON.parse(await readFile(privateKeyStorePath, 'utf8'));
    const manager = new AdminKeystoreManager();
    await manager.unlock(
      await encryptAdminKeystore({ ...bundle, veramoPrivateKeyStore: privateStore }, PASSWORD),
      PASSWORD,
    );
    const restored = await createTraceChainAgent({
      ...config,
      privateKeyStorePath: undefined,
      privateKeyStore: manager.createVeramoPrivateKeyStore(),
    });
    expect((await restored.didManagerGetByAlias({ alias: 'portable-authority' })).did).toBe(
      identity.did,
    );
    const credential = await restored.createVerifiableCredential({
      credential: {
        issuer: { id: identity.did },
        credentialSubject: { id: 'did:example:portable-subject', purpose: 'migration-test' },
        type: ['VerifiableCredential', 'PortableIssuerTestCredential'],
        '@context': ['https://www.w3.org/2018/credentials/v1'],
      },
      proofFormat: 'jwt',
    });
    expect(credential.proof).toBeTruthy();
  });
});

describe('administrator keystore API access', () => {
  it('permits initialization only when local and on-chain existing state is absent', async () => {
    vi.stubEnv('IPFS_ENCRYPTION_KEY', '');
    vi.stubEnv('VERAMO_KMS_SECRET_KEY', '');
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-fresh-keystore-'));
    directories.push(directory);
    const marker = join(directory, 'initialized.json');

    await expect(
      new KeystoreInitializationGuard(marker, [], async () => false).allowed(),
    ).resolves.toBe(true);
    await expect(
      new KeystoreInitializationGuard(marker, [], async () => true).allowed(),
    ).resolves.toBe(false);
    await expect(
      new KeystoreInitializationGuard(marker, [], async () =>
        Promise.reject(new Error('RPC unavailable')),
      ).allowed(),
    ).resolves.toBe(false);
  });

  it('starts the API and serves health while the runtime keystore is locked', async () => {
    const manager = new AdminKeystoreManager();
    const gateway = {
      getRegistryReferences: () => ({
        credentialRegistry: '0x0000000000000000000000000000000000000011',
        stakeholderRegistry: '0x0000000000000000000000000000000000000022',
      }),
    } as unknown as BlockchainGateway;
    const app = createApp({
      adminKeystore: manager,
      authService: session(ADMIN, CompanyRole.SYSTEM_ADMIN),
      blockchainGateway: gateway,
      ssi: {
        agentProvider: async () => Promise.reject(new Error('not used')),
        authorityDidAlias: 'authority',
      },
    });
    await request(app).get('/api/health').expect(200, {
      service: 'tracechain-api',
      status: 'ok',
    });
    expect(manager.status()).toBe('Locked');
    expect(() => manager.ipfsEncryptionKey()).toThrowError(
      expect.objectContaining({ code: 'KEYSTORE_LOCKED' }),
    );
  });

  it('requires matching passwords before creating an initial keystore', async () => {
    vi.stubEnv('IPFS_ENCRYPTION_KEY', '');
    vi.stubEnv('VERAMO_KMS_SECRET_KEY', '');
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-initialize-keystore-'));
    directories.push(directory);
    const manager = new AdminKeystoreManager();
    const app = express()
      .use(express.json())
      .use(
        createAdminKeystoreRouter({
          authService: session(ADMIN, CompanyRole.SYSTEM_ADMIN),
          cookieName: 'session',
          gateway: { getAdministrator: async () => ADMIN },
          initialization: new KeystoreInitializationGuard(join(directory, 'state.json'), []),
          manager,
        }),
      );

    await request(app)
      .post('/initialize')
      .send({ password: PASSWORD, confirmPassword: `${PASSWORD}-mistyped` })
      .expect(400, {
        error: {
          code: 'PASSWORD_CONFIRMATION_MISMATCH',
          message: 'The password confirmation does not match.',
        },
      });
    expect(manager.status()).toBe('Locked');

    const response = await request(app)
      .post('/initialize')
      .send({ password: PASSWORD, confirmPassword: PASSWORD })
      .expect(200);
    expect(response.headers['content-disposition']).toContain('tracechain-admin-keystore.json');
    expect(manager.status()).toBe('Unlocked');
  });

  it('allows only the on-chain System Admin to import and export', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-keystore-'));
    directories.push(directory);
    const manager = new AdminKeystoreManager();
    const encrypted = await encryptAdminKeystore(bundle, PASSWORD);
    const app = express()
      .use(express.json({ limit: '2100kb' }))
      .use(
        createAdminKeystoreRouter({
          authService: session(COMPANY, CompanyRole.SUPPLIER),
          cookieName: 'session',
          gateway: { getAdministrator: async () => ADMIN },
          initialization: new KeystoreInitializationGuard(join(directory, 'state.json'), []),
          manager,
        }),
      );
    await request(app).get('/status').expect(403);
    await request(app)
      .post('/unlock')
      .send({ password: PASSWORD, keystore: JSON.stringify(encrypted) })
      .expect(403);

    const adminApp = express()
      .use(express.json({ limit: '2100kb' }))
      .use(
        createAdminKeystoreRouter({
          authService: session(ADMIN, CompanyRole.SYSTEM_ADMIN),
          cookieName: 'session',
          gateway: { getAdministrator: async () => ADMIN },
          initialization: new KeystoreInitializationGuard(join(directory, 'state.json'), []),
          manager,
        }),
      );
    await request(adminApp).get('/status').expect(200, {
      backupRequired: false,
      status: 'Locked',
      initializationAllowed: false,
    });
    await request(adminApp)
      .post('/unlock')
      .send({ password: PASSWORD, keystore: JSON.stringify(encrypted) })
      .expect(200, { backupRequired: false, status: 'Unlocked' });
    const store = manager.createVeramoPrivateKeyStore();
    await store.notifyUpdate?.(store, { ...store, privateKeys: [{ kid: 'new-issuer-key' }] });
    await request(adminApp).get('/status').expect(200, {
      backupRequired: true,
      status: 'Unlocked',
      initializationAllowed: false,
    });
    await request(adminApp)
      .post('/lock')
      .expect(409, {
        error: {
          code: 'KEYSTORE_BACKUP_REQUIRED',
          message: 'Download an updated administrator keystore before locking this API session.',
        },
      });
    await request(adminApp)
      .post('/export')
      .send({
        password: 'a-different-export-password',
        confirmPassword: 'a-mistyped-export-password',
      })
      .expect(400, {
        error: {
          code: 'PASSWORD_CONFIRMATION_MISMATCH',
          message: 'The password confirmation does not match.',
        },
      });
    expect(manager.backupRequired()).toBe(true);
    const downloaded = await request(adminApp)
      .post('/export')
      .send({
        password: 'a-different-export-password',
        confirmPassword: 'a-different-export-password',
      })
      .expect(200);
    expect(downloaded.headers['cache-control']).toBe('no-store');
    expect(downloaded.headers['content-disposition']).toContain('tracechain-admin-keystore.json');
    await expect(
      decryptAdminKeystore(downloaded.body, 'a-different-export-password'),
    ).resolves.toMatchObject({ ipfsEncryptionKey: bundle.ipfsEncryptionKey });
    expect(manager.backupRequired()).toBe(false);
    await request(adminApp).post('/lock').expect(200, { backupRequired: false, status: 'Locked' });
    await request(adminApp)
      .post('/export')
      .send({ password: PASSWORD, confirmPassword: PASSWORD })
      .expect(423, {
        error: {
          code: 'KEYSTORE_LOCKED',
          message:
            'The TraceChain administrator keystore is locked. Ask the System Admin to unlock it.',
        },
      });
  });
});

function session(address: string, role: CompanyRole) {
  return {
    getSession: async () => ({
      address,
      authenticated: true,
      authorizationReady: true,
      authorizationStatus: 'AUTHORIZED',
      credentialVerified: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      locallyVerified: true,
      message: 'authorized',
      onChainStatusChecked: true,
      role,
    }),
  } as unknown as AuthService;
}

function flip(value: string) {
  return `${value[0] === 'A' ? 'B' : 'A'}${value.slice(1)}`;
}
