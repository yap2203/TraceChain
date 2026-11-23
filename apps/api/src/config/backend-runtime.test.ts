import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CompanyRole } from '@tracechain/shared';
import {
  createTraceChainAgent,
  createOrGetAuthorityDid,
  createOrGetSupplierIssuerDid,
  issueCompanyRoleCredential,
  verifyCompanyRoleCredential,
} from '@tracechain/ssi';
import { Wallet, id } from 'ethers';
import request from 'supertest';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { loadBackendSecrets, openExistingIssuer } from './backend-runtime.js';
import { createApp } from '../app.js';
import { encryptAdminKeystore } from '../scripts/admin-bundle.js';
import { restoreAdminMaterial } from '../scripts/restore-admin-material.js';

let directory: string;
const kms = 'b'.repeat(64),
  ipfs = 'a'.repeat(64),
  alias = 'test-existing-authority';
const children = new Set<ChildProcess>();
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tc-env-start-'));
});
afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited.catch(() => {});
    }
  }
  children.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
const resolver = {
  ethr: async (did: string, parsed: any) => {
    const key = parsed.id.split(':').at(-1),
      method = did + '#controllerKey';
    return {
      didDocument: {
        id: did,
        verificationMethod: [
          {
            id: method,
            controller: did,
            type: 'EcdsaSecp256k1VerificationKey2019',
            publicKeyHex: key.slice(2),
          },
        ],
        assertionMethod: [method],
        authentication: [method],
      },
      didDocumentMetadata: {},
      didResolutionMetadata: {},
    };
  },
};
async function fixture() {
  const environment = {
    TRACECHAIN_DATA_DIR: directory,
    CHAIN_ID: '11155111',
    CHAIN_RPC_URL: 'http://127.0.0.1:1',
    SEPOLIA_RPC_URL: 'http://127.0.0.1:1',
    TRACECHAIN_AUTHORITY_DID_ALIAS: alias,
    VERAMO_KMS_SECRET_KEY: kms,
    IPFS_ENCRYPTION_KEY: ipfs,
  };
  const config = {
    chainId: 11155111,
    networkName: 'sepolia',
    rpcUrl: environment.CHAIN_RPC_URL,
    kmsSecretKey: kms,
    publicStorePath: join(directory, 'veramo/public-data.json'),
    privateKeyStorePath: join(directory, 'veramo/private-keys.json'),
    resolverOverrides: resolver,
  };
  const agent = await createTraceChainAgent(config);
  const authority = (await createOrGetAuthorityDid(agent, alias)).identifier.did;
  return { environment, config, agent, authority };
}
const credentialInput = (issuerDid: string, wallet: string) => ({
  applicationReference: id('test application'),
  companyId: 'TEST-1',
  companyName: 'Synthetic company',
  companyRegistrationNumber: 'TEST-1',
  registrationCountry: 'MY',
  issuerDid,
  subjectDid: `did:ethr:sepolia:${wallet}`,
  walletAddress: wallet,
  role: CompanyRole.SUPPLIER,
  issuerOperatorWallet: wallet,
  issuerOperatorChainId: 11155111,
  issuanceDate: new Date(Date.now() - 1000),
  expirationDate: new Date(Date.now() + 3600000),
});

