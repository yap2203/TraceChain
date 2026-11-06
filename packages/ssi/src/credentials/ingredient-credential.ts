import type { VerifiableCredential } from '@veramo/core';
import { z } from 'zod';

import { COMPANY_ROLE_CREDENTIAL_CONTEXT } from './company-role-credential.js';

export const INGREDIENT_CREDENTIAL_TYPE = 'IngredientCredential';
export const INGREDIENT_CREDENTIAL_SCHEMA_ID = 'urn:tracechain:schema:ingredient:v1';
export const SUPPLIER_INGREDIENT_ISSUER_NAME = 'TraceChain Supplier Ingredient Issuer';

const didSchema = z.string().regex(/^did:ethr:sepolia:0x[0-9a-fA-F]+$/);
const walletSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const ingredientCredentialSchema = z.object({
  '@context': z
    .array(z.string())
    .refine(
      (context) => context.includes(COMPANY_ROLE_CREDENTIAL_CONTEXT),
      'Standard Verifiable Credential context is required',
    ),
  credentialSchema: z.object({
    id: z.literal(INGREDIENT_CREDENTIAL_SCHEMA_ID),
    type: z.literal('JsonSchema'),
  }),
  credentialSubject: z.object({
    allergenInformation: z.string(),
    batchId: z.string().min(1),
    category: z.string().min(1),
    certifications: z.array(z.string()),
    expiryDate: z.string().datetime(),
    id: didSchema,
    ingredientName: z.string().min(1),
    origin: z.string().min(1),
    productionDate: z.string().datetime(),
    quantity: z.string().regex(/^[1-9]\d*$/),
    supplierWallet: walletSchema,
    unit: z.string().min(1),
  }),
  expirationDate: z.string().datetime(),
  id: z.string().min(1),
  issuanceDate: z.string().datetime(),
  issuer: z.object({
    blockchainAccountId: z.string().regex(/^eip155:\d+:0x[0-9a-fA-F]{40}$/),
    id: didSchema,
    name: z.literal(SUPPLIER_INGREDIENT_ISSUER_NAME),
  }),
  proof: z.object({
    jwt: z.string().min(1),
    type: z.literal('JwtProof2020'),
  }),
  type: z
    .array(z.string())
    .refine(
      (types) =>
        types.includes('VerifiableCredential') && types.includes(INGREDIENT_CREDENTIAL_TYPE),
      'IngredientCredential and VerifiableCredential types are required',
    ),
});

export type IngredientCredential = z.infer<typeof ingredientCredentialSchema> &
  VerifiableCredential;
