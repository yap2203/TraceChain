import { afterEach, expect, it, vi } from 'vitest';
import { IpfsEncryptedCredentialStore } from './encrypted-credential.store.js';
const cid = 'b' + 'a'.repeat(58);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('deduplicates concurrent encrypted downloads without retaining plaintext or caching failed fetches', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  let complete!: (response: Response) => void;
  const payload = {
    algorithm: 'aes-256-gcm',
    version: 1,
    iv: Buffer.alloc(12).toString('base64'),
    authTag: Buffer.alloc(16).toString('base64'),
    ciphertext: 'AA==',
  };
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValue(new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetch);
  const store = new IpfsEncryptedCredentialStore(
    Buffer.alloc(32, 9),
    'https://pin.invalid',
    'token',
  );
  const a = store.retrieveEnvelope(cid),
    b = store.retrieveEnvelope(cid);
  expect(fetch).toHaveBeenCalledTimes(1);
  complete(new Response(JSON.stringify(payload)));
  const [first, second] = await Promise.all([a, b]);
  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  expect(await store.retrieveEnvelope(cid)).toEqual(payload);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 31_000);
  await expect(store.retrieveEnvelope(cid)).rejects.toThrow('could not be retrieved');
  expect(await store.retrieveEnvelope(cid)).toEqual(payload);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('retrieves pinned encrypted bytes with a restored backend key and rejects wrong keys or modified ciphertext', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
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
  vi.setSystemTime(Date.now() + 31_000);
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
