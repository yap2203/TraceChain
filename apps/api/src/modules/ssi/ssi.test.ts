import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CompanyRole } from '@tracechain/shared';
import {
  createOrGetAuthorityDid,
  createTraceChainAgent,
  issueCompanyRoleCredential,
  walletAddressToDid,
  type CompanyRoleCredential,
  type TraceChainAgent,
} from '@tracechain/ssi';
import type { DIDResolver } from 'did-resolver';
import { computeAddress, getAddress, isAddress, Wallet } from 'ethers';
import request from 'supertest';
import { SiweMessage } from 'siwe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { InMemoryNonceRepository, InMemorySessionRepository } from '../auth/auth.repository.js';
import { AuthService } from '../auth/auth.service.js';

const DOMAIN = 'localhost:5173';
const URI = 'http://localhost:5173';
const CHAIN_ID = 11_155_111;
const AUTHORITY_ALIAS = 'api-test-authority';
const NOW = new Date('2026-10-26T08:00:00.000Z');

const localEthrResolver: DIDResolver = async (did, parsed) => {
  const identifier = parsed.id.split(':').at(-1) ?? parsed.id;
  const address = isAddress(identifier) ? getAddress(identifier) : computeAddress(identifier);
  const methodId = `${did}#controller`;
  const controllerKeyId = `${did}#controllerKey`;
  const hasEmbeddedPublicKey = !isAddress(identifier);
  return {
    didDocument: {
      '@context': ['https://www.w3.org/ns/did/v1'],
      assertionMethod: hasEmbeddedPublicKey ? [methodId, controllerKeyId] : [methodId],
      authentication: hasEmbeddedPublicKey ? [methodId, controllerKeyId] : [methodId],
      id: did,
      verificationMethod: [
        {
          blockchainAccountId: `eip155:${CHAIN_ID}:${address}`,
          controller: did,
          id: methodId,
          type: 'EcdsaSecp256k1RecoveryMethod2020',
        },
        ...(hasEmbeddedPublicKey
          ? [
              {
                controller: did,
                id: controllerKeyId,
                publicKeyHex: identifier.slice(2),
                type: 'EcdsaSecp256k1VerificationKey2019',
              },
            ]
          : []),
      ],
    },
    didDocumentMetadata: {},
    didResolutionMetadata: { contentType: 'application/did+ld+json' },
  };
};

