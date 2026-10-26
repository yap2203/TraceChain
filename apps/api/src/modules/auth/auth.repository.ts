import type { NonceRecord, SessionRecord } from './auth.types.js';

export interface NonceRepository {
  consume(nonce: string, consumedAt: Date): Promise<NonceRecord | null>;
  find(nonce: string): Promise<NonceRecord | null>;
  save(record: NonceRecord): Promise<void>;
}

export interface SessionRepository {
  delete(id: string): Promise<void>;
  find(id: string, now: Date): Promise<SessionRecord | null>;
  save(record: SessionRecord): Promise<void>;
}

export class InMemoryNonceRepository implements NonceRepository {
  private readonly records = new Map<string, NonceRecord>();

  async save(record: NonceRecord) {
    this.records.set(record.nonce, { ...record });
  }

  async find(nonce: string) {
    const record = this.records.get(nonce);
    return record ? { ...record } : null;
  }

  async consume(nonce: string, consumedAt: Date) {
    const record = this.records.get(nonce);

    if (!record || record.consumedAt || record.expiresAt.getTime() <= consumedAt.getTime()) {
      return null;
    }

    const consumedRecord = { ...record, consumedAt };
    this.records.set(nonce, consumedRecord);
    return { ...consumedRecord };
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly records = new Map<string, SessionRecord>();

  async save(record: SessionRecord) {
    this.records.set(record.id, { ...record });
  }

  async find(id: string, now: Date) {
    const record = this.records.get(id);

    if (!record) return null;

    if (record.expiresAt.getTime() <= now.getTime()) {
      this.records.delete(id);
      return null;
    }

    return { ...record };
  }

  async delete(id: string) {
    this.records.delete(id);
  }
}
