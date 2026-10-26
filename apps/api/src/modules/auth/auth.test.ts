import { Wallet } from 'ethers';
import request from 'supertest';
import { SiweMessage } from 'siwe';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { InMemoryNonceRepository, InMemorySessionRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

const DOMAIN = 'localhost:5173';
const URI = 'http://localhost:5173';
const CHAIN_ID = 11155111;
const NONCE_TTL_MS = 5 * 60 * 1_000;

interface TestWallet {
  address: string;
  signMessage(message: string): Promise<string>;
}

describe('SIWE authentication', () => {
  let now: Date;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    now = new Date('2026-10-26T08:00:00.000Z');
    const authService = new AuthService({
      clock: () => new Date(now),
      configuration: {
        chainId: CHAIN_ID,
        domain: DOMAIN,
        nonceTtlMs: NONCE_TTL_MS,
        sessionTtlMs: 8 * 60 * 60 * 1_000,
        uri: URI,
      },
      nonceRepository: new InMemoryNonceRepository(),
      sessionRepository: new InMemorySessionRepository(),
    });

    app = createApp({ authService });
  });

  async function issueNonce(agent: ReturnType<typeof request.agent>, address: string) {
    const response = await agent.post('/api/auth/nonce').send({ address }).expect(201);
    return response.body as { expiresAt: string; nonce: string };
  }

  async function createSignedMessage(
    signer: TestWallet,
    nonce: string,
    options: {
      address?: string;
      chainId?: number;
      domain?: string;
      expirationTime?: string;
      issuedAt?: string;
      uri?: string;
    } = {},
  ) {
    const message = new SiweMessage({
      address: options.address ?? signer.address,
      chainId: options.chainId ?? CHAIN_ID,
      domain: options.domain ?? DOMAIN,
      expirationTime:
        options.expirationTime ?? new Date(now.getTime() + NONCE_TTL_MS).toISOString(),
      issuedAt: options.issuedAt ?? now.toISOString(),
      nonce,
      statement: 'Sign in to TraceChain. This proves wallet ownership only.',
      uri: options.uri ?? URI,
      version: '1',
    }).prepareMessage();

    return { message, signature: await signer.signMessage(message) };
  }

  async function authenticate(agent: ReturnType<typeof request.agent>, wallet: TestWallet) {
    const challenge = await issueNonce(agent, wallet.address);
    const signedMessage = await createSignedMessage(wallet, challenge.nonce, {
      expirationTime: challenge.expiresAt,
    });
    return agent.post('/api/auth/verify').send(signedMessage);
  }

  it('creates a nonce and authenticates a valid wallet signature', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const nonceResponse = await agent.post('/api/auth/nonce').send({ address: wallet.address });

    expect(nonceResponse.status).toBe(201);
    expect(nonceResponse.body.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(nonceResponse.body.expiresAt).toBe(new Date(now.getTime() + NONCE_TTL_MS).toISOString());

    const signedMessage = await createSignedMessage(wallet, nonceResponse.body.nonce, {
      expirationTime: nonceResponse.body.expiresAt,
    });
    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      address: wallet.address,
      authenticated: true,
      credentialVerified: false,
      message: 'Wallet verified. Company Role Credential verification is required.',
    });
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
    expect(response.headers['set-cookie']?.[0]).toContain('SameSite=Lax');
  });

  it('rejects an invalid signature', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const otherWallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, wallet.address);
    const { message } = await createSignedMessage(wallet, challenge.nonce, {
      expirationTime: challenge.expiresAt,
    });

    const response = await agent
      .post('/api/auth/verify')
      .send({ message, signature: await otherWallet.signMessage(message) });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects a SIWE address that differs from the nonce wallet', async () => {
    const agent = request.agent(app);
    const nonceWallet = Wallet.createRandom();
    const messageWallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, nonceWallet.address);
    const signedMessage = await createSignedMessage(messageWallet, challenge.nonce, {
      expirationTime: challenge.expiresAt,
    });

    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ADDRESS_MISMATCH');
  });

  it('rejects an incorrect SIWE domain', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, wallet.address);
    const signedMessage = await createSignedMessage(wallet, challenge.nonce, {
      domain: 'malicious.example',
      expirationTime: challenge.expiresAt,
    });

    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_DOMAIN');
  });

  it('rejects an incorrect SIWE URI', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, wallet.address);
    const signedMessage = await createSignedMessage(wallet, challenge.nonce, {
      expirationTime: challenge.expiresAt,
      uri: 'https://malicious.example',
    });

    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_URI');
  });

  it('rejects an incorrect chain ID', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, wallet.address);
    const signedMessage = await createSignedMessage(wallet, challenge.nonce, {
      chainId: 1,
      expirationTime: challenge.expiresAt,
    });

    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CHAIN');
  });

  it('rejects a SIWE message issued in the future', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, wallet.address);
    const signedMessage = await createSignedMessage(wallet, challenge.nonce, {
      expirationTime: challenge.expiresAt,
      issuedAt: new Date(now.getTime() + 2 * 60 * 1_000).toISOString(),
    });

    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_ISSUED_AT');
  });

  it('rejects a SIWE expiration beyond the nonce lifetime', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, wallet.address);
    const signedMessage = await createSignedMessage(wallet, challenge.nonce, {
      expirationTime: new Date(now.getTime() + NONCE_TTL_MS + 1).toISOString(),
    });

    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_EXPIRATION');
  });

  it('rejects an expired nonce', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, wallet.address);
    const signedMessage = await createSignedMessage(wallet, challenge.nonce, {
      expirationTime: challenge.expiresAt,
    });
    now = new Date(now.getTime() + NONCE_TTL_MS + 1);

    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_NONCE');
  });

  it('rejects a reused nonce', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const challenge = await issueNonce(agent, wallet.address);
    const signedMessage = await createSignedMessage(wallet, challenge.nonce, {
      expirationTime: challenge.expiresAt,
    });

    await agent.post('/api/auth/verify').send(signedMessage).expect(200);
    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_NONCE');
  });

  it('rejects a nonce that was never issued', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();
    const signedMessage = await createSignedMessage(wallet, 'a'.repeat(32));

    const response = await agent.post('/api/auth/verify').send(signedMessage);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_NONCE');
  });

  it('restores authentication from the session cookie', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();

    const authentication = await authenticate(agent, wallet);
    expect(authentication.status).toBe(200);
    const response = await agent.get('/api/auth/session');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      address: wallet.address,
      authenticated: true,
      credentialVerified: false,
    });
  });

  it('removes the session on logout', async () => {
    const agent = request.agent(app);
    const wallet = Wallet.createRandom();

    const authentication = await authenticate(agent, wallet);
    expect(authentication.status).toBe(200);
    await agent.post('/api/auth/logout').expect(204);
    const response = await agent.get('/api/auth/session');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authenticated: false });
  });
});