it.each(['IPFS_ENCRYPTION_KEY', 'VERAMO_KMS_SECRET_KEY'])(
  'rejects missing and invalid %s without echoing input',
  (name) => {
    for (const value of [
      undefined,
      '',
      'secret-not-valid',
      '0x' + 'a'.repeat(64),
      'a'.repeat(63),
    ]) {
      const input = { IPFS_ENCRYPTION_KEY: ipfs, VERAMO_KMS_SECRET_KEY: kms, [name]: value };
      expect(() => loadBackendSecrets(input)).toThrow(name);
      try {
        loadBackendSecrets(input);
      } catch (error) {
        expect(String(error)).not.toContain('secret-not-valid');
      }
    }
  },
);
it('opens the same issuer after restart, verifies an older VC and signs a new VC with its original DID', async () => {
  const f = await fixture(),
    wallet = Wallet.createRandom();
  const original = await issueCompanyRoleCredential(
    f.agent,
    credentialInput(f.authority, wallet.address),
  );
  const before = await readFile(f.config.privateKeyStorePath, 'utf8');
  for (let restart = 0; restart < 2; restart++) {
    const runtime = await openExistingIssuer(f.environment, resolver);
    expect(runtime.authorityDid).toBe(f.authority);
    expect(
      (
        await verifyCompanyRoleCredential(
          runtime.agent,
          original.credential,
          wallet.address,
          f.authority,
        )
      ).verified,
    ).toBe(true);
    const issued = await issueCompanyRoleCredential(
      runtime.agent,
      credentialInput(runtime.authorityDid, wallet.address),
    );
    expect(issued.credential.issuer.id).toBe(f.authority);
    expect(
      (
        await verifyCompanyRoleCredential(
          runtime.agent,
          issued.credential,
          wallet.address,
          f.authority,
        )
      ).verified,
    ).toBe(true);
  }
  expect(await readFile(f.config.privateKeyStorePath, 'utf8')).toBe(before);
});
it('fails closed for missing, corrupted, wrong-secret and mismatched issuer material without creating files', async () => {
  const f = await fixture();
  await expect(
    openExistingIssuer({ ...f.environment, VERAMO_KMS_SECRET_KEY: 'c'.repeat(64) }),
  ).rejects.toMatchObject({ code: 'ISSUER_RECOVERY_REQUIRED' });
  await expect(
    openExistingIssuer({ ...f.environment, TRACECHAIN_DATA_DIR: join(directory, 'absent') }),
  ).rejects.toMatchObject({ code: 'ISSUER_RECOVERY_REQUIRED' });
  await expect(stat(join(directory, 'absent'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(
    openExistingIssuer({ ...f.environment, TRACECHAIN_AUTHORITY_DID_ALIAS: 'missing-alias' }),
  ).rejects.toMatchObject({ code: 'ISSUER_RECOVERY_REQUIRED' });
  const metadata = JSON.parse(await readFile(f.config.publicStorePath, 'utf8'));
  Object.values<any>(metadata.keys)[0].publicKeyHex = '00';
  await writeFile(f.config.publicStorePath, JSON.stringify(metadata));
  await expect(openExistingIssuer(f.environment)).rejects.toMatchObject({
    code: 'ISSUER_RECOVERY_REQUIRED',
  });
  await writeFile(f.config.privateKeyStorePath, '{corrupt');
  await expect(openExistingIssuer(f.environment)).rejects.toMatchObject({
    code: 'ISSUER_RECOVERY_REQUIRED',
  });
});
it('compares a newer encrypted bundle, restores with backups, and keeps it available for recovery', async () => {
  const f = await fixture(),
    password = 'synthetic-offline-bundle-password';
  const oldPrivateStore = await readFile(f.config.privateKeyStorePath, 'utf8');
  await createOrGetSupplierIssuerDid(f.agent, Wallet.createRandom().address);
  const privateStore = JSON.parse(await readFile(f.config.privateKeyStorePath, 'utf8'));
  const bundle = await encryptAdminKeystore(
    {
      ipfsEncryptionKey: ipfs,
      veramoKmsSecretKey: kms,
      veramoPrivateKeyStore: privateStore,
      createdAt: new Date().toISOString(),
      keyBundleVersion: 1,
    },
    password,
  );
  const bundlePath = join(directory, 'latest-bundle.json');
  await writeFile(bundlePath, JSON.stringify(bundle));
  const target = join(directory, 'restored'),
    backendEnvironmentPath = join(target, '.env.runtime');
  await mkdir(join(target, 'veramo'), { recursive: true });
  await writeFile(join(target, 'veramo/private-keys.json'), oldPrivateStore);
  await writeFile(backendEnvironmentPath, 'OTHER_SETTING=keep-this\n');
  const options = {
    bundlePath,
    metadataPath: f.config.publicStorePath,
    password,
    dataDirectory: target,
    backendEnvironmentPath,
    authorityAlias: alias,
    environment: f.environment,
  };
  expect(await restoreAdminMaterial(options)).toMatchObject({
    restored: false,
    addedPrivateKeys: 1,
  });
  expect(await readFile(join(target, 'veramo/private-keys.json'), 'utf8')).toBe(oldPrivateStore);
  await expect(
    restoreAdminMaterial({ ...options, password: 'wrong-offline-password', restore: true }),
  ).rejects.toThrow('Incorrect password');
  const result = await restoreAdminMaterial({ ...options, restore: true });
  expect(await readFile(join(result.backupDirectory!, 'private-keys.json'), 'utf8')).toBe(
    oldPrivateStore,
  );
  expect(
    await readFile(join(result.backupDirectory!, 'tracechain-admin-keystore.json'), 'utf8'),
  ).toBe(await readFile(bundlePath, 'utf8'));
  expect(await readFile(backendEnvironmentPath, 'utf8')).toContain('OTHER_SETTING=keep-this');
  const runtime = await openExistingIssuer(
    { ...f.environment, TRACECHAIN_DATA_DIR: target },
    resolver,
  );
  expect(runtime.authorityDid).toBe(f.authority);
  await expect(
    restoreAdminMaterial({
      ...options,
      environment: { ...f.environment, IPFS_ENCRYPTION_KEY: 'd'.repeat(64) },
    }),
  ).rejects.toThrow('differ');
});

it('serves existing encrypted application documents after app restart and denies another company without an unlock endpoint', async () => {
  const f = await fixture(),
    wallet = Wallet.createRandom(),
    other = Wallet.createRandom(),
    applicationId = id('application');
  for (const [key, value] of Object.entries({
    ...f.environment,
    IPFS_PINNING_API_URL: 'https://pin.invalid',
    IPFS_PINNING_TOKEN: 'synthetic',
    IPFS_GATEWAY_URL: 'https://gateway.invalid/ipfs',
  }))
    vi.stubEnv(key, value);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ IpfsHash: 'b' + 'a'.repeat(26) }))),
  );
  let address = wallet.address;
  const authService: any = {
    requireSession: async () => ({
      address,
      onChainAuthorization: { status: 'AUTHORIZED', role: CompanyRole.SUPPLIER },
    }),
  };
  const gateway: any = {
    listApplications: async () => [
      {
        id: applicationId,
        applicant: wallet.address,
        encryptedProfileCid: 'local://legacy',
        status: 1,
      },
    ],
    getAdministrator: async () => other.address,
  };
  const documents = ['registrationProof', 'businessProof', 'authorisationProof'].map((kind) => ({
    kind,
    fileName: 'synthetic.pdf',
    mimeType: 'application/pdf',
    data: Buffer.from('%PDF-test').toString('base64'),
  }));
  const first = createApp({ authService, blockchainGateway: gateway });
  await request(first)
    .post(`/api/blockchain/applications/${applicationId}/documents`)
    .send({ documents })
    .expect(200);
  const restarted = createApp({ authService, blockchainGateway: gateway });
  const opened = await request(restarted)
    .get(`/api/blockchain/applications/${applicationId}/documents`)
    .expect(200);
  expect(opened.body.documents).toHaveLength(3);
  address = other.address;
  await request(restarted)
    .get(`/api/blockchain/applications/${applicationId}/documents`)
    .expect(404);
  for (const path of ['', '/unlock', '/export', '/lock', '/initialize']) {
    await request(restarted)
      .get('/api/admin/keystore' + path)
      .expect(404);
    await request(restarted)
      .post('/api/admin/keystore' + path)
      .send({})
      .expect(404);
  }
});

