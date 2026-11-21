import { createAgent, type IDIDManager, type IKeyManager, type IResolver } from '@veramo/core';
import { SDJwtInstance } from '@sd-jwt/core';
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager';
import { KeyDIDProvider } from '@veramo/did-provider-key';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { KeyManager, MemoryKeyStore, MemoryPrivateKeyStore } from '@veramo/key-manager';
import { KeyManagementSystem } from '@veramo/kms-local';
import { Resolver } from 'did-resolver';
import { createJWT, EdDSASigner } from 'did-jwt';
import { getResolver } from 'key-did-resolver';
import { scryptAsync } from '@noble/hashes/scrypt';

type MessagingAgent = ReturnType<typeof createAgent<IResolver & IKeyManager & IDIDManager>>;
export interface HolderMessagingAgent {
  agent: MessagingAgent;
  did: string;
  privateKey: Uint8Array;
}
let activeHolder: HolderMessagingAgent | undefined;
export function getActiveMessagingAgent() {
  return activeHolder;
}
export function setActiveMessagingAgent(holder: HolderMessagingAgent) {
  activeHolder = holder;
  return holder;
}
export function clearActiveMessagingAgent() {
  if (activeHolder) activeHolder.privateKey.fill(0);
  activeHolder = undefined;
}

export async function createMessagingAgent(
  privateKey = crypto.getRandomValues(new Uint8Array(32)),
): Promise<HolderMessagingAgent> {
  const agent = createAgent<IResolver & IKeyManager & IDIDManager>({
    plugins: [
      new KeyManager({
        store: new MemoryKeyStore(),
        kms: { local: new KeyManagementSystem(new MemoryPrivateKeyStore()) },
      }),
      new DIDManager({
        defaultProvider: 'did:key',
        providers: { 'did:key': new KeyDIDProvider({ defaultKms: 'local' }) },
        store: new MemoryDIDStore(),
      }),
      new DIDResolverPlugin({ resolver: new Resolver(getResolver()) }),
    ],
  });
  const identifier = await agent.didManagerCreate({
    provider: 'did:key',
    options: { key: { privateKeyHex: toHex(privateKey), type: 'Ed25519' } },
  });
  return { agent, did: identifier.did, privateKey };
}

