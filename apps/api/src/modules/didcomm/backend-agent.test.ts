import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BackendDidCommAgentService } from './backend-agent.service.js';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tracechain-didcomm-'));
  temporary.push(directory);
  const path = join(directory, 'agents.json');
  const key = Buffer.alloc(32, 7);
  return { key, path, service: new BackendDidCommAgentService(path, key) };
}

describe('backend-managed DIDComm company agents', () => {
  it('authcrypt packs, recipient-unpacks and persists separate company keys across restart', async () => {
    const { key, path, service } = await fixture();
    const manufacturer = await service.ensureIdentity({
      companyName: 'Manufacturer A',
      role: 'MANUFACTURER',
      wallet: '0x1111111111111111111111111111111111111111',
    });
    const supplier = await service.ensureIdentity({
      companyName: 'Supplier A',
      role: 'SUPPLIER',
      wallet: '0x2222222222222222222222222222222222222222',
    });
    expect(manufacturer.did).not.toBe(supplier.did);
    const envelope = await service.pack(manufacturer.did, {
      id: crypto.randomUUID(),
      type: 'https://tracechain.local/didcomm/test/1.0',
      from: manufacturer.did,
      to: [supplier.did],
      body: { privateClaim: 'Malaysia' },
    });
    expect(envelope).not.toContain('Malaysia');

    const restarted = new BackendDidCommAgentService(path, key);
    const unpacked = await restarted.unpack(supplier.did, envelope);
    expect(unpacked.body).toEqual({ privateClaim: 'Malaysia' });
    await expect(restarted.unpack(manufacturer.did, envelope)).rejects.toThrow();

    const stored = await readFile(path, 'utf8');
    expect(stored).not.toContain('Malaysia');
    expect(stored).not.toMatch(/"privateKey"/i);
  });

  it('rejects tampering and fails closed when the protected key is missing', async () => {
    const { key, path, service } = await fixture();
    const sender = await service.ensureIdentity({
      companyName: 'Retailer',
      role: 'RETAILER',
      wallet: '0x3333333333333333333333333333333333333333',
    });
    const recipient = await service.ensureIdentity({
      companyName: 'Supplier',
      role: 'SUPPLIER',
      wallet: '0x4444444444444444444444444444444444444444',
    });
    const envelope = await service.pack(sender.did, {
      id: crypto.randomUUID(),
      type: 'https://tracechain.local/didcomm/test/1.0',
      from: sender.did,
      to: [recipient.did],
      body: { request: 'evidence' },
    });
    await expect(service.unpack(recipient.did, `${envelope.slice(0, -2)}xx`)).rejects.toThrow();

    const state = JSON.parse(await readFile(path, 'utf8')) as { identities: unknown[]; version: 1 };
    state.identities = [];
    await writeFile(path, JSON.stringify(state));
    const restarted = new BackendDidCommAgentService(path, key);
    await expect(restarted.unpack(recipient.did, envelope)).rejects.toThrow(/key is missing/i);
  });
});
