import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CompanyRole } from '@tracechain/shared';
import { id } from 'ethers';
import { describe, expect, it } from 'vitest';
import { BackendDidCommAgentService } from '../didcomm/backend-agent.service.js';
import { JsonDidCommRepository } from '../didcomm/didcomm.repository.js';
import { DidCommService } from '../didcomm/didcomm.service.js';

describe('encrypted order identity delivery', () => {
  it.each([CompanyRole.MANUFACTURER, CompanyRole.RETAILER])(
    'delivers %s buyer presentations between distinct agents with exact participants and threads',
    async (buyerRole) => {
      const directory = await mkdtemp(join(tmpdir(), 'tracechain-order-didcomm-'));
      try {
        const seller = '0x2000000000000000000000000000000000000002',
          buyer = '0x3000000000000000000000000000000000000003';
        const sellerRole =
          buyerRole === CompanyRole.MANUFACTURER ? CompanyRole.SUPPLIER : CompanyRole.MANUFACTURER;
        const agents = new BackendDidCommAgentService(
          join(directory, 'agents.json'),
          Buffer.alloc(32, 3),
        );
        const repository = new JsonDidCommRepository(join(directory, 'envelopes.json'));
        const service = new DidCommService(
          {
            getSession: async (session: string) => ({
              authenticated: true,
              authorizationReady: true,
              address: session === 'seller' ? seller : buyer,
              role: session === 'seller' ? sellerRole : buyerRole,
            }),
          } as any,
          repository,
          'localhost:5173',
          31337,
          {
            resolve: async (wallet: string) => ({
              walletAddress: wallet,
              companyName: 'Authorized test company',
              role: wallet === seller ? sellerRole : buyerRole,
            }),
          } as any,
          undefined,
          agents,
          async () => ({ requester: buyer, supplier: seller, order: true }),
        );
        const context = {
          businessReference: id('order'),
          threadId: id('fresh-challenge'),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
        };
        const requestType = 'https://tracechain.local/didcomm/order-identity-request/1.0';
        const responseType = 'https://tracechain.local/didcomm/order-identity-presentation/1.0';
        await service.send('seller', {
          ...context,
          messageType: requestType,
          recipientWallet: buyer,
          body: { purpose: 'Private identity purpose' },
        });
        await service.send('buyer', {
          ...context,
          messageType: responseType,
          recipientWallet: seller,
          body: { presentation: 'private-signed-holder-presentation' },
        });
        const sender = await agents.findByWallet(buyer),
          recipient = await agents.findByWallet(seller);
        const envelopes = await repository.listEnvelopesByDid(recipient!.did);
        expect(envelopes).toHaveLength(2);
        const response = envelopes.find((envelope) => envelope.messageType === responseType)!;
        expect(response.parentThreadId).toBe(
          envelopes.find((envelope) => envelope.messageType === requestType)!.id,
        );
        expect(response.deliveryState).toBe('RECEIVED_DECRYPTED');
        expect((await agents.unpack(recipient!.did, response.envelope)).body).toEqual({
          presentation: 'private-signed-holder-presentation',
        });
        await expect(agents.unpack(sender!.did, response.envelope)).rejects.toThrow();
        expect(await readFile(join(directory, 'envelopes.json'), 'utf8')).not.toContain(
          'private-signed-holder-presentation',
        );
        // Exact delivery retries are idempotent; another recipient/thread is rejected.
        await service.send('buyer', {
          ...context,
          messageType: responseType,
          recipientWallet: seller,
          body: { presentation: 'private-signed-holder-presentation' },
        });
        expect(await repository.listEnvelopesByDid(recipient!.did)).toHaveLength(2);
        await expect(
          service.send('buyer', {
            ...context,
            messageType: responseType,
            recipientWallet: seller,
            body: { presentation: 'different-presentation' },
          }),
        ).rejects.toMatchObject({ code: 'DELIVERY_REPLAY_CONFLICT' });
        await expect(
          service.send('buyer', {
            ...context,
            messageType: responseType,
            recipientWallet: buyer,
            body: {},
          }),
        ).rejects.toMatchObject({ code: 'RECIPIENT_SUBSTITUTION_REJECTED' });
        await expect(
          service.send('buyer', {
            ...context,
            threadId: id('wrong-challenge'),
            messageType: responseType,
            recipientWallet: seller,
            body: {},
          }),
        ).rejects.toMatchObject({ code: 'THREAD_MISMATCH' });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
