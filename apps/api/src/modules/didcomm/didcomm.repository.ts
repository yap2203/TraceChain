import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface MessagingIdentity {
  companyName: string;
  did: string;
  registeredAt: string;
  role: string;
  wallet: string;
}
export interface RelayEnvelope {
  businessReference: string;
  createdAt: string;
  envelope: string;
  expiresAt: string;
  fromDid: string;
  id: string;
  ingredientBatchReference?: string;
  messageType: string;
  parentThreadId?: string;
  threadId: string;
  toDid: string;
  deliveryState?: 'SENT' | 'RECEIVED_DECRYPTED';
  receivedAt?: string;
}
interface State {
  identities: MessagingIdentity[];
  envelopes: RelayEnvelope[];
}

export interface DidCommRepository {
  findIdentityByDid(did: string): Promise<MessagingIdentity | undefined>;
  findIdentityByWallet(wallet: string): Promise<MessagingIdentity | undefined>;
  listIdentities(): Promise<MessagingIdentity[]>;
  listEnvelopes(wallet: string): Promise<RelayEnvelope[]>;
  listEnvelopesByDid?(did: string): Promise<RelayEnvelope[]>;
  saveEnvelope(record: RelayEnvelope): Promise<void>;
  saveIdentity(record: MessagingIdentity): Promise<void>;
}

export class JsonDidCommRepository implements DidCommRepository {
  private queue = Promise.resolve();
  constructor(private readonly path: string) {}
  async findIdentityByDid(did: string) {
    return (await this.read()).identities.find((item) => item.did === did);
  }
  async findIdentityByWallet(wallet: string) {
    return (await this.read()).identities.find(
      (item) => item.wallet.toLowerCase() === wallet.toLowerCase(),
    );
  }
  async listIdentities() {
    return (await this.read()).identities;
  }
  async listEnvelopes(wallet: string) {
    const identities = await this.listIdentities();
    const did = identities.find((item) => item.wallet.toLowerCase() === wallet.toLowerCase())?.did;
    return did
      ? (await this.read()).envelopes.filter((item) => item.fromDid === did || item.toDid === did)
      : [];
  }
  async listEnvelopesByDid(did: string) {
    return (await this.read()).envelopes.filter(
      (item) => item.fromDid === did || item.toDid === did,
    );
  }
  async saveEnvelope(record: RelayEnvelope) {
    await this.update((state) => {
      if (state.envelopes.some((item) => item.id === record.id))
        throw new Error('DUPLICATE_MESSAGE');
      state.envelopes.push(record);
    });
  }
  async saveIdentity(record: MessagingIdentity) {
    await this.update((state) => {
      state.identities = state.identities.filter(
        (item) =>
          item.wallet.toLowerCase() !== record.wallet.toLowerCase() && item.did !== record.did,
      );
      state.identities.push(record);
    });
  }
  private async read(): Promise<State> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { identities: [], envelopes: [] };
      throw error;
    }
  }
  private async update(change: (state: State) => void) {
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
