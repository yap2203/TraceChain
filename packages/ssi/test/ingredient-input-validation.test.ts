import { describe, expect, it } from 'vitest';
import { issueIngredientSdJwt } from '../src/credentials/ingredient-sd-jwt.js';
import type { TraceChainAgent } from '../src/agent/tracechain-agent.js';

describe('Ingredient SD-JWT issuance input validation', () => {
  it('rejects malformed claims and reserved-field injection before accessing signing keys', async () => {
    const input = {
      claims: {
        batchId: 'BATCH-1',
        credentialId: 'urn:ingredient:1',
        ingredientName: 'Ingredient',
        supplierWallet: '0x2000000000000000000000000000000000000002',
      },
      expiresAt: 2000,
      issuedAt: 1000,
      holderDid: 'did:key:test',
      issuerDid: 'did:example:test',
    };
    for (const claims of [
      { ingredientName: ' ' },
      { supplierWallet: 'invalid' },
      { countryOfOrigin: 'x'.repeat(161) },
      { expiryDate: '2026-02-30' },
      { certifications: ['unexpected field'] },
      { iss: 'did:attacker' },
      { cnf: {} },
      { exp: 99999999 },
    ]) {
      await expect(
        issueIngredientSdJwt({} as TraceChainAgent, {
          ...input,
          claims: { ...input.claims, ...claims },
        }),
      ).rejects.toMatchObject({ name: 'ZodError' });
    }
    for (const times of [
      { expiresAt: 0 },
      { expiresAt: 999 },
      { issuedAt: NaN },
      { issuedAt: 1.5 },
    ])
      await expect(
        issueIngredientSdJwt({} as TraceChainAgent, { ...input, ...times }),
      ).rejects.toMatchObject({ name: 'ZodError' });
  });
});
