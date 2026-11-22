import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { SDJwtInstance } from '@sd-jwt/core';
import { Wallet, id } from 'ethers';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { WALLET_VP_FORMAT, walletProofData, type WalletProofContext } from '@tracechain/shared';
import {
  createTraceChainAgent,
  createOrGetAuthorityDid,
  type TraceChainAgent,
} from '../src/index.js';
import {
  issueIngredientSdJwt,
  verifyIngredientSdJwtPresentation,
  readIngredientSdJwtClaims,
} from '../src/credentials/ingredient-sd-jwt.js';
import {
  issueCompanyIdentitySdJwt,
  verifyCompanyIdentitySdJwt,
} from '../src/credentials/company-identity-sd-jwt.js';

let directory: string, agent: TraceChainAgent, issuer: string;
const holder = Wallet.createRandom(),
  verifier = Wallet.createRandom();
const now = Math.floor(Date.now() / 1000);
const context: WalletProofContext = {
  chainId: 31337,
  verifyingContract: Wallet.createRandom().address,
  requestId: id('request'),
  batchId: id('batch'),
  verifier: verifier.address,
  holder: holder.address,
  purpose: 'Check origin',
  challenge: id('fresh challenge'),
  issuedAt: now,
  expiresAt: now + 240,
};
const sd = new SDJwtInstance<Record<string, unknown>>({
  hasher: async (v) =>
    Uint8Array.from(
      createHash('sha256')
        .update(typeof v === 'string' ? v : Buffer.from(v))
        .digest(),
    ),
  hashAlg: 'sha-256',
});
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tc-wallet-proof-'));
  agent = await createTraceChainAgent({
    chainId: 11155111,
    networkName: 'sepolia',
    rpcUrl: 'https://example.invalid',
    kmsSecretKey: '3'.repeat(64),
    publicStorePath: join(directory, 'metadata.json'),
    privateKeyStorePath: join(directory, 'keys.json'),
  });
  issuer = (await createOrGetAuthorityDid(agent, 'wallet-test')).identifier.did;
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function present(
  credential: string,
  claims = ['countryOfOrigin'],
  ctx = context,
  signer = holder,
) {
  const selected = await sd.present(
    credential,
    Object.fromEntries(claims.map((c) => [c, true])) as never,
  );
  const data = walletProofData(selected, ctx);
  return JSON.stringify({
    format: WALLET_VP_FORMAT,
    presentation: selected,
    proof: {
      context: ctx,
      signature: await signer.signTypedData(data.domain, data.types, data.value),
    },
  });
}
async function ingredient(holderDid?: string) {
  return issueIngredientSdJwt(agent, {
    issuerDid: issuer,
    ...(holderDid ? { holderDid } : { holderWallet: holder.address }),
    issuedAt: now - 1,
    expiresAt: now + 3600,
    claims: {
      batchId: context.batchId,
      ingredientName: 'Actual signed ingredient',
      credentialId: 'urn:test:ingredient',
      supplierWallet: holder.address,
      countryOfOrigin: 'Ghana',
      exactSourceFacility: 'Private address',
    },
  });
}
const expected = {
  audience: verifier.address,
  batchId: context.batchId,
  nonce: context.challenge,
  now,
  requiredClaims: ['countryOfOrigin'],
  supplierWallet: holder.address,
  context: { requestId: context.requestId, purpose: context.purpose, expiresAt: now + 600 },
  walletDomain: { chainId: context.chainId, verifyingContract: context.verifyingContract },
};
describe('TraceChain EIP-712 holder proofs', () => {
  it('verifies issuer signature/disclosures and MetaMask-compatible wallet signature separately', async () => {
    const credential = await ingredient();
    const presentation = await present(credential);
    const result = await verifyIngredientSdJwtPresentation(agent, presentation, expected);
    expect(result.payload.countryOfOrigin).toBe('Ghana');
    expect(result.payload).not.toHaveProperty('exactSourceFacility');
    expect(await readIngredientSdJwtClaims(presentation)).not.toHaveProperty('exactSourceFacility');
  });
  it('rejects a wrong signer, changed disclosures, request, domain, recipient and expiry', async () => {
    const credential = await ingredient();
    await expect(
      verifyIngredientSdJwtPresentation(
        agent,
        await present(credential, undefined, context, Wallet.createRandom()),
        expected,
      ),
    ).rejects.toThrow();
    const presentation = JSON.parse(await present(credential));
    presentation.presentation = await sd.present(credential, {
      countryOfOrigin: true,
      exactSourceFacility: true,
    });
    await expect(
      verifyIngredientSdJwtPresentation(agent, JSON.stringify(presentation), expected),
    ).rejects.toThrow();
    for (const change of [
      { requestId: id('other') },
      { verifier: holder.address },
      { chainId: 11155111 },
      { purpose: 'different' },
      { challenge: 'different' },
      { expiresAt: now - 1 },
    ])
      await expect(
        verifyIngredientSdJwtPresentation(
          agent,
          await present(credential, undefined, { ...context, ...change }),
          expected,
        ),
      ).rejects.toThrow();
    await expect(
      verifyIngredientSdJwtPresentation(
        agent,
        await sd.present(credential, { countryOfOrigin: true }),
        expected,
      ),
    ).rejects.toThrow();
  });
  it('cannot use wallet signing to bypass an existing Ed25519 binding', async () => {
    const pair = generateKeyPairSync('ed25519');
    const jwk = pair.publicKey.export({ format: 'jwk' });
    const bytes = Buffer.concat([Buffer.from([0xed, 1]), Buffer.from(jwk.x!, 'base64url')]);
    let n = BigInt('0x' + bytes.toString('hex')),
      encoded = '';
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    while (n) {
      encoded = alphabet[Number(n % 58n)] + encoded;
      n /= 58n;
    }
    const legacy = await ingredient(`did:key:z${encoded}`);
    await expect(
      verifyIngredientSdJwtPresentation(agent, await present(legacy), expected),
    ).rejects.toThrow(/does not authorize/);
  });
  it('verifies a source-bound selective company attestation without a separate holder key', async () => {
    const credential = await issueCompanyIdentitySdJwt(agent, {
      issuerDid: issuer,
      holderWallet: holder.address,
      credentialHash: id('source'),
      sourceCredentialId: 'urn:company:1',
      sourceCredentialIssuedAt: new Date((now - 10) * 1000).toISOString(),
      sourceCredentialExpiresAt: new Date((now + 3600) * 1000).toISOString(),
      claims: {
        companyName: 'Verified company',
        walletAddress: holder.address,
        role: 'SUPPLIER',
        id: `did:ethr:sepolia:${holder.address}`,
        companyId: 'private registration',
      },
      requestId: id('binding'),
      purpose: 'Generic binding',
      audience: holder.address,
      challenge: 'binding',
      issuedAt: now - 1,
      expiresAt: now + 3600,
    });
    const presentation = await present(credential, []);
    const companyExpected = {
      audience: verifier.address,
      challenge: context.challenge,
      requestId: context.requestId,
      purpose: context.purpose,
      now,
      requiredClaims: ['companyName'],
      walletDomain: expected.walletDomain,
      wallet: holder.address,
      batchId: context.batchId,
      expiresAt: now + 600,
    };
    const result = await verifyCompanyIdentitySdJwt(agent, presentation, companyExpected);
    for (const change of [
      { verifier: holder.address },
      { requestId: id('other-company-request') },
      { expiresAt: now - 1 },
    ])
      await expect(
        verifyCompanyIdentitySdJwt(
          agent,
          await present(credential, [], { ...context, ...change }),
          companyExpected,
        ),
      ).rejects.toThrow();
    await expect(
      verifyCompanyIdentitySdJwt(
        agent,
        await present(credential, [], context, Wallet.createRandom()),
        companyExpected,
      ),
    ).rejects.toThrow();
    const changed = JSON.parse(presentation);
    changed.presentation = await sd.present(credential, { companyId: true });
    await expect(
      verifyCompanyIdentitySdJwt(agent, JSON.stringify(changed), companyExpected),
    ).rejects.toThrow();
    expect(result.payload.companyName).toBe('Verified company');
    expect(result.payload).not.toHaveProperty('companyId');
  });
});