export async function createBindingProof(
  holder: HolderMessagingAgent,
  challenge: {
    chainId: number;
    domain: string;
    expiresAt: string;
    nonce: string;
    purpose: string;
    wallet: string;
  },
) {
  return createJWT(
    {
      aud: challenge.domain,
      chainId: challenge.chainId,
      exp: Math.floor(Date.parse(challenge.expiresAt) / 1000),
      nonce: challenge.nonce,
      purpose: challenge.purpose,
      sub: challenge.wallet.toLowerCase(),
    },
    { issuer: holder.did, signer: EdDSASigner(holder.privateKey), alg: 'EdDSA' },
  );
}
export async function createCompanyIdentityPresentation(
  holder: HolderMessagingAgent,
  input: {
    audience: string;
    challenge: string;
    credential: Record<string, unknown>;
    credentialHash: string;
    expiresAt: number;
    presenterRole: string;
    presenterWallet: string;
    purpose: string;
    requestId: string;
  },
) {
  return createJWT(
    {
      aud: input.audience,
      credential: input.credential,
      credentialHash: input.credentialHash,
      exp: input.expiresAt,
      nonce: input.challenge,
      purpose: input.purpose,
      requestId: input.requestId,
      role: input.presenterRole,
      wallet: input.presenterWallet.toLowerCase(),
    },
    { alg: 'EdDSA', issuer: holder.did, signer: EdDSASigner(holder.privateKey) },
  );
}
export async function createSelectiveIngredientPresentation(
  holder: HolderMessagingAgent,
  credential: string,
  input: {
    audience: string;
    claims: string[];
    nonce: string;
    context?: { requestId: string; purpose: string; batchId: string; expiresAt: number };
  },
) {
  const signer = EdDSASigner(holder.privateKey);
  const instance = new SDJwtInstance<Record<string, unknown>>({
    hashAlg: 'sha-256',
    hasher: async (data, algorithm) => {
      if (algorithm !== 'sha-256') throw new Error(`Unsupported disclosure hash: ${algorithm}`);
      const bytes =
        typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      return new Uint8Array(await crypto.subtle.digest('SHA-256', owned(bytes)));
    },
    kbSignAlg: 'EdDSA',
    kbSigner: async (data) => {
      const signature = await signer(data);
      if (typeof signature !== 'string') throw new Error('Unexpected holder signature format.');
      return signature;
    },
  });
  return instance.present(
    credential,
    Object.fromEntries(input.claims.map((claim) => [claim, true])),
    {
      kb: {
        payload: {
          aud: input.audience,
          iat: Math.floor(Date.now() / 1_000),
          nonce: input.nonce,
          ...(input.context
            ? {
                requestId: input.context.requestId,
                purpose: input.context.purpose,
                batchId: input.context.batchId,
                exp: input.context.expiresAt,
              }
            : {}),
        },
      },
    },
  );
}
export async function readSelectiveIngredientClaims(credential: string) {
  const instance = new SDJwtInstance<Record<string, unknown>>({
    hashAlg: 'sha-256',
    hasher: async (data, algorithm) => {
      if (algorithm !== 'sha-256') throw new Error(`Unsupported disclosure hash: ${algorithm}`);
      const bytes =
        typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      return new Uint8Array(await crypto.subtle.digest('SHA-256', owned(bytes)));
    },
  });
  return instance.getClaims(credential);
}
export const createSelectiveCompanyIdentityPresentation = createSelectiveIngredientPresentation;
export async function exportRecoveryKit(holder: HolderMessagingAgent, password: string) {
  if (password.length < 12) throw new Error('Use a recovery password of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = await portableRecoveryKey(password, salt);
  let encrypted: Uint8Array;
  try {
    const key = await crypto.subtle.importKey('raw', owned(keyBytes), 'AES-GCM', false, [
      'encrypt',
    ]);
    encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: owned(iv), additionalData: owned(presentationAad()) },
        key,
        new TextEncoder().encode(
          JSON.stringify({
            createdAt: new Date().toISOString(),
            did: holder.did,
            keyBundleVersion: 1,
            privateKey: base64(holder.privateKey),
          }),
        ),
      ),
    );
  } finally {
    keyBytes.fill(0);
  }
  const ciphertext = encrypted.slice(0, -16);
  const authTag = encrypted.slice(-16);
  return JSON.stringify(
    {
      format: 'tracechain-presentation-keystore',
      version: 1,
      kdf: {
        name: 'scrypt',
        salt: base64(salt),
        cost: 16_384,
        blockSize: 8,
        parallelization: 1,
      },
      cipher: {
        name: 'aes-256-gcm',
        iv: base64(iv),
        authTag: base64(authTag),
      },
      ciphertext: base64(ciphertext),
    },
    null,
    2,
  );
}
export async function importRecoveryKit(serialized: string, password: string) {
  let kit: any;
  try {
    if (new TextEncoder().encode(serialized).length > 1024 * 1024) throw new Error('oversized');
    kit = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('The selected file is not a valid TraceChain recovery-kit JSON file.');
  }
  if (kit?.format === 'tracechain-presentation-keystore')
    return importPortablePresentationKeystore(kit, password);
  return importLegacyRecoveryKit(kit, password);
}