describe('Company Role Credential presentation API', () => {
  let agent: TraceChainAgent;
  let app: ReturnType<typeof createApp>;
  let authorityDid: string;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tracechain-ssi-api-'));
    agent = await createTraceChainAgent({
      chainId: CHAIN_ID,
      kmsSecretKey: 'b'.repeat(64),
      networkName: 'sepolia',
      privateKeyStorePath: join(directory, 'private.json'),
      publicStorePath: join(directory, 'public.json'),
      resolverOverrides: { ethr: localEthrResolver },
      rpcUrl: 'https://example.invalid',
    });
    authorityDid = (await createOrGetAuthorityDid(agent, AUTHORITY_ALIAS)).identifier.did;
  });

  beforeEach(() => {
    const authService = new AuthService({
      clock: () => new Date(NOW),
      configuration: {
        chainId: CHAIN_ID,
        domain: DOMAIN,
        nonceTtlMs: 300_000,
        sessionTtlMs: 28_800_000,
        uri: URI,
      },
      nonceRepository: new InMemoryNonceRepository(),
      sessionRepository: new InMemorySessionRepository(),
    });
    app = createApp({
      authService,
      ssi: {
        agentProvider: async () => agent,
        authorityDidAlias: AUTHORITY_ALIAS,
        clock: () => new Date(NOW),
      },
    });
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  async function authenticate(client: ReturnType<typeof request.agent>, wallet: Wallet) {
    const challenge = await client
      .post('/api/auth/nonce')
      .send({ address: wallet.address })
      .expect(201);
    const message = new SiweMessage({
      address: wallet.address,
      chainId: CHAIN_ID,
      domain: DOMAIN,
      expirationTime: challenge.body.expiresAt,
      issuedAt: NOW.toISOString(),
      nonce: challenge.body.nonce,
      statement: 'Sign in to TraceChain. This proves wallet ownership only.',
      uri: URI,
      version: '1',
    }).prepareMessage();
    await client
      .post('/api/auth/verify')
      .send({ message, signature: await wallet.signMessage(message) })
      .expect(200);
  }

  async function credentialFor(
    wallet: Wallet,
    overrides: { expirationDate?: Date; issuerDid?: string; role?: CompanyRole } = {},
  ) {
    return (
      await issueCompanyRoleCredential(agent, {
        companyId: 'COMPANY-API-TEST',
        companyName: 'API Test Company',
        expirationDate: overrides.expirationDate ?? new Date(NOW.getTime() + 86_400_000),
        issuanceDate: NOW,
        issuerDid: overrides.issuerDid ?? authorityDid,
        role: overrides.role ?? CompanyRole.SYSTEM_ADMIN,
        subjectDid: walletAddressToDid(wallet.address),
        walletAddress: wallet.address,
      })
    ).credential;
  }

  it('requires a SIWE session', async () => {
    const response = await request(app)
      .post('/api/ssi/company-role/verify')
      .send({ credential: {} });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('locally verifies a trusted credential but keeps authorization locked', async () => {
    const client = request.agent(app);
    const wallet = Wallet.createRandom();
    await authenticate(client, wallet);
    const credential = await credentialFor(wallet);
    const response = await client
      .post('/api/ssi/company-role/verify')
      .send({ credential })
      .expect(200);

    expect(response.body).toMatchObject({
      authorizationReady: false,
      credentialId: credential.id,
      expirationStatus: 'VALID',
      locallyVerified: true,
      onChainStatusChecked: false,
      reasons: [],
      role: CompanyRole.SYSTEM_ADMIN,
      verified: true,
    });
    expect(response.body.session).toMatchObject({
      authorizationReady: false,
      credentialVerified: true,
      locallyVerified: true,
      onChainStatusChecked: false,
      role: CompanyRole.SYSTEM_ADMIN,
    });
    expect(JSON.stringify(response.body)).not.toContain('proof');
    expect(JSON.stringify(response.body)).not.toContain('jwt');
  });

  it('uses only the SIWE wallet and rejects a submitted wallet field', async () => {
    const client = request.agent(app);
    const wallet = Wallet.createRandom();
    await authenticate(client, wallet);
    const response = await client.post('/api/ssi/company-role/verify').send({
      credential: await credentialFor(wallet),
      walletAddress: Wallet.createRandom().address,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects a credential belonging to another wallet without mutating the session', async () => {
    const client = request.agent(app);
    const signedInWallet = Wallet.createRandom();
    await authenticate(client, signedInWallet);
    const response = await client
      .post('/api/ssi/company-role/verify')
      .send({ credential: await credentialFor(Wallet.createRandom()) });
    expect(response.body.reasons).toContain('WRONG_WALLET');
    const session = await client.get('/api/auth/session').expect(200);
    expect(session.body.credentialVerified).toBe(false);
  });

  it('rejects tampered, expired, malformed, and unsupported credentials safely', async () => {
    const client = request.agent(app);
    const wallet = Wallet.createRandom();
    await authenticate(client, wallet);
    const credential = await credentialFor(wallet);
    const tampered = structuredClone(credential);
    tampered.credentialSubject.companyName = 'Tampered';
    const cases: Array<[unknown, string]> = [
      [tampered, 'INVALID_SIGNATURE'],
      [await credentialFor(wallet, { expirationDate: new Date(NOW.getTime() - 1) }), 'EXPIRED'],
      [{ credentialSubject: null }, 'MALFORMED_CREDENTIAL'],
      [
        { ...credential, credentialSubject: { ...credential.credentialSubject, role: 'OWNER' } },
        'UNSUPPORTED_ROLE',
      ],
    ];
    for (const [candidate, reason] of cases) {
      const response = await client
        .post('/api/ssi/company-role/verify')
        .send({ credential: candidate });
      expect(response.status).toBe(200);
      expect(response.body.verified).toBe(false);
      expect(response.body.reasons).toContain(reason);
    }
  });

  it('rejects a credential from an untrusted issuer', async () => {
    const client = request.agent(app);
    const wallet = Wallet.createRandom();
    await authenticate(client, wallet);
    const untrustedDid = (await createOrGetAuthorityDid(agent, 'untrusted-api-issuer')).identifier
      .did;
    const response = await client
      .post('/api/ssi/company-role/verify')
      .send({ credential: await credentialFor(wallet, { issuerDid: untrustedDid }) });
    expect(response.body.reasons).toContain('UNTRUSTED_ISSUER');
  });

  it('updates only the presenting session and restores only a safe summary', async () => {
    const first = request.agent(app);
    const second = request.agent(app);
    const firstWallet = Wallet.createRandom();
    const secondWallet = Wallet.createRandom();
    await authenticate(first, firstWallet);
    await authenticate(second, secondWallet);
    await first
      .post('/api/ssi/company-role/verify')
      .send({ credential: await credentialFor(firstWallet) })
      .expect(200);

    const restored = await first.get('/api/auth/session').expect(200);
    expect(restored.body).toMatchObject({
      credentialVerified: true,
      role: CompanyRole.SYSTEM_ADMIN,
      authorizationReady: false,
    });
    expect(restored.body).not.toHaveProperty('credentialHash');
    expect(restored.body).not.toHaveProperty('issuerDid');
    expect(restored.body).not.toHaveProperty('subjectDid');
    expect((await second.get('/api/auth/session')).body.credentialVerified).toBe(false);
  });

  it('removes the credential summary on logout and requires verification for a new wallet session', async () => {
    const client = request.agent(app);
    const wallet = Wallet.createRandom();
    await authenticate(client, wallet);
    await client
      .post('/api/ssi/company-role/verify')
      .send({ credential: await credentialFor(wallet) })
      .expect(200);
    await client.post('/api/auth/logout').expect(204);
    expect((await client.get('/api/auth/session')).body).toEqual({ authenticated: false });

    const nextWallet = Wallet.createRandom();
    await authenticate(client, nextWallet);
    expect((await client.get('/api/auth/session')).body.credentialVerified).toBe(false);
  });
});
