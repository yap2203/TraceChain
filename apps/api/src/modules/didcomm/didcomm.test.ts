import { CompanyRole } from '@tracechain/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AuthService } from '../auth/auth.service.js';
import type { DidCommRepository, MessagingIdentity, RelayEnvelope } from './didcomm.repository.js';
import {
  DidCommError,
  DidCommService,
  DIDCOMM_EVIDENCE_ACK_TYPE,
  DIDCOMM_EVIDENCE_REQUEST_TYPE,
  DIDCOMM_COMPANY_IDENTITY_DECLINED_TYPE,
  DIDCOMM_COMPANY_IDENTITY_PRESENTATION_TYPE,
  DIDCOMM_COMPANY_IDENTITY_REQUEST_TYPE,
} from './didcomm.service.js';

const MANUFACTURER = '0x1000000000000000000000000000000000000001';
const SUPPLIER = '0x2000000000000000000000000000000000000002';
const manufacturer: MessagingIdentity = {
  companyName: 'Maker',
  did: 'did:key:manufacturer',
  registeredAt: new Date().toISOString(),
  role: CompanyRole.MANUFACTURER,
  wallet: MANUFACTURER,
};
const supplier: MessagingIdentity = {
  companyName: 'Supplier',
  did: 'did:key:supplier',
  registeredAt: new Date().toISOString(),
  role: CompanyRole.SUPPLIER,
  wallet: SUPPLIER,
};
const retailer: MessagingIdentity = {
  companyName: 'Retailer',
  did: 'did:key:retailer',
  registeredAt: new Date().toISOString(),
  role: CompanyRole.RETAILER,
  wallet: '0x3000000000000000000000000000000000000003',
};