async function importPortablePresentationKeystore(kit: any, password: string) {
  if (
    kit.format !== 'tracechain-presentation-keystore' ||
    kit.version !== 1 ||
    kit.kdf?.name !== 'scrypt' ||
    kit.kdf?.cost !== 16_384 ||
    kit.kdf?.blockSize !== 8 ||
    kit.kdf?.parallelization !== 1 ||
    kit.cipher?.name !== 'aes-256-gcm' ||
    typeof kit.kdf?.salt !== 'string' ||
    typeof kit.cipher?.iv !== 'string' ||
    typeof kit.cipher?.authTag !== 'string' ||
    typeof kit.ciphertext !== 'string'
  )
    throw new Error('Unsupported presentation signing-key backup.');
  try {
    const salt = exactBytes(kit.kdf.salt, 16);
    const iv = exactBytes(kit.cipher.iv, 12);
    const authTag = exactBytes(kit.cipher.authTag, 16);
    const ciphertext = exactBytes(kit.ciphertext);
    const keyBytes = await portableRecoveryKey(password, salt);
    let decrypted: Uint8Array;
    try {
      const key = await crypto.subtle.importKey('raw', owned(keyBytes), 'AES-GCM', false, [
        'decrypt',
      ]);
      decrypted = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: owned(iv), additionalData: owned(presentationAad()) },
          key,
          owned(concat(ciphertext, authTag)),
        ),
      );
    } finally {
      keyBytes.fill(0);
    }
    const payload = JSON.parse(new TextDecoder().decode(decrypted)) as {
      createdAt: string;
      did: string;
      keyBundleVersion: number;
      privateKey: string;
    };
    if (
      payload.keyBundleVersion !== 1 ||
      !payload.did?.startsWith('did:key:') ||
      Number.isNaN(Date.parse(payload.createdAt))
    )
      throw new Error('invalid payload');
    return verifyRecoveredHolder(payload.did, exactBytes(payload.privateKey, 32));
  } catch {
    throw new Error('Incorrect password or invalid presentation keystore file.');
  }
}

async function importLegacyRecoveryKit(kit: any, password: string) {
  if (
    kit?.version !== 1 ||
    !kit.did?.startsWith('did:key:') ||
    typeof kit.salt !== 'string' ||
    typeof kit.iv !== 'string' ||
    typeof kit.ciphertext !== 'string'
  )
    throw new Error('Unsupported presentation signing-key backup.');
  try {
    const key = await recoveryKey(password, unbase64(kit.salt), ['decrypt']);
    const privateKey = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: owned(unbase64(kit.iv)) },
        key,
        owned(unbase64(kit.ciphertext)),
      ),
    );
    return verifyRecoveredHolder(kit.did, privateKey);
  } catch {
    throw new Error('Incorrect password or invalid presentation keystore file.');
  }
}

async function verifyRecoveredHolder(did: string, privateKey: Uint8Array) {
  if (privateKey.length !== 32) throw new Error('invalid private key');
  const holder = await createMessagingAgent(Uint8Array.from(privateKey));
  if (holder.did !== did) throw new Error('DID mismatch');
  return holder;
}

async function portableRecoveryKey(password: string, salt: Uint8Array) {
  if (password.length < 12) throw new Error('invalid password');
  return scryptAsync(new TextEncoder().encode(password), salt, {
    N: 16_384,
    r: 8,
    p: 1,
    dkLen: 32,
  });
}

function presentationAad() {
  return new TextEncoder().encode(
    JSON.stringify({
      format: 'tracechain-presentation-keystore',
      version: 1,
      purpose: 'TraceChain company presentation signing key',
    }),
  );
}

function exactBytes(value: string, length?: number) {
  const bytes = unbase64(value);
  if (base64(bytes) !== value || (length !== undefined && bytes.length !== length))
    throw new Error('invalid base64');
  return bytes;
}

function concat(left: Uint8Array, right: Uint8Array) {
  const value = new Uint8Array(left.length + right.length);
  value.set(left);
  value.set(right, left.length);
  return value;
}
async function recoveryKey(password: string, salt: Uint8Array, usages: KeyUsage[]) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: 310_000, salt: owned(salt) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}
function toHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
function unbase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function owned(value: Uint8Array) {
  return Uint8Array.from(value).buffer;
}
