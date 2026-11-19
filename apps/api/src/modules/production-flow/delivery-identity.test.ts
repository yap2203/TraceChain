import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CompanyRole } from '@tracechain/shared';
import { computeAddress, getAddress, id, isAddress } from 'ethers';
import {
  createTraceChainAgent,
  createOrGetAuthorityDid,
  issueCompanyRoleCredential,
  walletAddressToDid,
} from '@tracechain/ssi';
import { expect, it, vi } from 'vitest';
import { ProductionFlowService } from './production-flow.service.js';
import type { EvidenceWorkflowRecord } from './production-flow.repository.js';

it.each([CompanyRole.SUPPLIER, CompanyRole.MANUFACTURER])(
  'uses a real %s Company VC and browser-held selective proof for a Distributor, rejecting substitution, replay and current revocation',
  async (sellerRole) => {
    const directory = await mkdtemp(join(tmpdir(), 'tracechain-delivery-proof-'));
    try {
      // Import the existing browser signer as an integration boundary, not a production API dependency.
      const browser = await import(
        new URL('../../../../web/src/features/didcomm/didcomm-agent.ts', import.meta.url).href
      );
      const holder = await browser.createMessagingAgent(),
        attacker = await browser.createMessagingAgent();
      const agent = await createTraceChainAgent({
        chainId: 11155111,
        kmsSecretKey: 'a'.repeat(64),
        networkName: 'sepolia',
        rpcUrl: 'https://example.invalid',
        privateKeyStorePath: join(directory, 'private.json'),
        publicStorePath: join(directory, 'public.json'),
        resolverOverrides: {
          ethr: async (did, parsed) => {
            const key = parsed.id.split(':').at(-1)!,
              address = isAddress(key) ? getAddress(key) : computeAddress(key);
            return {
              didDocument: {
                id: did,
                authentication: [`${did}#controller`, `${did}#controllerKey`],
                assertionMethod: [`${did}#controller`, `${did}#controllerKey`],
                verificationMethod: [
                  {
                    id: `${did}#controller`,
                    controller: did,
                    type: 'EcdsaSecp256k1RecoveryMethod2020',
                    blockchainAccountId: `eip155:11155111:${address}`,
                  },
                  ...(!isAddress(key)
                    ? [
                        {
                          id: `${did}#controllerKey`,
                          controller: did,
                          type: 'EcdsaSecp256k1VerificationKey2019',
                          publicKeyHex: key.slice(2),
                        },
                      ]
                    : []),
                ],
              },
              didDocumentMetadata: {},
              didResolutionMetadata: { contentType: 'application/did+ld+json' },
            };
          },
        },
      });
      const issuer = await createOrGetAuthorityDid(agent, 'delivery-proof-authority');
      const supplier = '0x2000000000000000000000000000000000000002',
        distributor = '0x4000000000000000000000000000000000000004';
      const now = new Date(),
        expiresAt = Math.floor(now.getTime() / 1000) + 600;
      const issued = await issueCompanyRoleCredential(agent, {
        applicationReference: id('supplier-application'),
        companyId: 'supplier-id',
        companyName: 'Integration Supplier',
        companyRegistrationNumber: 'TEST-SUPPLIER-1',
        expirationDate: new Date(now.getTime() + 86400000),
        issuanceDate: new Date(now.getTime() - 1000),
        issuerDid: issuer.identifier.did,
        issuerOperatorChainId: 11155111,
        issuerOperatorWallet: '0x1000000000000000000000000000000000000001',
        role: sellerRole,
        subjectDid: walletAddressToDid(supplier),
        walletAddress: supplier,
      });
      const workflows = new Map<string, EvidenceWorkflowRecord>(),
        contents = new Map<string, string>();
      const credentialPayload = {
        algorithm: 'aes-256-gcm',
        version: 1,
        ciphertext: 'source-record',
        authTag: '',
        iv: '',
      };
      contents.set(credentialPayload.ciphertext, JSON.stringify(issued.credential));
      let current: {
          address: string;
          onChainAuthorization: { status: string; role: CompanyRole; credentialHash: string };
        } = {
          address: distributor,
          onChainAuthorization: {
            status: 'AUTHORIZED',
            role: CompanyRole.DISTRIBUTOR,
            credentialHash: id('carrier-company'),
          },
        },
        activeSupplier = true;
      const access = vi.fn(
        async (wallet: string, hash: string) =>
          wallet !== supplier ||
          (activeSupplier &&
            hash.replace(/^0x/, '').toLowerCase() ===
              issued.credentialHash.replace(/^0x/, '').toLowerCase()),
      );
      const service = new ProductionFlowService({
        authService: { requireSession: async () => current } as any,
        agentProvider: async () => agent,
        clock: () => new Date(),
        gateway: {
          assertDeployment: async () => undefined,
          getAccess: access,
          isRoleAuthorized: async (_wallet: string, role: number) =>
            role === (sellerRole === CompanyRole.SUPPLIER ? 2 : 3),
        } as any,
        ingredientRepository: {} as any,
        repository: {
          findEvidence: async (key: string) => workflows.get(key),
          saveEvidence: async (record: EvidenceWorkflowRecord) => {
            workflows.set(record.requestId, record);
          },
        } as any,
        contentStore: {
          decrypt: async (payload: any) => contents.get(payload.ciphertext)!,
          encryptAndStore: async (value: string) => {
            const key = crypto.randomUUID();
            contents.set(key, value);
            return { cid: key, payload: { ...credentialPayload, ciphertext: key } };
          },
        },
        companyRoleRepository: {
          list: async () => [
            {
              applicantWallet: supplier,
              credentialHash: issued.credentialHash,
              encryptedPayload: credentialPayload,
            },
          ],
        } as any,
        messagingIdentityRepository: {
          findIdentityByWallet: async (wallet: string) =>
            wallet === supplier ? ({ did: holder.did, wallet: supplier } as any) : undefined,
        },
        validateDeliveryIdentity: async () => true,
      });
      const requestId = id('carrier-proof'),
        purpose = 'Verify Supplier company before ingredient pickup';
      await service.startOrderIdentity('session', {
        deliveryOrderId: id('quantity-order'),
        orderId: requestId,
        buyer: supplier,
        seller: distributor,
        batchId: id('ingredient'),
        purpose,
        expiresAt,
        requiredClaims: ['companyId', 'role', 'walletAddress'],
        optionalClaims: ['companyName'],
        selectiveDisclosure: true,
      });
      current = {
        address: supplier,
        onChainAuthorization: {
          status: 'AUTHORIZED',
          role: sellerRole,
          credentialHash: issued.credentialHash,
        },
      };
      const material = (await service.getCompanyIdentityProofMaterial('session', requestId)) as any;
      const sign = (signer: any, audience = material.audience) =>
        browser.createSelectiveCompanyIdentityPresentation(signer, material.sdJwt, {
          audience,
          nonce: material.challenge,
          claims: [...material.requiredClaims, 'companyName'],
        });
      await expect(
        service.validateOrderIdentityPresentation(
          'session',
          requestId,
          await sign(holder, 'wrong-recipient'),
        ),
      ).rejects.toBeDefined();
      await expect(
        service.validateOrderIdentityPresentation('session', requestId, await sign(attacker)),
      ).rejects.toBeDefined();
      const presentation = await sign(holder);
      await expect(
        service.validateOrderIdentityPresentation(
          'session',
          requestId,
          presentation.slice(0, -3) + 'bad',
        ),
      ).rejects.toBeDefined();
      await service.presentCompanyIdentityProof('session', requestId, presentation);
      await expect(
        service.presentCompanyIdentityProof('session', requestId, presentation),
      ).rejects.toMatchObject({ code: 'IDENTITY_PROOF_REPLAY' });
      current = {
        address: distributor,
        onChainAuthorization: {
          status: 'AUTHORIZED',
          role: CompanyRole.DISTRIBUTOR,
          credentialHash: id('carrier-company'),
        },
      };
      const verified = await service.verifyCompanyIdentityProof('session', requestId);
      expect(verified.status).toBe('VERIFIED');
      expect(verified.checks).toContain('HOLDER_SIGNATURE');
      expect(verified.credential).toMatchObject({
        companyName: 'Integration Supplier',
        role: sellerRole,
      });
      expect(verified.credential).not.toHaveProperty('companyRegistrationNumber');
      expect(access).toHaveBeenCalledWith(
        supplier,
        expect.any(String),
        sellerRole === CompanyRole.SUPPLIER ? 2 : 3,
        sellerRole === CompanyRole.SUPPLIER ? 'ISSUE_INGREDIENT_CREDENTIAL' : 'INITIATE_TRANSFER',
      );
      activeSupplier = false;
      const historical = structuredClone(workflows.get(requestId)!.identityProof);
      await expect(service.verifyCompanyIdentityProof('session', requestId)).rejects.toMatchObject({
        code: 'COMPANY_CREDENTIAL_INACTIVE',
      });
      // An earlier successful verification cannot authorize a new protected attestation.
      await expect(service.orderIdentityAttestation('session', requestId)).rejects.toMatchObject({
        code: 'COMPANY_CREDENTIAL_INACTIVE',
      });
      expect(workflows.get(requestId)!.identityProof).toEqual(historical);
      expect(historical?.status).toBe('VERIFIED');
      expect(historical?.verifiedAt).toBeTruthy();
      activeSupplier = true;
      expect((await service.verifyCompanyIdentityProof('session', requestId)).status).toBe(
        'VERIFIED',
      );
    } finally {
      if (dirname(resolve(directory)).toLowerCase() !== resolve(tmpdir()).toLowerCase())
        throw new Error('Unexpected test temporary directory.');
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
