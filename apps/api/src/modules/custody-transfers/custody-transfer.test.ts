import { CompanyRole, encodeTransferQrPayload } from '@tracechain/shared';
import { getAddress } from 'ethers';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { InMemoryNonceRepository, InMemorySessionRepository } from '../auth/auth.repository.js';
import { AuthService } from '../auth/auth.service.js';
import type { CustodyTransferGateway } from './custody-transfer.gateway.js';
import { CustodyTransferService } from './custody-transfer.service.js';
import type { CustodyTransferRecord } from './custody-transfer.types.js';

const CHAIN_ID = 31_337;
const COOKIE_NAME = 'tracechain_session';
const SESSION_ID = 'authorized-session';
const WALLET_ONLY_SESSION_ID = 'wallet-only-session';
const NOW = new Date('2026-11-06T08:00:00.000Z');
const RECIPIENT = getAddress('0x1000000000000000000000000000000000000001');
const OTHER_WALLET = getAddress('0x2000000000000000000000000000000000000002');
const SENDER = getAddress('0x3000000000000000000000000000000000000003');
const CUSTODY_TRANSFER_ADDRESS = getAddress('0x4000000000000000000000000000000000000004');
const OTHER_CONTRACT_ADDRESS = getAddress('0x5000000000000000000000000000000000000005');
const TRANSFER_ID = `0x${'11'.repeat(32)}` as const;
const PRODUCT_BATCH_ID = `0x${'22'.repeat(32)}`;

const awaitingTransfer: CustodyTransferRecord = {
  dispatchedAt: 1_762_416_000n,
  expectedAt: 1_762_502_400n,
  productBatchId: PRODUCT_BATCH_ID,
  quantity: 250n,
  recipient: RECIPIENT,
  sender: SENDER,
  status: 1,
};

