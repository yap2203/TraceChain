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
  input: { audience: string; claims: string[]; nonce: string },
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
  if (password.length < 10) throw new Error('Use a recovery password of at least 10 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await recoveryKey(password, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: owned(iv) },
    key,
    owned(holder.privateKey),
  );
  return JSON.stringify(
    {
      version: 1,
      did: holder.did,
      salt: base64(salt),
      iv: base64(iv),
      ciphertext: base64(new Uint8Array(ciphertext)),
      warning:
        'TraceChain holder presentation signing-key backup. Keep private and separate from the password.',
    },
    null,
    2,
  );
}
export async function importRecoveryKit(serialized: string, password: string) {
  let kit: {
    version: number;
    did: string;
    salt: string;
    iv: string;
    ciphertext: string;
  };
  try {
    kit = JSON.parse(serialized) as typeof kit;
  } catch {
    throw new Error('The selected file is not a valid TraceChain recovery-kit JSON file.');
  }
  if (
    kit.version !== 1 ||
    !kit.did?.startsWith('did:key:') ||
    typeof kit.salt !== 'string' ||
    typeof kit.iv !== 'string' ||
    typeof kit.ciphertext !== 'string'
  )
    throw new Error('Unsupported presentation signing-key backup.');
  let privateKey: Uint8Array;
  try {
    const key = await recoveryKey(password, unbase64(kit.salt), ['decrypt']);
    privateKey = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: owned(unbase64(kit.iv)) },
        key,
        owned(unbase64(kit.ciphertext)),
      ),
    );
  } catch {
    throw new Error(
      'The backup password is incorrect or the encrypted signing-key backup is damaged. Use the exact password entered when it was downloaded.',
    );
  }
  if (privateKey.length !== 32)
    throw new Error('The backup contains an invalid presentation private key.');
  const holder = await createMessagingAgent(Uint8Array.from(privateKey));
  if (holder.did !== kit.did)
    throw new Error('Presentation-key backup DID does not match its key.');
  return holder;
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
