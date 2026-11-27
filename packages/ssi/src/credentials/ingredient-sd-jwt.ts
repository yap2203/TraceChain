import {
  WALLET_HOLDER_BINDING,
  parseWalletPresentation,
  presentationSdJwt,
  verifyWalletPresentation,
  type WalletProofContext,
} from '@tracechain/shared';
import {
  ingredientCertificationSchema,
  ingredientQualityTestSchema,
  ingredientAllergenSchema,
  certificationDocumentSchema,
} from './ingredient-details.js';
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';

import { SDJwtInstance, type PresentationFrame } from '@sd-jwt/core';
import { Resolver } from 'did-resolver';
import { bytesToBase64url, decodeJWT, extractPublicKeyBytes, verifyJWS } from 'did-jwt';
import { id, getAddress } from 'ethers';
import { getResolver } from 'key-did-resolver';
import { z } from 'zod';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';

export const INGREDIENT_SD_JWT_VCT_V3 = 'urn:tracechain:credential:ingredient:sd-jwt:v3';
export const INGREDIENT_SD_JWT_VCT_V2 = 'urn:tracechain:credential:ingredient:sd-jwt:v2';
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
        policyVersion: z.literal(2).optional(),
        supplierDid: z.string().startsWith('did:').optional(),
        processingCountry: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        allergenDeclaration: z.union([z.string().max(500), ingredientAllergenSchema]).optional(),
        batchId: claimText(120),
        batchReference: claimText(120).optional(),
        certificationDetails: z.array(claimText(120)).max(20).optional(),
        countryOfOrigin: claimText(160).optional(),
        originCountryCode: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        originRegion: claimText(160).optional(),
        originCity: claimText(160).optional(),
        privateOriginAddress: claimText(1000).optional(),
        processingLocation: claimText(1000).optional(),
        credentialId: claimText(512),
        exactSourceFacility: z.string().max(2000).optional(),
        expiryDate: claimDate.optional(),
        ingredientName: claimText(160),
        category: claimText(80).optional(),
        quantity: z
          .string()
          .regex(/^[1-9]\d{0,38}$/)
          .optional(),
        unit: claimText(31).optional(),
        internalQualityRemarks: z.string().max(4000).optional(),
        productionDate: claimDate.optional(),
        productionDateMeaning: z.enum(['production', 'processing']).optional(),
        qualityTestSummary: z.string().max(4000).optional(),
        supplierWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      })
      .catchall(z.unknown())
      .superRefine((claims, ctx) => {
        const known = [
          'policyVersion',
          'supplierDid',
          'processingCountry',
          'allergenDeclaration',
          'batchId',
          'batchReference',
          'certificationDetails',
          'countryOfOrigin',
          'processingCountry',
          'originCountryCode',
          'originRegion',
          'originCity',
          'privateOriginAddress',
          'processingLocation',
          'credentialId',
          'exactSourceFacility',
          'expiryDate',
          'ingredientName',
          'category',
          'quantity',
          'unit',
          'internalQualityRemarks',
          'productionDate',
          'productionDateMeaning',
          'qualityTestSummary',
          'supplierWallet',
        ];
        for (const [key, value] of Object.entries(claims)) {
          if (
            /^qualityTest_[a-f0-9]{32}$/.test(key) &&
            (!value ||
              typeof value !== 'object' ||
              'documents' in value ||
              !ingredientQualityTestSchema.safeParse({ ...(value as object), documents: [] })
                .success ||
              (value as { id?: string }).id?.replaceAll('-', '') !==
                key.slice('qualityTest_'.length))
          )
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: 'Invalid laboratory test context.',
            });
          if (
            /^qualityDocuments_[a-f0-9]{32}$/.test(key) &&
            !z
              .object({
                qualityTestId: z.uuid(),
                documents: z.array(certificationDocumentSchema).length(1),
              })
              .strict()
              .safeParse(value).success
          )
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: 'Invalid laboratory document context.',
            });
          if (
            !known.includes(key) &&
            !/^(?:certification|certificationDocuments|qualityTest|qualityDocuments)_[a-f0-9]{32}$/.test(
              key,
            )
          )
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: 'Unsupported or reserved claim.',
            });
          if (
            /^certification_[a-f0-9]{32}$/.test(key) &&
            (typeof value !== 'object' ||
              !value ||
              'documents' in value ||
              (value as { id?: string }).id?.replaceAll('-', '') !==
                key.slice('certification_'.length))
          )
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message:
                'Certification scope must match its stable entry ID; documents need a separate disclosure.',
            });
          if (
            /^certification_[a-f0-9]{32}$/.test(key) &&
            !ingredientCertificationSchema.safeParse({ ...(value as object), documents: [] })
              .success
          )
            ctx.addIssue({ code: 'custom', path: [key], message: 'Invalid certification entry.' });
          if (
            /^certificationDocuments_[a-f0-9]{32}$/.test(key) &&
            !z
              .object({
                certificationId: z.uuid(),
                documents: z.array(certificationDocumentSchema).min(1).max(3),
              })
              .strict()
              .safeParse(value).success
          )
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: 'Invalid certification documents.',
            });
        }
      }),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    issuedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    holderDid: z.string().startsWith('did:key:').optional(),
    holderWallet: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    issuerDid: z.string().startsWith('did:'),
  })
  .strict()
  .refine((value) => value.expiresAt > value.issuedAt, 'Credential expiry must follow issuance.');