describe('custody-transfer QR resolution API', () => {
  let app: ReturnType<typeof createApp>;
  let confirmReceipt: ReturnType<typeof vi.fn>;
  let getTransfer: ReturnType<typeof vi.fn<CustodyTransferGateway['getTransfer']>>;
  let sessionRepository: InMemorySessionRepository;

  beforeEach(async () => {
    sessionRepository = new InMemorySessionRepository();
    const authService = new AuthService({
      clock: () => new Date(NOW),
      configuration: {
        chainId: CHAIN_ID,
        domain: 'localhost:5173',
        nonceTtlMs: 300_000,
        sessionTtlMs: 28_800_000,
        uri: 'http://localhost:5173',
      },
      nonceRepository: new InMemoryNonceRepository(),
      sessionRepository,
    });

    await sessionRepository.save({
      address: RECIPIENT,
      createdAt: NOW,
      credentialVerification: {
        authorizationReady: true,
        credentialHash: `0x${'33'.repeat(32)}`,
        credentialId: `0x${'44'.repeat(32)}`,
        issuerDid: 'did:ethr:11155111:0x6000000000000000000000000000000000000006',
        locallyVerified: true,
        onChainStatusChecked: true,
        role: CompanyRole.DISTRIBUTOR,
        subjectDid: `did:ethr:${CHAIN_ID}:${RECIPIENT}`,
        verifiedAt: NOW,
      },
      expiresAt: new Date(NOW.getTime() + 28_800_000),
      id: SESSION_ID,
    });
    await sessionRepository.save({
      address: RECIPIENT,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 28_800_000),
      id: WALLET_ONLY_SESSION_ID,
    });

    getTransfer = vi.fn().mockResolvedValue(awaitingTransfer);
    confirmReceipt = vi.fn();
    const gateway: CustodyTransferGateway & { confirmReceipt: typeof confirmReceipt } = {
      confirmReceipt,
      getTransfer,
    };
    const service = new CustodyTransferService({
      authService,
      configuration: () => ({
        chainId: CHAIN_ID,
        contractAddress: CUSTODY_TRANSFER_ADDRESS,
      }),
      gateway,
    });

    app = createApp({ authService, custodyTransferService: service });
  });

  function qrPayload(
    overrides: { chainId?: number; contractAddress?: string; transferId?: `0x${string}` } = {},
  ) {
    return encodeTransferQrPayload({
      chainId: overrides.chainId ?? CHAIN_ID,
      custodyTransferAddress: overrides.contractAddress ?? CUSTODY_TRANSFER_ADDRESS,
      transferId: overrides.transferId ?? TRANSFER_ID,
      version: 1,
    });
  }

  function resolve(payload = qrPayload(), sessionId = SESSION_ID) {
    return request(app)
      .post('/api/custody-transfers/resolve-qr')
      .set('Cookie', `${COOKIE_NAME}=${sessionId}`)
      .send({ qrPayload: payload });
  }

  it('rejects an unauthenticated request before resolving the QR', async () => {
    const response = await request(app)
      .post('/api/custody-transfers/resolve-qr')
      .send({ qrPayload: qrPayload() })
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(getTransfer).not.toHaveBeenCalled();
  });

  it('keeps existing credential and on-chain authorization rules enforced', async () => {
    const response = await resolve(qrPayload(), WALLET_ONLY_SESSION_ID).expect(403);

    expect(response.body.error.code).toBe('CREDENTIAL_AUTHORIZATION_REQUIRED');
    expect(getTransfer).not.toHaveBeenCalled();
  });

  it('rejects a malformed QR payload', async () => {
    const response = await resolve('tracechain://transfer/v1?invalid=true').expect(400);

    expect(response.body.error.code).toBe('INVALID_TRANSFER_QR');
    expect(getTransfer).not.toHaveBeenCalled();
  });

  it('rejects a QR for the wrong chain', async () => {
    const response = await resolve(qrPayload({ chainId: 11_155_111 })).expect(400);

    expect(response.body.error.code).toBe('QR_CHAIN_MISMATCH');
    expect(getTransfer).not.toHaveBeenCalled();
  });

  it('rejects a QR for a different CustodyTransfer deployment', async () => {
    const response = await resolve(qrPayload({ contractAddress: OTHER_CONTRACT_ADDRESS })).expect(
      400,
    );

    expect(response.body.error.code).toBe('QR_CONTRACT_MISMATCH');
    expect(getTransfer).not.toHaveBeenCalled();
  });

  it('returns 404 when the transfer does not exist', async () => {
    getTransfer.mockResolvedValueOnce(null);

    const response = await resolve().expect(404);

    expect(response.body.error.code).toBe('TRANSFER_NOT_FOUND');
  });

  it('returns 409 when the transfer is not awaiting receipt', async () => {
    getTransfer.mockResolvedValueOnce({ ...awaitingTransfer, status: 2 });

    const response = await resolve().expect(409);

    expect(response.body.error.code).toBe('TRANSFER_NOT_AWAITING_RECEIPT');
  });

  it('rejects a wallet that is not the on-chain recipient', async () => {
    getTransfer.mockResolvedValueOnce({ ...awaitingTransfer, recipient: OTHER_WALLET });

    const response = await resolve().expect(403);

    expect(response.body.error.code).toBe('INTENDED_RECIPIENT_REQUIRED');
  });

  it('returns only the safe transfer summary after every check succeeds', async () => {
    const response = await resolve().expect(200);

    expect(response.body).toEqual({
      dispatchedAt: Number(awaitingTransfer.dispatchedAt),
      expectedAt: Number(awaitingTransfer.expectedAt),
      productBatchId: PRODUCT_BATCH_ID,
      quantity: '250',
      recipient: RECIPIENT,
      sender: SENDER,
      status: 1,
      transferId: TRANSFER_ID,
    });
    expect(getTransfer).toHaveBeenCalledOnce();
    expect(getTransfer).toHaveBeenCalledWith(TRANSFER_ID);
  });

  it('never prepares or sends a receipt-confirmation transaction', async () => {
    await resolve().expect(200);

    expect(confirmReceipt).not.toHaveBeenCalled();
  });

  it('returns a safe gateway error without exposing RPC details', async () => {
    getTransfer.mockRejectedValueOnce(new Error('rpc https://secret-provider.example failed'));

    const response = await resolve().expect(502);

    expect(response.body).toEqual({
      error: {
        code: 'TRANSFER_LOOKUP_UNAVAILABLE',
        message: 'The custody transfer could not be retrieved.',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('secret-provider');
  });
});
