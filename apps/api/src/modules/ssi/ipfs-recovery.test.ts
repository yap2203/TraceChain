import { afterEach, expect, it, vi } from 'vitest';
import { IpfsEncryptedCredentialStore } from './encrypted-credential.store.js';
const cid = 'b' + 'a'.repeat(58);
afterEach(() => vi.unstubAllGlobals());
it('retrieves pinned encrypted bytes with a restored backend key and rejects wrong keys or modified ciphertext', async () => {
  let pinned = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      if (init?.method === 'POST') {
        pinned = await ((init.body as FormData).get('file') as Blob).text();
        return new Response(JSON.stringify({ IpfsHash: cid }));
      }
      return new Response(pinned);
    }),
  );
  const keys = Buffer.alloc(32, 9);
  const store = new IpfsEncryptedCredentialStore(
    keys,
    'https://pin.invalid',
    'token',
    'https://gateway.invalid/ipfs',
  );
  await store.encryptAndStore('TEST-SIGNED-VC-CONTENT', 'test');
  expect(pinned).not.toContain('TEST-SIGNED');
  const recovered = new IpfsEncryptedCredentialStore(
    Buffer.from(keys),
    'https://pin.invalid',
    'token',
    'https://gateway.invalid/ipfs',
  );
  expect(await recovered.retrieveAndDecrypt(cid)).toBe('TEST-SIGNED-VC-CONTENT');
  await expect(
    new IpfsEncryptedCredentialStore(
      Buffer.alloc(32, 2),
      'https://pin.invalid',
      'token',
    ).retrieveAndDecrypt(cid),
  ).rejects.toThrow();
  const payload = JSON.parse(pinned);
  payload.ciphertext = 'AAAA';
  pinned = JSON.stringify(payload);
  await expect(recovered.retrieveAndDecrypt(cid)).rejects.toThrow();
});
it('fails explicitly on unavailable gateways, malformed envelopes and non-CID references', async () => {
  const store = new IpfsEncryptedCredentialStore(
    Buffer.alloc(32, 9),
    'https://pin.invalid',
    'token',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  await expect(store.retrieveAndDecrypt(cid)).rejects.toThrow('could not be retrieved');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
  await expect(store.retrieveAndDecrypt(cid)).rejects.toThrow('envelope');
  await expect(store.retrieveAndDecrypt('https://attacker.invalid/secret')).rejects.toThrow('CID');
});
