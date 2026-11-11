import { createHash, randomUUID } from 'node:crypto';

import type { VerifiableCredential } from '@veramo/core';
import { getAddress } from 'ethers';

import type { TraceChainAgent } from '../agent/tracechain-agent.js';
import { COMPANY_ROLE_CREDENTIAL_CONTEXT } from './company-role-credential.js';
import { walletAddressToDid } from './company-role-credential.service.js';
import {
  INGREDIENT_CREDENTIAL_SCHEMA_ID,
  INGREDIENT_CREDENTIAL_TYPE,
  SUPPLIER_INGREDIENT_ISSUER_NAME,
  ingredientCredentialSchema,
  type IngredientCredential,
} from './ingredient-credential.js';

export interface IssueIngredientCredentialInput {
  price?: string;
  currency?: string;
  allergenInformation: string;
  batchId: string;
  category: string;
  certifications: string[];
  expiryDate: Date;
  ingredientName: string;
  issuanceDate?: Date;
  issuerDid: string;
  issuerOperatorChainId: number;
  origin: string;
  productionDate: Date;
  quantity: string;
  supplierWallet: string;
  unit: string;
}

export async function issueIngredientCredential(
  agent: TraceChainAgent,
  input: IssueIngredientCredentialInput,
) {
  const supplierWallet = getAddress(input.supplierWallet);
  const subjectDid = walletAddressToDid(supplierWallet);
  const credential = await agent.createVerifiableCredential({
    credential: {
      '@context': [COMPANY_ROLE_CREDENTIAL_CONTEXT],
      credentialSchema: { id: INGREDIENT_CREDENTIAL_SCHEMA_ID, type: 'JsonSchema' },
      credentialSubject: {
        allergenInformation: input.allergenInformation,
        batchId: input.batchId,
        category: input.category,
        certifications: input.certifications,
        expiryDate: input.expiryDate.toISOString(),
        id: subjectDid,
        ingredientName: input.ingredientName,
        origin: input.origin,
        productionDate: input.productionDate.toISOString(),
        quantity: input.quantity,
        supplierWallet,
        unit: input.unit,
      },
      expirationDate: input.expiryDate.toISOString(),
      id: `urn:uuid:${randomUUID()}`,
      issuanceDate: (input.issuanceDate ?? new Date()).toISOString(),
      issuer: {
        blockchainAccountId: `eip155:${input.issuerOperatorChainId}:${supplierWallet}`,
        id: input.issuerDid,
        name: SUPPLIER_INGREDIENT_ISSUER_NAME,
      },
      type: ['VerifiableCredential', INGREDIENT_CREDENTIAL_TYPE],
    },
    proofFormat: 'jwt',
    save: false,
  });
  const validated = ingredientCredentialSchema.parse(credential) as IngredientCredential;
  await agent.dataStoreSaveVerifiableCredential({
    verifiableCredential: validated as VerifiableCredential,
  });
  return { credential: validated, credentialHash: hashIngredientCredential(validated) };
}

export async function verifyIngredientCredential(
  agent: TraceChainAgent,
  credentialInput: unknown,
  supplierWalletInput: string,
  expectedIssuerDid: string,
  now = new Date(),
) {
  const parsed = ingredientCredentialSchema.safeParse(credentialInput);
  if (!parsed.success) return { reasons: ['MALFORMED_CREDENTIAL'] as const, verified: false };
  const credential = parsed.data as IngredientCredential;
  const reasons: string[] = [];
  const supplierWallet = getAddress(supplierWalletInput);
  const claimedWallet = getAddress(credential.credentialSubject.supplierWallet);
  if (
    claimedWallet !== supplierWallet ||
    credential.credentialSubject.id.toLowerCase() !==
      walletAddressToDid(supplierWallet).toLowerCase()
  ) {
    reasons.push('WRONG_WALLET');
  }
  if (
    credential.issuer.id !== expectedIssuerDid ||
    credential.issuer.blockchainAccountId !== `eip155:11155111:${supplierWallet}`
  ) {
    reasons.push('WRONG_ISSUER');
  }
  if (new Date(credential.issuanceDate).getTime() > now.getTime()) reasons.push('NOT_YET_VALID');
  if (new Date(credential.expirationDate).getTime() <= now.getTime()) reasons.push('EXPIRED');
  try {
    const verification = await agent.verifyCredential({
      credential,
      policies: {
        credentialStatus: false,
        expirationDate: false,
        issuanceDate: false,
        now: now.getTime() / 1_000,
      },
    });
    if (!verification.verified) reasons.push('INVALID_SIGNATURE');
  } catch {
    reasons.push('INVALID_SIGNATURE');
  }
  return {
    credentialHash: hashIngredientCredential(credential),
    reasons: [...new Set(reasons)],
    verified: reasons.length === 0,
  };
}

export function serializeIngredientCredential(credential: IngredientCredential) {
  return JSON.stringify(sortJson(credential));
}

export function hashIngredientCredential(credential: IngredientCredential) {
  return createHash('sha256')
    .update(serializeIngredientCredential(credential), 'utf8')
    .digest('hex');
}

export function canonicalIngredientMetadata(
  input: Omit<
    IssueIngredientCredentialInput,
    'issuanceDate' | 'issuerDid' | 'issuerOperatorChainId'
  >,
) {
  return JSON.stringify(
    sortJson({
      allergenInformation: input.allergenInformation,
      batchId: input.batchId,
      category: input.category,
      certifications: input.certifications,
      expiryDate: input.expiryDate.toISOString(),
      ingredientName: input.ingredientName,
      origin: input.origin,
      productionDate: input.productionDate.toISOString(),
      quantity: input.quantity,
      supplierWallet: getAddress(input.supplierWallet),
      unit: input.unit,
      ...(input.price !== undefined ? { price: input.price, currency: input.currency } : {}),
    }),
  );
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}
