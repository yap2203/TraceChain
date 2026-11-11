import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';

import { SDJwtInstance, type PresentationFrame } from '@sd-jwt/core';
import { Resolver } from 'did-resolver';
import { bytesToBase64url, decodeJWT, extractPublicKeyBytes, verifyJWS } from 'did-jwt';
import { id } from 'ethers';
import { getResolver } from 'key-did-resolver';
import { z } from 'zod';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';

export const INGREDIENT_SD_JWT_VCT = 'urn:tracechain:credential:ingredient:sd-jwt:v1';

const claimText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'Must not be blank.');
const claimDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const issuanceInputSchema = z
  .object({
    claims: z
      .object({
        allergenDeclaration: z.string().max(500).optional(),
        batchId: claimText(120),
        batchReference: claimText(120).optional(),
        certificationDetails: z.array(claimText(120)).max(20).optional(),
        countryOfOrigin: claimText(160).optional(),
        credentialId: claimText(512),
        exactSourceFacility: z.string().max(2000).optional(),
        expiryDate: claimDate.optional(),
        ingredientName: claimText(160),
        internalQualityRemarks: z.string().max(4000).optional(),
        productionDate: claimDate.optional(),
        qualityTestSummary: z.string().max(4000).optional(),
        supplierWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      })
      .strict(),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    issuedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    holderDid: z.string().startsWith('did:key:'),
    issuerDid: z.string().startsWith('did:'),
  })
  .strict()
  .refine((value) => value.expiresAt > value.issuedAt, 'Credential expiry must follow issuance.');

export interface IngredientSdJwtClaims {
  allergenDeclaration?: string;
  batchId: string;
  batchReference?: string;
  certificationDetails?: string[];
  countryOfOrigin?: string;
  credentialId: string;
  exactSourceFacility?: string;
  expiryDate?: string;
  ingredientName: string;
  internalQualityRemarks?: string;
  productionDate?: string;
  qualityTestSummary?: string;
  supplierWallet: string;
}

export interface IssueIngredientSdJwtInput {
  claims: IngredientSdJwtClaims;
  expiresAt: number;
  holderDid: string;
  issuerDid: string;
  issuedAt: number;
}

const selectiveClaims = [
  'allergenDeclaration',
  'certificationDetails',
  'countryOfOrigin',
  'exactSourceFacility',
  'expiryDate',
  'internalQualityRemarks',
  'productionDate',
  'qualityTestSummary',
] as const;

export async function issueIngredientSdJwt(
  agent: TraceChainAgent,
  input: IssueIngredientSdJwtInput,
) {
  issuanceInputSchema.parse(input);
  const holderJwk = await holderPublicJwk(input.holderDid);
  const issuer = await agent.didManagerGet({ did: input.issuerDid });
  const issuerKey = issuer.keys[0];
  if (!issuerKey) throw new Error('The Supplier issuer DID has no managed signing key.');
  const instance = issuerInstance(agent, issuerKey.kid);
  const payload = {
    cnf: { jwk: holderJwk },
    exp: input.expiresAt,
    iat: input.issuedAt,
    iss: input.issuerDid,
    sub: input.claims.supplierWallet.toLowerCase(),
    vct: INGREDIENT_SD_JWT_VCT,
    ...input.claims,
  };
  const disclosed = selectiveClaims.filter((claim) => payload[claim] !== undefined);
  return instance.issue<Record<string, unknown>>(
    payload as Record<string, unknown>,
    { _sd: disclosed } as never,
    { header: { kid: issuerKey.kid, typ: 'dc+sd-jwt' } },
  );
}

export async function verifyIngredientSdJwtPresentation(
  agent: TraceChainAgent,
  presentation: string,
  input: {
    audience: string;
    batchId: string;
    nonce: string;
    now: number;
    requiredClaims: string[];
    supplierWallet: string;
  },
) {
  const instance = verifierInstance(agent);
  const result = await instance.verify(presentation, {
    allowedIssuerAlgorithms: ['ES256K', 'ES256K-R'],
    allowedKeyBindingAlgorithms: ['EdDSA'],
    currentDate: input.now,
    expectedKeyBindingAudience: input.audience,
    expectedVct: INGREDIENT_SD_JWT_VCT,
    keyBindingMaxAgeSeconds: 300,
    keyBindingNonce: input.nonce,
    requiredClaimKeys: [
      'iss',
      'vct',
      'cnf',
      'credentialId',
      'ingredientName',
      'batchId',
      'supplierWallet',
      ...input.requiredClaims,
    ],
  });
  const presentedBatch = String(result.payload.batchId ?? '');
  const batchMatches =
    presentedBatch.toLowerCase() === input.batchId.toLowerCase() ||
    id(presentedBatch).toLowerCase() === input.batchId.toLowerCase();
  if (!batchMatches) throw new Error('The selective presentation is bound to a different batch.');
  if (String(result.payload.supplierWallet).toLowerCase() !== input.supplierWallet.toLowerCase())
    throw new Error('The selective presentation is bound to a different Supplier.');
  return result;
}

