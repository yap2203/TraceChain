import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CompanyRole } from '@tracechain/shared';
import type { DIDResolver } from 'did-resolver';
import { computeAddress, getAddress, isAddress, Wallet } from 'ethers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  bootstrapSystemAdmin,
  CompanyRoleCredentialStatus,
  companyRoleCredentialSchema,
  createOrGetAuthorityDid,
  createTraceChainAgent,
  issueCompanyRoleCredential,
  type TraceChainAgent,
  type TraceChainSsiConfig,
  verifyCompanyRoleCredential,
  walletAddressToDid,
} from '../src/index.js';

const TEST_KMS_SECRET = 'a'.repeat(64);
const ADMIN_WALLET = '0x1000000000000000000000000000000000000001';

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
          blockchainAccountId: `eip155:11155111:${address}`,
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

describe('TraceChain SSI foundation', () => {
  let agent: TraceChainAgent;
  let config: TraceChainSsiConfig;
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'tracechain-ssi-'));
    config = {
      chainId: 11_155_111,
      kmsSecretKey: TEST_KMS_SECRET,
      networkName: 'sepolia',
      privateKeyStorePath: join(directory, 'private.json'),
      publicStorePath: join(directory, 'public.json'),
      resolverOverrides: { ethr: localEthrResolver },
      rpcUrl: 'https://example.invalid',
    };
    agent = await createTraceChainAgent(config);
  });

  afterAll(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('creates a Veramo agent with the required plugin methods', () => {
    expect(agent.availableMethods()).toEqual(
      expect.arrayContaining([
        'didManagerCreate',
        'resolveDid',
        'createVerifiableCredential',
        'verifyCredential',
        'createVerifiablePresentation',
        'verifyPresentation',
        'dataStoreSaveVerifiableCredential',
      ]),
    );
  });

  it('creates a did:ethr issuer DID without using a live RPC endpoint', async () => {
    const result = await createOrGetAuthorityDid(agent, 'test-authority');
    expect(result.created).toBe(true);
    expect(result.identifier.did).toMatch(/^did:ethr:sepolia:0x[0-9a-fA-F]{66}$/);
  });

  it('persists and restores DID metadata from the JSON store', async () => {
    const restoredAgent = await createTraceChainAgent(config);
    const restored = await restoredAgent.didManagerGetByAlias({ alias: 'test-authority' });
    expect(restored.did).toMatch(/^did:ethr:sepolia:/);
  });

  it('does not persist private key material as plaintext', async () => {
    const privateStore = JSON.parse(await readFile(config.privateKeyStorePath, 'utf8')) as {
      privateKeys: Record<string, { privateKeyHex: string }>;
    };
    const encryptedValues = Object.values(privateStore.privateKeys).map((key) => key.privateKeyHex);

    expect(encryptedValues.length).toBeGreaterThan(0);
    expect(encryptedValues.every((value) => !/^[0-9a-f]{64}$/i.test(value))).toBe(true);
  });

  it('reuses an authority DID when its alias already exists', async () => {
    const first = await createOrGetAuthorityDid(agent, 'idempotent-authority');
    const second = await createOrGetAuthorityDid(agent, 'idempotent-authority');
    expect(first.identifier.did).toBe(second.identifier.did);
    expect(second.created).toBe(false);
  });

  it('bootstraps the admin once and reuses the active credential', async () => {
    const first = await bootstrapSystemAdmin(agent, {
      adminWalletAddress: ADMIN_WALLET,
      authorityDidAlias: 'bootstrap-authority',
    });
    const second = await bootstrapSystemAdmin(agent, {
      adminWalletAddress: ADMIN_WALLET,
      authorityDidAlias: 'bootstrap-authority',
    });

    expect(first.credentialIssued).toBe(true);
    expect(second.credentialIssued).toBe(false);
    expect(second.credentialId).toBe(first.credentialId);
    expect(second.credentialHash).toBe(first.credentialHash);
  });

  describe('Company Role Credential issuance and verification', () => {
    let authorityDid: string;
    let credential: Awaited<ReturnType<typeof issueCompanyRoleCredential>>['credential'];

    beforeAll(async () => {
      authorityDid = (await createOrGetAuthorityDid(agent, 'verification-authority')).identifier
        .did;
      credential = (
        await issueCompanyRoleCredential(agent, {
          companyId: 'COMPANY-001',
          companyName: 'TraceChain Test Company',
          expirationDate: new Date(Date.now() + 86_400_000),
          issuerDid: authorityDid,
          role: CompanyRole.SUPPLIER,
          subjectDid: walletAddressToDid(ADMIN_WALLET),
          walletAddress: ADMIN_WALLET,
        })
      ).credential;
    });

    it('issues a valid typed JWT Company Role Credential', () => {
      expect(companyRoleCredentialSchema.safeParse(credential).success).toBe(true);
      expect(credential.type).toContain('CompanyRoleCredential');
      expect(credential.proof.jwt).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
      expect(credential.credentialSubject.role).toBe(CompanyRole.SUPPLIER);
    });

    it('verifies a valid credential while keeping authorization disabled', async () => {
      const result = await verifyCompanyRoleCredential(
        agent,
        credential,
        ADMIN_WALLET,
        authorityDid,
      );
      expect(result).toMatchObject({
        authorizationReady: false,
        onChainStatusChecked: false,
        reasons: [],
        role: CompanyRole.SUPPLIER,
        verified: true,
      });
      expect(result.credentialHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects a credential whose signed claims were tampered with', async () => {
      const tampered = structuredClone(credential);
      tampered.credentialSubject.companyName = 'Tampered Company';
      const result = await verifyCompanyRoleCredential(agent, tampered, ADMIN_WALLET, authorityDid);
      expect(result.verified).toBe(false);
      expect(result.reasons).toContain('INVALID_SIGNATURE');
    });

    it('rejects an untrusted issuer', async () => {
      const untrustedDid = (await createOrGetAuthorityDid(agent, 'untrusted-authority')).identifier
        .did;
      const result = await verifyCompanyRoleCredential(
        agent,
        credential,
        ADMIN_WALLET,
        untrustedDid,
      );
      expect(result.reasons).toContain('UNTRUSTED_ISSUER');
    });

    it('rejects a credential bound to a different SIWE wallet', async () => {
      const result = await verifyCompanyRoleCredential(
        agent,
        credential,
        Wallet.createRandom().address,
        authorityDid,
      );
      expect(result.reasons).toContain('WRONG_WALLET');
    });

    it('rejects an expired credential', async () => {
      const result = await verifyCompanyRoleCredential(
        agent,
        credential,
        ADMIN_WALLET,
        authorityDid,
        new Date(Date.now() + 172_800_000),
      );
      expect(result.reasons).toContain('EXPIRED');
    });

    it('rejects an unsupported role', async () => {
      const unsupported = structuredClone(credential) as unknown as Record<string, any>;
      unsupported.credentialSubject.role = 'UNSUPPORTED';
      const result = await verifyCompanyRoleCredential(
        agent,
        unsupported,
        ADMIN_WALLET,
        authorityDid,
      );
      expect(result.reasons).toEqual(['UNSUPPORTED_ROLE']);
    });

    it('rejects malformed credentials', async () => {
      const result = await verifyCompanyRoleCredential(
        agent,
        { credentialSubject: null },
        ADMIN_WALLET,
        authorityDid,
      );
      expect(result.reasons).toEqual(['MALFORMED_CREDENTIAL']);
    });

    it('rejects a credential with a non-active self-declared status', async () => {
      const suspended = structuredClone(credential);
      suspended.credentialStatus.status = CompanyRoleCredentialStatus.SUSPENDED;
      const result = await verifyCompanyRoleCredential(
        agent,
        suspended,
        ADMIN_WALLET,
        authorityDid,
      );
      expect(result.reasons).toEqual(
        expect.arrayContaining(['INACTIVE_STATUS', 'INVALID_SIGNATURE']),
      );
      expect(result.authorizationReady).toBe(false);
    });
  });
});