describe('DIDComm ciphertext relay authorization', () => {
  it('accepts the narrow request/ack flow and rejects replay and thread mismatch', async () => {
    const repository = memoryRepository([manufacturer, supplier]);
    const auth = authService(MANUFACTURER, CompanyRole.MANUFACTURER);
    const service = new DidCommService(
      auth,
      repository,
      'localhost',
      31337,
      undefined,
      () => new Date('2026-11-07T10:00:00Z'),
    );
    const request = envelope({
      fromDid: manufacturer.did,
      toDid: supplier.did,
      messageType: DIDCOMM_EVIDENCE_REQUEST_TYPE,
    });
    await expect(service.relay('session', request)).resolves.toMatchObject({ accepted: true });
    await expect(service.relay('session', request)).rejects.toMatchObject({
      code: 'DUPLICATE_MESSAGE',
    });
    vi.mocked(auth.getSession).mockResolvedValue(session(SUPPLIER, CompanyRole.SUPPLIER));
    const acknowledgement = envelope({
      fromDid: supplier.did,
      toDid: manufacturer.did,
      messageType: DIDCOMM_EVIDENCE_ACK_TYPE,
      parentThreadId: request.id,
      threadId: request.threadId,
    });
    await expect(service.relay('session', acknowledgement)).resolves.toMatchObject({
      accepted: true,
    });
    await expect(
      service.relay(
        'session',
        envelope({
          fromDid: supplier.did,
          toDid: manufacturer.did,
          messageType: DIDCOMM_EVIDENCE_ACK_TYPE,
          parentThreadId: crypto.randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'THREAD_MISMATCH' });
  });

  it('rejects impersonation, substituted recipients, expiry and unauthorized roles', async () => {
    const repository = memoryRepository([manufacturer, supplier, retailer]);
    const auth = authService(MANUFACTURER, CompanyRole.MANUFACTURER);
    const service = new DidCommService(
      auth,
      repository,
      'localhost',
      31337,
      undefined,
      () => new Date('2026-11-07T10:00:00Z'),
    );
    await expect(
      service.relay('session', envelope({ fromDid: supplier.did, toDid: supplier.did })),
    ).rejects.toMatchObject({ code: 'SENDER_BINDING_REQUIRED' });
    await expect(
      service.relay('session', envelope({ toDid: 'did:key:attacker' })),
    ).rejects.toMatchObject({ code: 'RECIPIENT_NOT_BOUND' });
    await expect(
      service.relay('session', envelope({ expiresAt: '2026-11-07T09:00:00.000Z' })),
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE_TIME' });
    vi.mocked(auth.getSession).mockResolvedValue(
      session(retailer.wallet, CompanyRole.RETAILER),
    );
    await expect(
      service.relay(
        'session',
        envelope({
          fromDid: retailer.did,
          toDid: supplier.did,
          messageType: DIDCOMM_EVIDENCE_ACK_TYPE,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED_MESSAGE_FLOW',
    });
  });

  it('does not expose or relay to a participant whose on-chain authorization is no longer current', async () => {
    const repository = memoryRepository([manufacturer, supplier]);
    const participants = {
      resolve: vi.fn(async (wallet: string) =>
        wallet.toLowerCase() === MANUFACTURER.toLowerCase()
          ? {
              active: true as const,
              companyName: 'Maker',
              role: CompanyRole.MANUFACTURER,
              walletAddress: MANUFACTURER,
            }
          : null,
      ),
    };
    const service = new DidCommService(
      authService(MANUFACTURER, CompanyRole.MANUFACTURER),
      repository,
      'localhost',
      31337,
      participants,
      () => new Date('2026-11-07T10:00:00Z'),
    );

    await expect(service.directory('session')).resolves.toEqual([
      expect.objectContaining({ did: manufacturer.did }),
    ]);
    await expect(service.relay('session', envelope({}))).rejects.toMatchObject({
      code: 'RECIPIENT_NOT_AUTHORIZED',
    });
  });

  it('fails closed instead of returning a server error when directory authorization is unavailable', async () => {
    const service = new DidCommService(
      authService(MANUFACTURER, CompanyRole.MANUFACTURER),
      memoryRepository([manufacturer]),
      'localhost',
      31337,
      { resolve: vi.fn().mockRejectedValue(new Error('RPC unavailable')) },
    );

    await expect(service.directory('session')).resolves.toEqual([]);
  });

  it('links identity requests and accepts Manufacturer and Retailer presentations or rejection', async () => {
    for (const presenter of [manufacturer, retailer]) {
      const repository = memoryRepository([presenter, supplier]);
      const auth = authService(presenter.wallet, presenter.role as CompanyRole);
      const service = new DidCommService(
        auth,
        repository,
        'localhost',
        31337,
        undefined,
        () => new Date('2026-11-07T10:00:00Z'),
      );
      const evidence = envelope({
        fromDid: presenter.did,
        toDid: supplier.did,
        messageType: DIDCOMM_EVIDENCE_REQUEST_TYPE,
      });
      await expect(service.relay('session', evidence)).resolves.toMatchObject({ accepted: true });
      vi.mocked(auth.getSession).mockResolvedValue(session(SUPPLIER, CompanyRole.SUPPLIER));
      const identityRequest = envelope({
        fromDid: supplier.did,
        toDid: presenter.did,
        messageType: DIDCOMM_COMPANY_IDENTITY_REQUEST_TYPE,
        parentThreadId: evidence.id,
        threadId: evidence.threadId,
      });
      await expect(service.relay('session', identityRequest)).resolves.toMatchObject({
        accepted: true,
      });
      vi.mocked(auth.getSession).mockResolvedValue(session(presenter.wallet, presenter.role as CompanyRole));
      await expect(
        service.relay(
          'session',
          envelope({
            fromDid: presenter.did,
            toDid: supplier.did,
            messageType: DIDCOMM_COMPANY_IDENTITY_PRESENTATION_TYPE,
            parentThreadId: identityRequest.id,
            threadId: identityRequest.threadId,
          }),
        ),
      ).resolves.toMatchObject({ accepted: true });
      vi.mocked(auth.getSession).mockResolvedValue(session(SUPPLIER, CompanyRole.SUPPLIER));
      const declineRequest = envelope({
        fromDid: supplier.did,
        toDid: presenter.did,
        messageType: DIDCOMM_COMPANY_IDENTITY_REQUEST_TYPE,
        parentThreadId: evidence.id,
        threadId: evidence.threadId,
      });
      await expect(service.relay('session', declineRequest)).resolves.toMatchObject({
        accepted: true,
      });
      vi.mocked(auth.getSession).mockResolvedValue(
        session(presenter.wallet, presenter.role as CompanyRole),
      );
      await expect(
        service.relay(
          'session',
          envelope({
            fromDid: presenter.did,
            toDid: supplier.did,
            messageType: DIDCOMM_COMPANY_IDENTITY_DECLINED_TYPE,
            parentThreadId: declineRequest.id,
            threadId: identityRequest.threadId,
          }),
        ),
      ).resolves.toMatchObject({ accepted: true });
      await expect(
        service.relay(
          'session',
          envelope({
            fromDid: presenter.did,
            toDid: supplier.did,
            messageType: DIDCOMM_COMPANY_IDENTITY_PRESENTATION_TYPE,
            parentThreadId: declineRequest.id,
            threadId: identityRequest.threadId,
          }),
        ),
      ).rejects.toMatchObject({ code: 'IDENTITY_RESPONSE_REPLAY' });
    }
  });
});

function session(address: string, role: CompanyRole) {
  return {
    address,
    authenticated: true as const,
    authorizationReady: true,
    authorizationStatus: 'AUTHORIZED' as const,
    credentialVerified: false as const,
    expiresAt: '2027-01-01T00:00:00Z',
    locallyVerified: false as const,
    message: 'ok',
    onChainStatusChecked: true,
    role,
  };
}
function authService(address: string, role: CompanyRole) {
  return {
    getSession: vi.fn().mockResolvedValue(session(address, role)),
  } as unknown as AuthService;
}
function envelope(overrides: Partial<RelayEnvelope>): RelayEnvelope {
  const now = new Date('2026-11-07T10:00:00Z');
  const id = crypto.randomUUID();
  return {
    businessReference: 'REQ-1',
    createdAt: now.toISOString(),
    envelope: '{"protected":"ciphertext-only-envelope"}',
    expiresAt: new Date(now.getTime() + 300_000).toISOString(),
    fromDid: manufacturer.did,
    id,
    messageType: DIDCOMM_EVIDENCE_REQUEST_TYPE,
    threadId: id,
    toDid: supplier.did,
    ...overrides,
  };
}
function memoryRepository(initial: MessagingIdentity[]): DidCommRepository {
  const identities = [...initial];
  const envelopes: RelayEnvelope[] = [];
  return {
    findIdentityByDid: async (did) => identities.find((item) => item.did === did),
    findIdentityByWallet: async (wallet) =>
      identities.find((item) => item.wallet.toLowerCase() === wallet.toLowerCase()),
    listIdentities: async () => identities,
    listEnvelopes: async (wallet) => {
      const did = identities.find(
        (item) => item.wallet.toLowerCase() === wallet.toLowerCase(),
      )?.did;
      return envelopes.filter((item) => item.fromDid === did || item.toDid === did);
    },
    saveEnvelope: async (record) => {
      if (envelopes.some((item) => item.id === record.id)) throw new Error('DUPLICATE_MESSAGE');
      envelopes.push(record);
    },
    saveIdentity: async (record) => {
      identities.push(record);
    },
  };
}
