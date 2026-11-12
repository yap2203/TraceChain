import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createAgent, type IDIDManager, type IKeyManager, type IResolver } from '@veramo/core';
import { DIDComm, type IDIDComm, type IDIDCommMessage } from '@veramo/did-comm';
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager';
import { KeyDIDProvider } from '@veramo/did-provider-key';
import { DIDResolverPlugin } from '@veramo/did-resolver';
import { KeyManager, MemoryKeyStore, MemoryPrivateKeyStore } from '@veramo/key-manager';
import { KeyManagementSystem } from '@veramo/kms-local';
import { Resolver } from 'did-resolver';
import { getResolver } from 'key-did-resolver';

export interface BackendMessagingIdentity {
  companyName: string;
  did: string;
  registeredAt: string;
  role: string;
  wallet: string;
}

interface StoredIdentity extends BackendMessagingIdentity {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
}

interface AgentState {
  identities: StoredIdentity[];
  version: 1;
}

type Agent = ReturnType<typeof createAgent<IResolver & IKeyManager & IDIDManager & IDIDComm>>;

/**
 * Company messaging agents hosted by the TraceChain API. The encryption secret is supplied by
 * configuration and is never stored beside this file. This protects keys at rest, but the
 * TraceChain operator can decrypt messages and is therefore inside the trust boundary.
 */
export class BackendDidCommAgentService {
  private queue = Promise.resolve();
  private readonly agents = new Map<string, Agent>();

  constructor(
    private readonly path: string,
    private readonly encryptionKey: Buffer,
    private readonly clock = () => new Date(),
  ) {
    if (encryptionKey.length !== 32)
      throw new Error('The DIDComm key-encryption key must contain exactly 32 bytes.');
  }

  async ensureIdentity(input: { companyName: string; role: string; wallet: string }) {
    const existing = await this.findByWallet(input.wallet);
    if (existing) {
      await this.agentFor(existing.did);
      if (existing.role !== input.role || existing.companyName !== input.companyName) {
        await this.update((state) => {
          const record = state.identities.find((item) => item.did === existing.did);
          if (!record) throw new Error('The existing company messaging identity is unavailable.');
          record.role = input.role;
          record.companyName = input.companyName;
        });
      }
      return { ...existing, role: input.role, companyName: input.companyName };
    }

    const privateKey = randomBytes(32);
    const agent = this.createAgent();
    const identifier = await agent.didManagerCreate({
      provider: 'did:key',
      options: { key: { privateKeyHex: privateKey.toString('hex'), type: 'Ed25519' } },
    });
    const encrypted = this.encrypt(privateKey);
    const record: StoredIdentity = {
      ...input,
      did: identifier.did,
      registeredAt: this.clock().toISOString(),
      ...encrypted,
      version: 1,
    };
    await this.update((state) => state.identities.push(record));
    this.agents.set(record.did, agent);
    return this.publicIdentity(record);
  }

  async findByWallet(wallet: string) {
    const record = (await this.read()).identities.find(
      (item) => item.wallet.toLowerCase() === wallet.toLowerCase(),
    );
    return record ? this.publicIdentity(record) : undefined;
  }

  async findByDid(did: string) {
    const record = (await this.read()).identities.find((item) => item.did === did);
    return record ? this.publicIdentity(record) : undefined;
  }

  async list() {
    return (await this.read()).identities.map((item) => this.publicIdentity(item));
  }

  async pack(senderDid: string, message: IDIDCommMessage) {
    const agent = await this.agentFor(senderDid);
    const packed = await agent.packDIDCommMessage({
      message,
      packing: 'authcrypt',
      options: { alg: 'ECDH-1PU+A256KW', enc: 'A256GCM' },
    });
    return packed.message;
  }

  async unpack(recipientDid: string, envelope: string) {
    const unpacked = await (
      await this.agentFor(recipientDid)
    ).unpackDIDCommMessage({
      message: envelope,
    });
    if (unpacked.metaData.packing !== 'authcrypt')
      throw new Error('Only DIDComm authenticated-encryption envelopes are accepted.');
    return unpacked.message;
  }

  private async agentFor(did: string) {
    const cached = this.agents.get(did);
    if (cached) return cached;
    const record = (await this.read()).identities.find((item) => item.did === did);
    if (!record)
      throw new Error(
        'The backend messaging identity exists in routing data but its key is missing.',
      );
    const privateKey = this.decrypt(record);
    const agent = this.createAgent();
    const identifier = await agent.didManagerCreate({
      provider: 'did:key',
      options: { key: { privateKeyHex: privateKey.toString('hex'), type: 'Ed25519' } },
    });
    if (identifier.did !== did)
      throw new Error('The protected messaging key does not match its recorded DID.');
    this.agents.set(did, agent);
    return agent;
  }

  private createAgent() {
    return createAgent<IResolver & IKeyManager & IDIDManager & IDIDComm>({
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
        new DIDComm(),
      ],
    });
  }

  private encrypt(privateKey: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(privateKey), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  private decrypt(record: StoredIdentity) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey,
        Buffer.from(record.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      const key = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, 'base64')),
        decipher.final(),
      ]);
      if (key.length !== 32) throw new Error('invalid length');
      return key;
    } catch {
      throw new Error('The protected backend messaging key cannot be decrypted.');
    }
  }

  private publicIdentity(record: StoredIdentity): BackendMessagingIdentity {
    const { companyName, did, registeredAt, role, wallet } = record;
    return { companyName, did, registeredAt, role, wallet };
  }

  private async read(): Promise<AgentState> {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8')) as AgentState;
      if (state.version !== 1 || !Array.isArray(state.identities))
        throw new Error('Unsupported backend DIDComm key-store format.');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { identities: [], version: 1 };
      throw error;
    }
  }

  private async update(change: (state: AgentState) => void) {
    const work = this.queue.then(async () => {
      const state = await this.read();
      change(state);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    });
    this.queue = work.catch(() => undefined);
    await work;
  }
}
