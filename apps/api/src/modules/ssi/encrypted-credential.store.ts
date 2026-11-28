import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { countRead, measureRead } from '../blockchain/read-timing.js';

export interface EncryptedCredentialPayload {
  algorithm: 'aes-256-gcm';
  authTag: string;
  ciphertext: string;
  iv: string;
  version: 1;
}

export interface StoredEncryptedCredential {
  cid: string;
  payload: EncryptedCredentialPayload;
}
export class CredentialRetrievalError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus?: number,
  ) {
    super(message);
  }
}

export interface CredentialContentStore {
  retrieveEnvelope?(cid: string): Promise<EncryptedCredentialPayload>;
  retrieveAndDecrypt?(cid: string): Promise<string>;
  decrypt(payload: EncryptedCredentialPayload): Promise<string>;
  encryptAndStore(
    serializedCredential: string,
    credentialId: string,
  ): Promise<StoredEncryptedCredential>;
}

export type EncryptedEnvelopeCache = Map<
  string,
  { value: Promise<EncryptedCredentialPayload>; until: number }
>;
export class IpfsEncryptedCredentialStore implements CredentialContentStore {
  // Immutable encrypted envelopes only. Authorization, decryption and hash/context checks
  // remain in their callers on every access; no plaintext or authorization grants are cached.
  private readonly envelopeReads: EncryptedEnvelopeCache;
  private readonly cacheScope: string;
  constructor(
    private readonly encryptionKey: Buffer,
    private readonly pinningApiUrl: string,
    private readonly pinningToken: string,
    private readonly gatewayUrl = 'https://gateway.pinata.cloud/ipfs',
    cache?: EncryptedEnvelopeCache,
  ) {
    if (encryptionKey.length !== 32) throw new Error('Credential encryption key must be 32 bytes.');
    this.envelopeReads = cache ?? new Map();
    this.cacheScope = createHash('sha256')
      .update(encryptionKey)
      .update(JSON.stringify([gatewayUrl, pinningApiUrl, pinningToken]))
      .digest('hex');
  }

  async retrieveAndDecrypt(reference: string) {
    return this.decrypt(await this.retrieveEnvelope(reference));
  }

  async retrieveEnvelope(reference: string) {
    const cid = reference.replace(/^ipfs:\/\//, '');
    if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(cid))
      throw new Error('Invalid encrypted credential CID.');
    const cacheKey = `${this.cacheScope}:${cid}`;
    const existing = this.envelopeReads.get(cacheKey);
    if (existing && existing.until > Date.now()) return structuredClone(await existing.value);
    const pending = measureRead('ipfs', () => this.downloadEnvelope(cid));
    const entry = { value: pending, until: Infinity };
    this.envelopeReads.set(cacheKey, entry);
    if (this.envelopeReads.size > 64)
      this.envelopeReads.delete(this.envelopeReads.keys().next().value!);
    try {
      const result = await pending;
      // Bound completed ciphertext retention to ~32 MB; large media only shares in-flight work.
      if (result.ciphertext.length <= 512 * 1024) entry.until = Date.now() + 30_000;
      else if (this.envelopeReads.get(cacheKey) === entry) this.envelopeReads.delete(cacheKey);
      return structuredClone(result);
    } catch (error) {
      if (this.envelopeReads.get(cacheKey) === entry) this.envelopeReads.delete(cacheKey);
      throw error;
    }
  }

  private async downloadEnvelope(cid: string) {
    countRead('ipfs');
    let response: Response;
    try {
      response = await fetch(`${this.gatewayUrl.replace(/\/$/, '')}/${encodeURIComponent(cid)}`, {
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new CredentialRetrievalError(
        'IPFS_NETWORK_UNAVAILABLE',
        'The IPFS gateway is unreachable or timed out.',
      );
    }
    if (!response.ok)
      throw new CredentialRetrievalError(
        'IPFS_HTTP_UNAVAILABLE',
        'The pinned credential could not be retrieved from IPFS.',
        response.status,
      );
    const payload = (await response.json()) as EncryptedCredentialPayload;
    if (
      payload.algorithm !== 'aes-256-gcm' ||
      payload.version !== 1 ||
      Buffer.from(payload.iv ?? '', 'base64').length !== 12 ||
      Buffer.from(payload.authTag ?? '', 'base64').length !== 16
    )
      throw new Error('The pinned encrypted credential envelope is invalid.');
    return payload;
  }

  async encryptAndStore(serializedCredential: string, credentialId: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(serializedCredential, 'utf8'), cipher.final()]);
    const payload: EncryptedCredentialPayload = {
      algorithm: 'aes-256-gcm',
      authTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      version: 1,
    };
    const form = new FormData();
    form.append(
      'file',
      new Blob([JSON.stringify(payload)], { type: 'application/json' }),
      `${credentialId.replace(/[^a-zA-Z0-9_-]/g, '_')}.encrypted.json`,
    );
    const response = await fetch(this.pinningApiUrl, {
      signal: AbortSignal.timeout(60000),
      body: form,
      headers: { Authorization: `Bearer ${this.pinningToken}` },
      method: 'POST',
    });
    if (!response.ok)
      throw new Error(`Encrypted credential pinning failed with HTTP ${response.status}.`);
    const result = (await response.json()) as Record<string, unknown>;
    const cid = result.IpfsHash ?? result.cid ?? result.Hash;
    if (typeof cid !== 'string' || !cid)
      throw new Error('The pinning provider did not return an IPFS CID.');
    return { cid, payload };
  }

  async decrypt(payload: EncryptedCredentialPayload) {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(payload.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
