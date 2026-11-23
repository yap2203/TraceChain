import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SecretBox } from '@veramo/kms-local';
import { SigningKey, computeAddress } from 'ethers';
import { createTraceChainAgent, type TraceChainSsiConfig } from '@tracechain/ssi';
import { loadTraceChainSsiEnvironment } from './ssi-env.js';

export class BackendStartupError extends Error {
  constructor(
    readonly code: 'BACKEND_CONFIGURATION_INVALID' | 'ISSUER_RECOVERY_REQUIRED',
    message: string,
  ) {
    super(message);
  }
}
export function loadBackendSecrets(environment: NodeJS.ProcessEnv = process.env) {
  for (const name of ['IPFS_ENCRYPTION_KEY', 'VERAMO_KMS_SECRET_KEY']) {
    if (!/^[a-f0-9]{64}$/i.test(environment[name] ?? ''))
      throw new BackendStartupError(
        'BACKEND_CONFIGURATION_INVALID',
        `${name} must be configured as exactly 64 hexadecimal characters (32 bytes). Restore the original secret; do not generate a replacement for existing records.`,
      );
  }
  return {
    ipfsEncryptionKey: Buffer.from(environment.IPFS_ENCRYPTION_KEY!, 'hex'),
    kmsSecretKey: environment.VERAMO_KMS_SECRET_KEY!,
  };
}
const recovery = () =>
  new BackendStartupError(
    'ISSUER_RECOVERY_REQUIRED',
    'Existing issuer material is missing, inconsistent or cannot be decrypted. Restore the original Veramo private-keys.json, matching public-data.json and KMS secret from a trusted backup. Run the offline keys:restore check; no replacement issuer was created.',
  );
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate every saved key without logging or exporting plaintext key material. */
export async function validateIssuerMaterial(
  metadata: unknown,
  privateStore: unknown,
  kmsSecret: string,
  authorityAlias: string,
) {
  try {
    if (
      !record(metadata) ||
      !record(metadata.dids) ||
      !record(metadata.keys) ||
      !record(privateStore) ||
      !record(privateStore.privateKeys)
    )
      throw recovery();
    const identities = Object.values(metadata.dids);
    const authorities = identities.filter(
      (did) => did.alias === authorityAlias && did.provider === 'did:ethr:sepolia',
    );
    if (authorities.length !== 1 || !Object.keys(metadata.keys).length) throw recovery();
    const box = new SecretBox(kmsSecret);
    const derived = new Map<string, string>();
    for (const [kid, saved] of Object.entries(privateStore.privateKeys)) {
      if (!record(saved) || typeof saved.privateKeyHex !== 'string' || !metadata.keys[kid])
        throw recovery();
      const raw = (await box.decrypt(saved.privateKeyHex)).replace(/^0x/, '');
      if (!/^[a-f0-9]{64,128}$/i.test(raw)) throw recovery();
      let publicHex: string;
      if (saved.type === 'Secp256k1')
        publicHex = SigningKey.computePublicKey('0x' + raw, true).slice(2);
      else if (saved.type === 'Ed25519') {
        const key = createPrivateKey({
          key: Buffer.concat([
            Buffer.from('302e020100300506032b657004220420', 'hex'),
            Buffer.from(raw.slice(0, 64), 'hex'),
          ]),
          format: 'der',
          type: 'pkcs8',
        });
        publicHex = createPublicKey(key)
          .export({ format: 'der', type: 'spki' })
          .subarray(-32)
          .toString('hex');
      } else throw recovery();
      derived.set(kid, publicHex);
    }
    for (const [kid, key] of Object.entries(metadata.keys)) {
      if (!record(key) || key.kid !== kid || !derived.has(kid)) throw recovery();
      const expected =
        key.type === 'Secp256k1'
          ? SigningKey.computePublicKey('0x' + key.publicKeyHex.replace(/^0x/, ''), true).slice(2)
          : key.publicKeyHex;
      if (expected.toLowerCase() !== derived.get(kid)!.toLowerCase()) throw recovery();
    }
    for (const did of identities) {
      if (!Array.isArray(did.keys)) throw recovery();
      for (const key of did.keys)
        if (
          !metadata.keys[key.kid] ||
          key.publicKeyHex !== metadata.keys[key.kid].publicKeyHex ||
          key.type !== metadata.keys[key.kid].type
        )
          throw recovery();
    }
    const authority = authorities[0];
    const authorityKey = authority.keys.find((key: any) => key.type === 'Secp256k1');
    if (!authorityKey) throw recovery();
    const suffix = authority.did.split(':').at(-1).toLowerCase();
    const hex = derived.get(authorityKey.kid)!;
    if (suffix !== '0x' + hex.toLowerCase() && suffix !== computeAddress('0x' + hex).toLowerCase())
      throw recovery();
    return {
      authorityDid: String(authority.did),
      publicKeyCount: Object.keys(metadata.keys).length,
      privateKeyCount: derived.size,
    };
  } catch {
    throw recovery();
  }
}

export async function openExistingIssuer(
  environment: NodeJS.ProcessEnv = process.env,
  resolverOverrides?: TraceChainSsiConfig['resolverOverrides'],
) {
  const secrets = loadBackendSecrets(environment);
  secrets.ipfsEncryptionKey.fill(0);
  let settings;
  try {
    settings = loadTraceChainSsiEnvironment(environment);
  } catch {
    throw new BackendStartupError(
      'BACKEND_CONFIGURATION_INVALID',
      'Check TRACECHAIN_AUTHORITY_DID_ALIAS and the SSI RPC configuration. No issuer was created.',
    );
  }
  try {
    const metadata = JSON.parse(await readFile(settings.config.publicStorePath, 'utf8'));
    const privateStore = JSON.parse(await readFile(settings.config.privateKeyStorePath!, 'utf8'));
    const identity = await validateIssuerMaterial(
      metadata,
      privateStore,
      secrets.kmsSecretKey,
      settings.authorityDidAlias,
    );
    const agent = await createTraceChainAgent({
      ...settings.config,
      ...(resolverOverrides ? { resolverOverrides } : {}),
    });
    return { agent, ...identity };
  } catch {
    throw recovery();
  }
}