it('starts and restarts the actual API process from environment secrets without any Admin action', async () => {
  const f = await fixture();
  for (let restart = 0; restart < 2; restart++) {
    const socket = createServer().listen(0);
    await once(socket, 'listening');
    const port = (socket.address() as any).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../../dist/server.js', import.meta.url))],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        windowsHide: true,
        env: {
          ...process.env,
          ...f.environment,
          PORT: String(port),
          IPFS_PINNING_API_URL: 'https://pin.invalid',
          IPFS_PINNING_TOKEN: 'synthetic',
          IPFS_GATEWAY_URL: 'https://gateway.invalid/ipfs',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.add(child);
    let output = '';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API startup timeout')), 15000);
      child.on('error', reject);
      child.on('exit', () => {
        clearTimeout(timer);
        reject(
          new Error(
            'API did not start: ' +
              output.replaceAll(kms, '[redacted]').replaceAll(ipfs, '[redacted]'),
          ),
        );
      });
      child.stdout!.on('data', (chunk) => {
        output += chunk;
        if (output.includes('API listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr!.on('data', (chunk) => {
        output += chunk;
      });
    });
    expect(output).not.toContain(kms);
    expect(output).not.toContain(ipfs);
    expect((await fetch(`http://127.0.0.1:${port}/api/health`)).status).toBe(200);
    child.kill();
    await once(child, 'exit');
    children.delete(child);
  }
}, 35000);

it('exits before listening when a startup secret is invalid, without logging the supplied value', async () => {
  const f = await fixture();
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../dist/server.js', import.meta.url))],
    {
      windowsHide: true,
      env: {
        ...process.env,
        ...f.environment,
        IPFS_ENCRYPTION_KEY: 'never-log-this-invalid-secret',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.add(child);
  let output = '';
  child.stdout!.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr!.on('data', (chunk) => {
    output += chunk;
  });
  const [code] = await once(child, 'exit');
  children.delete(child);
  expect(code).toBe(1);
  expect(output).toContain('IPFS_ENCRYPTION_KEY');
  expect(output).not.toContain('never-log-this-invalid-secret');
  expect(output).not.toContain('API listening');
});
