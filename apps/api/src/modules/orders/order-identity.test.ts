import { createHash, generateKeyPairSync } from 'node:crypto';
import { SDJwtInstance } from '@sd-jwt/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompanyRole } from '@tracechain/shared';
import {
  createTraceChainAgent,
  createOrGetAuthorityDid,
  issueCompanyRoleCredential,
  walletAddressToDid,
  type TraceChainAgent,
} from '@tracechain/ssi';
import { createJWT, EdDSASigner } from 'did-jwt';
import { computeAddress, getAddress, id, isAddress } from 'ethers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProductionFlowService } from '../production-flow/production-flow.service.js';

function holder() {
  const pair = generateKeyPairSync('ed25519');
  const key = pair.privateKey.export({ format: 'jwk' });
  const bytes = Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(key.x!, 'base64url')]);
  let value = BigInt(`0x${bytes.toString('hex')}`),
    encoded = '';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while (value) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return { did: `did:key:z${encoded}`, signer: EdDSASigner(Buffer.from(key.d!, 'base64url')) };
}
let agent: TraceChainAgent, issuer: string, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tracechain-order-proof-'));
  agent = await createTraceChainAgent({
    chainId: 11155111,
    networkName: 'sepolia',
    kmsSecretKey: '7'.repeat(64),
    rpcUrl: 'https://example.invalid',
    publicStorePath: join(directory, 'public.json'),
    privateKeyStorePath: join(directory, 'private.json'),
    resolverOverrides: {
      ethr: async (did, parsed) => {
        const publicKey = parsed.id.split(':').at(-1)!;
        const address = isAddress(publicKey) ? getAddress(publicKey) : computeAddress(publicKey);
        const controller = `${did}#controller`,
          controllerKey = `${did}#controllerKey`;
        return {
          didDocument: {
            id: did,
            verificationMethod: [
              {
                id: controller,
                controller: did,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                blockchainAccountId: `eip155:11155111:${address}`,
              },
              ...(!isAddress(publicKey)
                ? [
                    {
                      id: controllerKey,
                      controller: did,
                      type: 'EcdsaSecp256k1VerificationKey2019',
                      publicKeyHex: publicKey.slice(2),
                    },
                  ]
                : []),
            ],
            authentication: [controller, controllerKey],
            assertionMethod: [controller, controllerKey],
          },
          didDocumentMetadata: {},
          didResolutionMetadata: {},
        };
      },
    },
  });
  issuer = (await createOrGetAuthorityDid(agent, 'order-test-issuer')).identifier.did;
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setup(buyerRole = CompanyRole.MANUFACTURER, selectiveDisclosure = false) {
  const buyer = '0x3000000000000000000000000000000000000003',
    seller = '0x2000000000000000000000000000000000000002';
  const buyerKey = holder();
  const issued = await issueCompanyRoleCredential(agent, {
    applicationReference: id('application'),
    companyId: 'company-id',
    companyName: 'Registered test company',
    companyRegistrationNumber: 'TEST-REG',
    expirationDate: new Date(Date.now() + 3600000),
    issuerDid: issuer,
    issuerOperatorChainId: 31337,
    issuerOperatorWallet: seller,
    role: buyerRole,
    subjectDid: walletAddressToDid(buyer),
    walletAddress: buyer,
  });
  const workflows = new Map<string, any>();
  let active = true;
  let sourceUnavailable = false;
  const auth = {
    requireSession: vi.fn(async (session: string) => ({
      address: session === 'seller' ? seller : buyer,
      chainId: 31337,
      onChainAuthorization: {
        status: 'AUTHORIZED',
        role:
          session === 'seller'
            ? buyerRole === CompanyRole.MANUFACTURER
              ? CompanyRole.SUPPLIER
              : CompanyRole.MANUFACTURER
            : buyerRole,
        credentialHash: issued.credentialHash,
      },
    })),
  };
  const gateway = {
    assertDeployment: async () => {},
    getAccess: async () => active,
    isRoleAuthorized: async (_wallet: string, role: number) =>
      role === (buyerRole === CompanyRole.MANUFACTURER ? 3 : 5),
  };
  const service = new ProductionFlowService({
    agentProvider: async () => agent,
    authService: auth as any,
    gateway: gateway as any,
    ingredientRepository: {} as any,
    repository: {
      findEvidence: async (key) => workflows.get(key),
      saveEvidence: async (record) => {
        workflows.set(record.requestId, record);
      },
    } as any,
    contentStore: {
      encryptAndStore: async (text: string) => ({
        cid: 'encrypted-test-content',
        payload: { ciphertext: text } as any,
      }),
      decrypt: async (payload: any) => payload.ciphertext,
    },
    messagingIdentityRepository: {
      findIdentityByWallet: async () => ({ did: buyerKey.did }) as any,
    },
    companyRoleRepository: {
      list: async () => {
        if (sourceUnavailable) throw new Error('Store unavailable');
        return [
          {
            applicantWallet: buyer,
            credentialHash: issued.credentialHash,
            encryptedPayload: { ciphertext: JSON.stringify(issued.credential) },
          },
        ];
      },
    } as any,
  });
  const orderId = id('bound-order');
  await service.startOrderIdentity('seller', {
    orderId,
    buyer,
    seller,
    batchId: id('proposed-batch'),
    purpose: 'Order-specific company approval',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    requiredClaims: ['companyName', 'role', 'walletAddress'],
    selectiveDisclosure,
    optionalClaims: ['companyId', 'companyRegistrationNumber', 'applicationReference'],
  });
  const material = await service.getCompanyIdentityProofMaterial('buyer', orderId);
  const sign = (changes: Record<string, unknown> = {}, key = buyerKey) =>
    createJWT(
      {
        aud: material.audience,
        nonce: material.challenge,
        exp: material.expiresAt,
        requestId: orderId,
        purpose: material.purpose,
        wallet: buyer,
        role: buyerRole,
        credential: issued.credential,
        credentialHash: issued.credentialHash,
        ...changes,
      },
      { issuer: key.did, signer: key.signer, alg: 'EdDSA' },
    );
  return {
    service,
    orderId,
    material,
    workflows,
    sign,
    buyerKey,
    failSource: () => {
      sourceUnavailable = true;
    },
    revoke: () => {
      active = false;
    },
  };
}
describe('order-bound Company Role VP verification with real holder and authority signatures', () => {
  async function selectiveProof(
    fixture: Awaited<ReturnType<typeof setup>>,
    changes: Record<string, unknown> = {},
    key = fixture.buyerKey,
    claims = ['companyName'],
  ) {
    const instance = new SDJwtInstance<Record<string, unknown>>({
      hashAlg: 'sha-256',
      hasher: (data) =>
        new Uint8Array(
          createHash('sha256')
            .update(typeof data === 'string' ? data : new Uint8Array(data))
            .digest(),
        ),
      kbSignAlg: 'EdDSA',
      kbSigner: async (data) => String(await key.signer(data)),
    });
    return instance.present(
      (fixture.material as any).sdJwt,
      Object.fromEntries(claims.map((claim) => [claim, true])),
      {
        kb: {
          payload: {
            aud: fixture.material.audience,
            nonce: fixture.material.challenge,
            iat: Math.floor(Date.now() / 1000),
            ...changes,
          },
        },
      },
    );
  }
  it.each([CompanyRole.MANUFACTURER, CompanyRole.RETAILER])(
    'verifies selected %s company claims without disclosing unrelated fields',
    async (role) => {
      const fixture = await setup(role, true);
      const proof = await selectiveProof(fixture);
      await fixture.service.presentCompanyIdentityProof('buyer', fixture.orderId, proof);
      const result = await fixture.service.verifyCompanyIdentityProof('seller', fixture.orderId);
      expect(result.credential).toMatchObject({ companyName: 'Registered test company', role });
      expect(result.credential).not.toHaveProperty('companyRegistrationNumber');
      expect(result.credential).not.toHaveProperty('companyId');
      const status = await fixture.service.getCompanyIdentityProofStatus('seller', fixture.orderId);
      expect(status.credential).not.toHaveProperty('companyRegistrationNumber');
      await expect(
        fixture.service.presentCompanyIdentityProof('buyer', fixture.orderId, proof),
      ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_REPLAY' });
    },
  );
  it('rejects missing necessary company claims, wrong key, audience, nonce, expiry and revoked company', async () => {
    const fixture = await setup(CompanyRole.MANUFACTURER, true);
    for (const proof of [
      await selectiveProof(fixture, {}, fixture.buyerKey, []),
      await selectiveProof(fixture, {}, holder()),
      await selectiveProof(fixture, { aud: 'another-verifier' }),
      await selectiveProof(fixture, { nonce: 'another-request' }),
    ])
      await expect(
        fixture.service.validateOrderIdentityPresentation('buyer', fixture.orderId, proof),
      ).rejects.toMatchObject({ code: 'IDENTITY_HOLDER_PROOF_INVALID' });
    const valid = await selectiveProof(fixture);
    fixture.workflows.get(fixture.orderId).identityProof.expiresAt = 1;
    await expect(
      fixture.service.validateOrderIdentityPresentation('buyer', fixture.orderId, valid),
    ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_EXPIRED' });
    fixture.workflows.get(fixture.orderId).identityProof.expiresAt =
      Math.floor(Date.now() / 1000) + 600;
    fixture.revoke();
    await expect(
      fixture.service.validateOrderIdentityPresentation('buyer', fixture.orderId, valid),
    ).rejects.toMatchObject({ code: 'ROLE_AUTHORIZATION_REQUIRED' });
  });
  it('reports unavailable source storage separately from a tampered presentation', async () => {
    const fixture = await setup(CompanyRole.MANUFACTURER, true);
    const proof = await selectiveProof(fixture);
    const tampered = `${proof.slice(0, 10)}x${proof.slice(11)}`;
    await expect(
      fixture.service.validateOrderIdentityPresentation('buyer', fixture.orderId, tampered),
    ).rejects.toMatchObject({ code: 'IDENTITY_HOLDER_PROOF_INVALID' });
    fixture.failSource();
    await expect(
      fixture.service.validateOrderIdentityPresentation('buyer', fixture.orderId, proof),
    ).rejects.toMatchObject({ code: 'IDENTITY_SOURCE_UNAVAILABLE', status: 503 });
  });
  it.each([CompanyRole.MANUFACTURER, CompanyRole.RETAILER])(
    'verifies the full-disclosure %s buyer proof independently of dispatch',
    async (role) => {
      const fixture = await setup(role);
      const proof = await fixture.sign();
      await fixture.service.validateOrderIdentityPresentation('buyer', fixture.orderId, proof);
      await fixture.service.presentCompanyIdentityProof('buyer', fixture.orderId, proof);
      const verified = await fixture.service.orderIdentityAttestation('seller', fixture.orderId);
      expect(verified.checks).toContain('AUTHORITY_SIGNATURE');
      expect(verified.checks).toContain('HOLDER_SIGNATURE');
      expect(verified.credentialHash).toMatch(/^0x[0-9a-f]{64}$/);
      await expect(
        fixture.service.presentCompanyIdentityProof('buyer', fixture.orderId, proof),
      ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_REPLAY' });
      expect(
        (await fixture.service.getCompanyIdentityProofStatus('seller', fixture.orderId)).status,
      ).toBe('VERIFIED');
    },
  );
  it('rejects wrong recipient, request, challenge, holder and expiry', async () => {
    const fixture = await setup();
    for (const changes of [
      { aud: 'another-recipient' },
      { requestId: id('another-order') },
      { nonce: 'other-challenge' },
      { exp: Math.floor(Date.now() / 1000) - 1 },
      { exp: fixture.material.expiresAt + 600 },
    ]) {
      await expect(
        fixture.service.validateOrderIdentityPresentation(
          'buyer',
          fixture.orderId,
          await fixture.sign(changes),
        ),
      ).rejects.toBeDefined();
    }
    await expect(
      fixture.service.validateOrderIdentityPresentation(
        'buyer',
        fixture.orderId,
        await fixture.sign({}, holder()),
      ),
    ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_CONTEXT_MISMATCH' });
  });
  it('rejects required claims missing from the credential and a revoked current authorization', async () => {
    const fixture = await setup();
    fixture.workflows.get(fixture.orderId).identityProof.requiredClaims = ['unavailableClaim'];
    await expect(
      fixture.service.validateOrderIdentityPresentation(
        'buyer',
        fixture.orderId,
        await fixture.sign(),
      ),
    ).rejects.toMatchObject({ code: 'REQUIRED_IDENTITY_CLAIM_MISSING' });
    fixture.workflows.get(fixture.orderId).identityProof.requiredClaims = ['companyName'];
    fixture.revoke();
    await expect(
      fixture.service.validateOrderIdentityPresentation(
        'buyer',
        fixture.orderId,
        await fixture.sign(),
      ),
    ).rejects.toBeDefined();
  });
  it('records an explicit buyer decline without creating a verification result', async () => {
    const fixture = await setup(CompanyRole.RETAILER);
    const result = await fixture.service.declineCompanyIdentityProof('buyer', fixture.orderId);
    expect(result.status).toBe('DECLINED');
    await expect(
      fixture.service.presentCompanyIdentityProof('buyer', fixture.orderId, await fixture.sign()),
    ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_REPLAY' });
  });
});
