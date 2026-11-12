import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanyRole } from '@tracechain/shared';
import type { AuthService } from '../auth/auth.service.js';
import type { DidCommRepository, RelayEnvelope } from './didcomm.repository.js';
import {
  DidCommService,
  DIDCOMM_COMPANY_IDENTITY_REQUEST_TYPE,
  DIDCOMM_COMPANY_IDENTITY_PRESENTATION_TYPE,
} from './didcomm.service.js';

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
  it('refreshes authorized role metadata without replacing keys or losing historical decryption', async () => {
    const { key, path, service } = await fixture();
    const original = await service.ensureIdentity({
      wallet: 'supplier-wallet',
      role: 'MANUFACTURER',
      companyName: 'Old name',
    });
    const sender = await service.ensureIdentity({
      wallet: 'sender-wallet',
      role: 'MANUFACTURER',
      companyName: 'Sender',
    });
    const envelope = await service.pack(sender.did, {
      id: crypto.randomUUID(),
      type: 'test',
      from: sender.did,
      to: [original.did],
      body: { purpose: 'Historical message' },
    });
    const before = JSON.parse(await readFile(path, 'utf8')).identities[0];
    const updated = await service.ensureIdentity({
      wallet: original.wallet,
      role: 'SUPPLIER',
      companyName: 'Current name',
    });
    expect(updated.did).toBe(original.did);
    expect(updated.role).toBe('SUPPLIER');
    const after = JSON.parse(await readFile(path, 'utf8')).identities[0];
    for (const field of ['ciphertext', 'iv', 'tag', 'registeredAt'])
      expect(after[field]).toBe(before[field]);
    const restarted = new BackendDidCommAgentService(path, key);
    expect((await restarted.findByWallet(original.wallet))?.role).toBe('SUPPLIER');
    expect((await restarted.unpack(original.did, envelope)).body).toEqual({
      purpose: 'Historical message',
    });
  });
  it('starts an authorized company-proof thread without a missing ingredient notification and retains strict reply binding', async () => {
    const { service: agents } = await fixture();
    const maker = '0x1111111111111111111111111111111111111111',
      supplier = '0x2222222222222222222222222222222222222222';
    const now = new Date('2026-11-12T12:00:00Z');
    await agents.ensureIdentity({
      wallet: supplier,
      role: 'MANUFACTURER',
      companyName: 'Old Supplier role',
    });
    await agents.ensureIdentity({
      wallet: maker,
      role: 'SUPPLIER',
      companyName: 'Old Manufacturer role',
    });
    const auth = {
      getSession: vi
        .fn()
        .mockResolvedValue({
          address: supplier,
          role: CompanyRole.SUPPLIER,
          authenticated: true,
          authorizationReady: true,
          companyName: 'Supplier',
        }),
    } as unknown as AuthService;
    const envelopes: RelayEnvelope[] = [];
    const repository = {
      listEnvelopes: async () => envelopes,
      listEnvelopesByDid: async (did: string) =>
        envelopes.filter((item) => item.toDid === did || item.fromDid === did),
      saveEnvelope: async (record: RelayEnvelope) => {
        envelopes.push(record);
      },
    } as unknown as DidCommRepository;
    const context = vi.fn(async (reference: string) =>
      reference === 'request-1'
        ? { requester: maker, supplier, identityRequestAllowed: true }
        : undefined,
    );
    const service = new DidCommService(
      auth,
      repository,
      'localhost',
      31337,
      {
        resolve: async (wallet: string) => ({
          walletAddress: wallet,
          companyName: 'Current company',
          role: wallet === maker ? CompanyRole.MANUFACTURER : CompanyRole.SUPPLIER,
        }),
      } as any,
      () => now,
      agents,
      context,
    );
    const input = {
      body: { purpose: 'Confirm requester identity' },
      businessReference: 'request-1',
      threadId: 'request-1',
      messageType: DIDCOMM_COMPANY_IDENTITY_REQUEST_TYPE,
      expiresAt: new Date(now.getTime() + 60000).toISOString(),
      recipientWallet: maker,
    };
    await expect(
      service.send('session', { ...input, recipientWallet: supplier }),
    ).rejects.toMatchObject({ code: 'RECIPIENT_SUBSTITUTION_REJECTED' });
    await expect(
      service.send('session', { ...input, businessReference: 'missing' }),
    ).rejects.toMatchObject({ code: 'BUSINESS_REQUEST_NOT_FOUND' });
    await expect(
      service.send('session', { ...input, threadId: 'another-thread' }),
    ).rejects.toMatchObject({ code: 'THREAD_MISMATCH' });
    await expect(
      service.send('session', { ...input, parentThreadId: 'forged-parent' }),
    ).rejects.toMatchObject({ code: 'THREAD_MISMATCH' });
    context
      .mockResolvedValueOnce({ requester: maker, supplier, identityRequestAllowed: false })
      .mockResolvedValueOnce({ requester: maker, supplier, identityRequestAllowed: false });
    await expect(service.send('session', input)).rejects.toMatchObject({ code: 'THREAD_MISMATCH' });
    await expect(
      service.send('session', {
        ...input,
        expiresAt: new Date(now.getTime() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE_TIME' });
    const sent = await service.send('session', input);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].parentThreadId).toBeUndefined();
    expect(envelopes[0].envelope).not.toContain(input.body.purpose);
    expect((await service.send('session', input)).id).toBe(sent.id);
    expect(envelopes).toHaveLength(1);
    expect((await agents.findByWallet(supplier))?.role).toBe(CompanyRole.SUPPLIER);
    const recipient = await agents.findByWallet(maker);
    expect((await agents.unpack(recipient!.did, envelopes[0].envelope)).body).toEqual(input.body);
    vi.mocked(auth.getSession).mockResolvedValue({
      address: maker,
      role: CompanyRole.MANUFACTURER,
      authenticated: true,
      authorizationReady: true,
    } as any);
    const reply = {
      ...input,
      messageType: DIDCOMM_COMPANY_IDENTITY_PRESENTATION_TYPE,
      recipientWallet: supplier,
      body: { presentation: 'explicitly-approved-test-proof' },
    };
    await expect(
      service.send('session', { ...reply, threadId: 'wrong-thread' }),
    ).rejects.toMatchObject({ code: 'THREAD_MISMATCH' });
    await service.send('session', reply);
    expect(envelopes[1].parentThreadId).toBe(sent.id);
    expect(envelopes[1].toDid).toBe(envelopes[0].fromDid);
    expect(envelopes).toHaveLength(2);
  });
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
