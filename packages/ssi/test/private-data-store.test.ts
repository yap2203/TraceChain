import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { createPrivateDataStores, privateDataPath } from '../src/storage/private-data-store.js';
it('migrates credentials, derived claims, presentations and messages without losing DID metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracechain-private-store-')),
    file = join(dir, 'public.json');
  try {
    const original = {
      dids: { issuer: { did: 'did:key:public' } },
      keys: { public: { publicKeyHex: 'public-only' } },
      credentials: { one: { credential: 'PRIVATE-VC' } },
      claims: { one: { value: 'PRIVATE-CLAIM' } },
      presentations: { one: { proof: 'PRIVATE-VP' } },
      messages: { one: { body: 'PRIVATE-MESSAGE' } },
    };
    await writeFile(file, JSON.stringify(original));
    const stores = await createPrivateDataStores(file, 'a'.repeat(64));
    expect(stores.data.credentials).toEqual(original.credentials);
    const publicText = await readFile(file, 'utf8');
    expect(publicText).not.toMatch(/PRIVATE-|credentials|claims|presentations|messages/);
    expect(JSON.parse(publicText).dids).toEqual(original.dids);
    expect(await readFile(privateDataPath(file), 'utf8')).not.toMatch(/PRIVATE-/);
    const restored = await createPrivateDataStores(file, 'a'.repeat(64));
    expect(restored.data.claims).toEqual(original.claims);
    await expect(createPrivateDataStores(file, 'b'.repeat(64))).rejects.toThrow(
      'could not be unlocked',
    );
    expect(JSON.parse(await readFile(file, 'utf8')).dids).toEqual(original.dids);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('does not remove a legacy store when its encrypted copy cannot be recovered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tracechain-migrate-fail-')),
    file = join(dir, 'public.json');
  try {
    await writeFile(file, JSON.stringify({ credentials: { one: { credential: 'DO-NOT-LOSE' } } }));
    await writeFile(privateDataPath(file), 'invalid');
    await expect(createPrivateDataStores(file, 'a'.repeat(64))).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toContain('DO-NOT-LOSE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
