import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
  retrieveAndDecrypt?(cid: string): Promise<string>;
  decrypt(payload: EncryptedCredentialPayload): Promise<string>;
  encryptAndStore(
    serializedCredential: string,
    credentialId: string,
  ): Promise<StoredEncryptedCredential>;
}

export class IpfsEncryptedCredentialStore implements CredentialContentStore {
  constructor(
    private readonly encryptionKey: Buffer,
    private readonly pinningApiUrl: string,
    private readonly pinningToken: string,
    private readonly gatewayUrl = 'https://gateway.pinata.cloud/ipfs',
  ) {
    if (encryptionKey.length !== 32) throw new Error('Credential encryption key must be 32 bytes.');
  }

  async retrieveAndDecrypt(reference: string) {
    const cid = reference.replace(/^ipfs:\/\//, '');
    if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/.test(cid))
      throw new Error('Invalid encrypted credential CID.');
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
    return this.decrypt(payload);
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
