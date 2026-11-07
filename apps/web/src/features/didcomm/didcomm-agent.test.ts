import { describe, expect, it } from 'vitest';
import { SDJwtInstance } from '@sd-jwt/core';
import { Resolver } from 'did-resolver';
import { verifyJWT } from 'did-jwt';
import {
  bytesToBase64url,
  decodeJWT,
  EdDSASigner,
  extractPublicKeyBytes,
  verifyJWS,
} from 'did-jwt';
import { getResolver } from 'key-did-resolver';
import {
  createBindingProof,
  createSelectiveIngredientPresentation,
  createMessagingAgent,
  exportRecoveryKit,
  importRecoveryKit,
  packMessage,
  unpackMessage,
} from './didcomm-agent';

describe('browser-held DIDComm authenticated encryption', () => {
  it('exports and restores an encrypted participant-controlled recovery kit', async () => {
    const holder = await createMessagingAgent();
    const kit = await exportRecoveryKit(holder, 'correct horse battery staple');
    expect(kit).not.toContain(btoa(String.fromCharCode(...holder.privateKey)));
    await expect(importRecoveryKit(kit, 'wrong password')).rejects.toThrow(
      'The recovery password is incorrect or the encrypted recovery kit is damaged.',
    );
    const restored = await importRecoveryKit(kit, 'correct horse battery staple');
    expect(restored.did).toBe(holder.did);
  });

  it('creates a verifiable wallet, domain, purpose, chain and nonce-bound key proof', async () => {
    const holder = await createMessagingAgent();
    const proof = await createBindingProof(holder, {
      chainId: 31337,
      domain: 'localhost',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      nonce: 'fresh-server-challenge',
      purpose: 'tracechain-didcomm-messaging-key-binding',
      wallet: '0x1000000000000000000000000000000000000001',
    });
    const verified = await verifyJWT(proof, {
      audience: 'localhost',
      resolver: new Resolver(getResolver()),
    });
    expect(verified.issuer).toBe(holder.did);
    expect(verified.payload).toMatchObject({
      aud: 'localhost',
      chainId: 31337,
      nonce: 'fresh-server-challenge',
      purpose: 'tracechain-didcomm-messaging-key-binding',
      sub: '0x1000000000000000000000000000000000000001',
    });
  });

  it('packs and unpacks between separate participant keys', async () => {
    const manufacturer = await createMessagingAgent();
    const supplier = await createMessagingAgent();
    const message = {
      body: { businessReference: 'REQ-1', reason: 'Verify origin' },
      created_time: Math.floor(Date.now() / 1000),
      expires_time: Math.floor(Date.now() / 1000) + 300,
      from: manufacturer.did,
      id: crypto.randomUUID(),
      thid: crypto.randomUUID(),
      to: [supplier.did],
      type: 'https://tracechain.local/didcomm/ingredient-evidence-request/1.0',
    };
    const envelope = await packMessage(manufacturer, message);
    expect(envelope).not.toContain('Verify origin');
    const unpacked = await unpackMessage(supplier, envelope);
    expect(unpacked).toEqual(message);
  });

  it('rejects a wrong recipient and a tampered envelope', async () => {
    const manufacturer = await createMessagingAgent();
    const supplier = await createMessagingAgent();
    const attacker = await createMessagingAgent();
    const envelope = await packMessage(manufacturer, {
      body: { reason: 'Confidential' },
      from: manufacturer.did,
      id: crypto.randomUUID(),
      to: [supplier.did],
      type: 'test',
    });
    await expect(unpackMessage(attacker, envelope)).rejects.toThrow();
    const parsed = JSON.parse(envelope) as { ciphertext: string };
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -2)}aa`;
    await expect(unpackMessage(supplier, JSON.stringify(parsed))).rejects.toThrow();
  });

  it('creates holder-bound presentations with genuinely different selective disclosures', async () => {
    const issuer = await createMessagingAgent();
    const holder = await createMessagingAgent();
    const resolver = new Resolver(getResolver());
    const holderDocument = await resolver.resolve(holder.did);
    const holderMethod = holderDocument.didDocument?.verificationMethod?.find(
      (method) =>
        method.type === 'Ed25519VerificationKey2018' ||
        method.type === 'Ed25519VerificationKey2020' ||
        method.type === 'Multikey',
    );
    expect(holderMethod).toBeTruthy();
    const holderJwk = {
      crv: 'Ed25519',
      kty: 'OKP',
      x: bytesToBase64url(extractPublicKeyBytes(holderMethod!).keyBytes),
    };
    const hasher = async (data: string | ArrayBuffer) => {
      const bytes =
        typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
    };
    const issuerInstance = new SDJwtInstance<Record<string, unknown>>({
      hashAlg: 'sha-256',
      hasher,
      saltGenerator: (length) =>
        btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(Math.max(16, length))))),
      signAlg: 'EdDSA',
      signer: async (data) => {
        const signature = await EdDSASigner(issuer.privateKey)(data);
        if (typeof signature !== 'string') throw new Error('Unexpected issuer signature format.');
        return signature;
      },
    });
    const credential = await issuerInstance.issue(
      {
        batchId: 'BATCH-1',
        cnf: { jwk: holderJwk },
        countryOfOrigin: 'Malaysia',
        ingredientName: 'Cocoa',
        internalQualityRemarks: 'Internal only',
        iss: issuer.did,
        supplierWallet: '0x2000000000000000000000000000000000000002',
      },
      { _sd: ['countryOfOrigin', 'internalQualityRemarks'] } as never,
    );
    const originOnly = await createSelectiveIngredientPresentation(holder, credential, {
      audience: '0x3000000000000000000000000000000000000003',
      claims: ['countryOfOrigin'],
      nonce: 'request-challenge',
    });
    const remarksOnly = await createSelectiveIngredientPresentation(holder, credential, {
      audience: '0x3000000000000000000000000000000000000003',
      claims: ['internalQualityRemarks'],
      nonce: 'request-challenge-2',
    });
    expect(originOnly).not.toContain('Internal only');
    expect(remarksOnly).not.toContain('Malaysia');

    const verifier = new SDJwtInstance<Record<string, unknown>>({
      hashAlg: 'sha-256',
      hasher,
      kbVerifier: async (data, signature, payload) => {
        const key = await crypto.subtle.importKey(
          'jwk',
          payload.cnf!.jwk as JsonWebKey,
          { name: 'Ed25519' },
          false,
          ['verify'],
        );
        return crypto.subtle.verify(
          'Ed25519',
          key,
          Uint8Array.from(
            atob(
              signature
                .replace(/-/g, '+')
                .replace(/_/g, '/')
                .padEnd(Math.ceil(signature.length / 4) * 4, '='),
            ),
            (character) => character.charCodeAt(0),
          ),
          new TextEncoder().encode(data),
        );
      },
      verifier: async (data, signature) => {
        const decoded = decodeJWT(`${data}.${signature}`);
        const document = await resolver.resolve(String(decoded.payload.iss));
        try {
          verifyJWS(`${data}.${signature}`, document.didDocument?.verificationMethod ?? []);
          return true;
        } catch {
          return false;
        }
      },
    });
    const verified = await verifier.verify(originOnly, {
      allowedIssuerAlgorithms: ['EdDSA'],
      allowedKeyBindingAlgorithms: ['EdDSA'],
      expectedKeyBindingAudience: '0x3000000000000000000000000000000000000003',
      keyBindingNonce: 'request-challenge',
      requiredClaimKeys: ['batchId', 'ingredientName', 'countryOfOrigin'],
    });
    expect(verified.payload).toMatchObject({ countryOfOrigin: 'Malaysia' });
    expect(verified.payload).not.toHaveProperty('internalQualityRemarks');
    await expect(
      verifier.verify(originOnly, {
        expectedKeyBindingAudience: '0x4000000000000000000000000000000000000004',
        keyBindingNonce: 'request-challenge',
      }),
    ).rejects.toThrow();
    await expect(
      verifier.verify(originOnly, {
        expectedKeyBindingAudience: '0x3000000000000000000000000000000000000003',
        keyBindingNonce: 'different-request-challenge',
      }),
    ).rejects.toThrow();
    await expect(
      verifier.verify(originOnly, {
        expectedKeyBindingAudience: '0x3000000000000000000000000000000000000003',
        keyBindingNonce: 'request-challenge',
        requiredClaimKeys: ['internalQualityRemarks'],
      }),
    ).rejects.toThrow();
    const wrongHolderPresentation = await createSelectiveIngredientPresentation(
      issuer,
      credential,
      {
        audience: '0x3000000000000000000000000000000000000003',
        claims: ['countryOfOrigin'],
        nonce: 'request-challenge',
      },
    );
    await expect(
      verifier.verify(wrongHolderPresentation, {
        expectedKeyBindingAudience: '0x3000000000000000000000000000000000000003',
        keyBindingNonce: 'request-challenge',
      }),
    ).rejects.toThrow();
    const parts = originOnly.split('~');
    parts[1] = `${parts[1]!.slice(0, -1)}${parts[1]!.endsWith('a') ? 'b' : 'a'}`;
    await expect(
      verifier.verify(parts.join('~'), {
        expectedKeyBindingAudience: '0x3000000000000000000000000000000000000003',
        keyBindingNonce: 'request-challenge',
      }),
    ).rejects.toThrow();
  });
});