export async function verifyIssuedIngredientSdJwt(
  agent: TraceChainAgent,
  credential: string,
  input: { now: number; supplierWallet: string },
) {
  const result = await verifierInstance(agent).verify(credential, {
    allowedIssuerAlgorithms: ['ES256K', 'ES256K-R'],
    currentDate: input.now,
    expectedVct: INGREDIENT_SD_JWT_VCT,
    requiredClaimKeys: [
      'iss',
      'vct',
      'cnf',
      'credentialId',
      'ingredientName',
      'batchId',
      'supplierWallet',
    ],
  });
  if (String(result.payload.supplierWallet).toLowerCase() !== input.supplierWallet.toLowerCase())
    throw new Error('The SD-JWT credential belongs to a different Supplier.');
  return result;
}

export function selectivePresentationFrame(claims: string[]) {
  return Object.fromEntries(claims.map((claim) => [claim, true])) as PresentationFrame<
    Record<string, unknown>
  >;
}

export async function readIngredientSdJwtClaims(presentation: string) {
  return new SDJwtInstance<Record<string, unknown>>({ hashAlg: 'sha-256', hasher }).getClaims(
    presentation,
  );
}

export function issuerInstance(agent: TraceChainAgent, keyRef: string) {
  return new SDJwtInstance<Record<string, unknown>>({
    hashAlg: 'sha-256',
    hasher,
    saltGenerator: (length) => randomBytes(Math.max(length, 16)).toString('base64url'),
    signAlg: 'ES256K',
    signer: (data) =>
      agent.keyManagerSign({
        algorithm: 'ES256K',
        data,
        encoding: 'utf-8',
        keyRef,
      }),
  });
}

export function verifierInstance(agent: TraceChainAgent) {
  return new SDJwtInstance<Record<string, unknown>>({
    hashAlg: 'sha-256',
    hasher,
    kbVerifier: async (data, signature, payload) => {
      const jwk = payload.cnf?.jwk;
      if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') return false;
      try {
        return verifySignature(
          null,
          Buffer.from(data),
          createPublicKey({ format: 'jwk', key: jwk as JsonWebKey }),
          Buffer.from(signature, 'base64url'),
        );
      } catch {
        return false;
      }
    },
    verifier: async (data, signature) => {
      try {
        const decoded = decodeJWT(`${data}.${signature}`);
        const issuer = String(decoded.payload.iss ?? '');
        const keyId = String(decoded.header.kid ?? '');
        let methods: Array<{
          controller: string;
          id: string;
          publicKeyHex: string;
          type: string;
        }> = [];
        try {
          const managed = await agent.didManagerGet({ did: issuer });
          methods = managed.keys
            .filter((key) => !keyId || key.kid === keyId)
            .map((key) => ({
              controller: issuer,
              id: key.kid,
              publicKeyHex: key.publicKeyHex,
              type: 'EcdsaSecp256k1VerificationKey2019',
            }));
        } catch {
          // External issuers fall back to normal DID resolution below.
        }
        if (methods.length === 0) {
          const resolved = await agent.resolveDid({ didUrl: issuer });
          methods = (resolved.didDocument?.verificationMethod ?? []) as typeof methods;
        }
        verifyJWS(`${data}.${signature}`, methods);
        return true;
      } catch {
        return false;
      }
    },
  });
}

export async function holderPublicJwk(holderDid: string) {
  if (!holderDid.startsWith('did:key:')) throw new Error('A did:key holder identity is required.');
  const resolved = await new Resolver(getResolver()).resolve(holderDid);
  const method = resolved.didDocument?.verificationMethod?.find(
    (candidate) =>
      candidate.type === 'Ed25519VerificationKey2018' ||
      candidate.type === 'Ed25519VerificationKey2020' ||
      candidate.type === 'Multikey',
  );
  if (!method) throw new Error('The holder DID has no Ed25519 verification key.');
  const { keyBytes, keyType } = extractPublicKeyBytes(method);
  if (keyType && keyType !== 'Ed25519')
    throw new Error('The holder DID verification key is not Ed25519.');
  return { crv: 'Ed25519', kty: 'OKP', x: bytesToBase64url(keyBytes) };
}

async function hasher(data: string | ArrayBuffer, algorithm: string) {
  if (algorithm !== 'sha-256') throw new Error(`Unsupported disclosure hash: ${algorithm}`);
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}