export interface IngredientSdJwtClaims {
  [key: string]: unknown;
  allergenDeclaration?: string | z.infer<typeof ingredientAllergenSchema>;
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
  holderDid?: string;
  holderWallet?: string;
  issuerDid: string;
  issuedAt: number;
}

const selectiveClaims = [
  'originCountryCode',
  'originRegion',
  'originCity',
  'privateOriginAddress',
  'processingLocation',
  'allergenDeclaration',
  'certificationDetails',
  'countryOfOrigin',
  'exactSourceFacility',
  'expiryDate',
  'internalQualityRemarks',
  'productionDate',
  'productionDateMeaning',
  'qualityTestSummary',
] as const;

export async function issueIngredientSdJwt(
  agent: TraceChainAgent,
  input: IssueIngredientSdJwtInput,
) {
  issuanceInputSchema.parse(input);
  const binding = input.holderWallet
    ? { wallet: getAddress(input.holderWallet), proof: WALLET_HOLDER_BINDING }
    : { jwk: await holderPublicJwk(input.holderDid!) };
  if (
    input.holderWallet &&
    getAddress(input.holderWallet) !== getAddress(input.claims.supplierWallet)
  )
    throw new Error('Issuer holder wallet must match the Supplier.');
  const issuer = await agent.didManagerGet({ did: input.issuerDid });
  const issuerKey = issuer.keys[0];
  if (!issuerKey) throw new Error('The Supplier issuer DID has no managed signing key.');
  const instance = issuerInstance(agent, issuerKey.kid);
  validateCertificationDisclosure(input.claims, []);
  const payload = {
    cnf: binding,
    exp: input.expiresAt,
    iat: input.issuedAt,
    iss: input.issuerDid,
    sub: input.claims.supplierWallet.toLowerCase(),
    vct: input.holderWallet
      ? INGREDIENT_SD_JWT_VCT_V3
      : input.claims.policyVersion === 2
        ? INGREDIENT_SD_JWT_VCT_V2
        : INGREDIENT_SD_JWT_VCT,
    ...input.claims,
  };
  const disclosed = Object.keys(payload).filter(
    (claim) =>
      selectiveClaims.includes(claim as (typeof selectiveClaims)[number]) ||
      /^(?:certification|certificationDocuments|qualityTest|qualityDocuments)_[a-f0-9]{32}$/.test(
        claim,
      ),
  );
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
    context?: { requestId: string; purpose: string; expiresAt: number };
    walletDomain?: { chainId: number; verifyingContract: string };
  },
) {
  const instance = verifierInstance(agent);
  const wallet = parseWalletPresentation(presentation);
  const result = await instance.verify(presentationSdJwt(presentation), {
    allowedIssuerAlgorithms: ['ES256K', 'ES256K-R'],
    ...(!wallet
      ? {
          allowedKeyBindingAlgorithms: ['EdDSA'],
          expectedKeyBindingAudience: input.audience,
          // Bound by the request deadline (and its single-use nonce), not a fixed 5 minutes.
          ...(input.context ? {} : { keyBindingMaxAgeSeconds: 300 }),
          keyBindingNonce: input.nonce,
        }
      : {}),
    currentDate: input.now,
    expectedVct: [INGREDIENT_SD_JWT_VCT, INGREDIENT_SD_JWT_VCT_V2, INGREDIENT_SD_JWT_VCT_V3],
    requiredClaimKeys: [
      'iss',
      'vct',
      'cnf',
      'credentialId',
      'ingredientName',
      'batchId',
      'supplierWallet',
      ...input.requiredClaims.filter(
        (claim) =>
          ![
            'certifications',
            'certificationDocuments',
            'qualityTests',
            'qualityDocuments',
          ].includes(claim),
      ),
    ],
  });
  const binding = result.payload.cnf as { wallet?: string; proof?: string };
  if (wallet) {
    if (
      result.payload.vct !== INGREDIENT_SD_JWT_VCT_V3 ||
      binding.proof !== WALLET_HOLDER_BINDING ||
      !binding.wallet ||
      !input.walletDomain ||
      !input.context
    )
      throw new Error(
        'This credential does not authorize a wallet holder proof. Reissuance is required for legacy keys.',
      );
    if (getAddress(binding.wallet) !== getAddress(input.supplierWallet))
      throw new Error('Issuer-signed holder wallet mismatch.');
    verifyWalletPresentation(wallet, {
      ...input.walletDomain,
      requestId: input.context.requestId,
      purpose: input.context.purpose,
      challenge: input.nonce,
      batchId: input.batchId,
      holder: binding.wallet,
      verifier: input.audience,
      now: input.now,
      expiresAt: Math.min(input.context.expiresAt, Number(result.payload.exp)),
    });
  } else if (result.payload.vct === INGREDIENT_SD_JWT_VCT_V3)
    throw new Error('A wallet-bound credential requires the TraceChain EIP-712 holder proof.');
  validateCertificationDisclosure(result.payload, input.requiredClaims);
  if (input.context && !wallet) {
    const keyBinding = JSON.parse(
      Buffer.from(presentation.split('~').at(-1)!.split('.')[1]!, 'base64url').toString(),
    ) as Record<string, unknown>;
    if (
      keyBinding.requestId !== input.context.requestId ||
      keyBinding.purpose !== input.context.purpose ||
      keyBinding.batchId !== input.batchId ||
      typeof keyBinding.exp !== 'number' ||
      keyBinding.exp <= input.now ||
      keyBinding.exp > input.context.expiresAt
    )
      throw new Error('The presentation request, purpose, batch or expiry binding did not match.');
  }
  const presentedBatch = String(result.payload.batchId ?? '');
  const batchMatches =
    presentedBatch.toLowerCase() === input.batchId.toLowerCase() ||
    id(presentedBatch).toLowerCase() === input.batchId.toLowerCase();
  if (!batchMatches) throw new Error('The selective presentation is bound to a different batch.');
  if (String(result.payload.supplierWallet).toLowerCase() !== input.supplierWallet.toLowerCase())
    throw new Error('The selective presentation is bound to a different Supplier.');
  if (
    result.payload.policyVersion === 2 &&
    String(result.payload.supplierDid).toLowerCase() !==
      `did:ethr:sepolia:${input.supplierWallet}`.toLowerCase()
  )
    throw new Error('The Supplier subject DID does not match its wallet binding.');
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
    expectedVct: [INGREDIENT_SD_JWT_VCT, INGREDIENT_SD_JWT_VCT_V2, INGREDIENT_SD_JWT_VCT_V3],
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
    presentationSdJwt(presentation),
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

function validateCertificationDisclosure(payload: Record<string, unknown>, required: string[]) {
  const keys = Object.keys(payload);
  if (payload.policyVersion === 2)
    for (const key of [
      'ingredientName',
      'batchId',
      'supplierWallet',
      'supplierDid',
      'batchReference',
    ])
      if (!payload[key]) throw new Error(`Missing ingredient binding claim: ${key}.`);
  for (const key of keys.filter((key) => key.startsWith('qualityDocuments_'))) {
    const files = payload[key] as { qualityTestId?: string };
    const test = payload['qualityTest_' + String(files.qualityTestId ?? '').replaceAll('-', '')] as
      { id?: string } | undefined;
    if (!test || test.id !== files.qualityTestId)
      throw new Error('Laboratory documents require their complete test context.');
  }
  if (required.includes('qualityTests') && !keys.some((key) => key.startsWith('qualityTest_')))
    throw new Error('Required laboratory results were not disclosed.');
  if (
    required.includes('qualityDocuments') &&
    !keys.some((key) => key.startsWith('qualityDocuments_'))
  )
    throw new Error('Required laboratory documents were not disclosed.');
  if (
    required.includes('certifications') &&
    !keys.some((key) => /^certification_[a-f0-9]{32}$/.test(key))
  )
    throw new Error('A required certification entry was not disclosed.');
  if (
    required.includes('certificationDocuments') &&
    !keys.some((key) => /^certificationDocuments_[a-f0-9]{32}$/.test(key))
  )
    throw new Error('Required certification documents were not disclosed.');
  for (const key of keys.filter((key) => /^certificationDocuments_[a-f0-9]{32}$/.test(key))) {
    const files = payload[key] as { certificationId?: string };
    const entry = payload[
      'certification_' + String(files.certificationId ?? '').replaceAll('-', '')
    ] as { id?: string } | undefined;
    if (!entry || entry.id !== files.certificationId)
      throw new Error(
        'Disclosed documents require their complete certification scope and provenance.',
      );
  }
}
