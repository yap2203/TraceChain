import { CompanyRole, encodeTransferQrPayload } from '@tracechain/shared';
import { Interface, getAddress } from 'ethers';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { InMemoryNonceRepository, InMemorySessionRepository } from '../auth/auth.repository.js';
import { AuthService } from '../auth/auth.service.js';
import {
  EthersCustodyTransferGateway,
  type CustodyTransferGateway,
} from './custody-transfer.gateway.js';
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
  let getTransfer: ReturnType<typeof vi.fn<CustodyTransferGateway['getTransfer']>>;
  let prepareReceiptConfirmation: ReturnType<
    typeof vi.fn<CustodyTransferGateway['prepareReceiptConfirmation']>
  >;
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
      onChainAuthorization: {
        checkedAt: NOW,
        credentialHash: `0x${'33'.repeat(32)}`,
        credentialId: `0x${'44'.repeat(32)}`,
        role: CompanyRole.DISTRIBUTOR,
        status: 'AUTHORIZED',
      },
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
    prepareReceiptConfirmation = vi.fn().mockReturnValue({
      chainId: CHAIN_ID,
      data: '0x1234',
      to: CUSTODY_TRANSFER_ADDRESS,
      value: '0x0',
    });
    const gateway: CustodyTransferGateway = {
      getTransfer,
      prepareReceiptConfirmation,
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

  function prepare(sessionId = SESSION_ID) {
    return request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${sessionId}`)
      .send({ transferId: TRANSFER_ID });
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

    expect(response.body.error.code).toBe('ON_CHAIN_AUTHORIZATION_REQUIRED');
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

    expect(prepareReceiptConfirmation).not.toHaveBeenCalled();
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

  it('requires authentication and authorization before preparing confirmation', async () => {
    await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .send({ transferId: TRANSFER_ID })
      .expect(401);

    const unauthorized = await prepare(WALLET_ONLY_SESSION_ID).expect(403);
    expect(unauthorized.body.error.code).toBe('ON_CHAIN_AUTHORIZATION_REQUIRED');
    expect(getTransfer).not.toHaveBeenCalled();
    expect(prepareReceiptConfirmation).not.toHaveBeenCalled();
  });

  it('rechecks status and intended recipient before preparing confirmation', async () => {
    getTransfer.mockResolvedValueOnce({ ...awaitingTransfer, status: 2 });
    expect((await prepare().expect(409)).body.error.code).toBe('TRANSFER_NOT_AWAITING_RECEIPT');

    getTransfer.mockResolvedValueOnce({ ...awaitingTransfer, recipient: OTHER_WALLET });
    expect((await prepare().expect(403)).body.error.code).toBe('INTENDED_RECIPIENT_REQUIRED');
    expect(prepareReceiptConfirmation).not.toHaveBeenCalled();
  });

  it('returns an unsigned full-quantity receipt transaction without broadcasting it', async () => {
    const response = await prepare().expect(200);

    expect(response.body).toEqual({
      chainId: CHAIN_ID,
      data: '0x1234',
      to: CUSTODY_TRANSFER_ADDRESS,
      value: '0x0',
    });
    expect(prepareReceiptConfirmation).toHaveBeenCalledOnce();
    expect(prepareReceiptConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: CHAIN_ID,
        contractAddress: CUSTODY_TRANSFER_ADDRESS,
        quantity: awaitingTransfer.quantity,
        transferId: TRANSFER_ID,
      }),
    );
  });

  it('encodes confirmReceipt with the transfer quantity and no damage or receipt document', () => {
    const gateway = new EthersCustodyTransferGateway(
      CHAIN_ID,
      'http://127.0.0.1:8545',
      CUSTODY_TRANSFER_ADDRESS,
    );
    const receiptHash = `0x${'55'.repeat(32)}`;
    const prepared = gateway.prepareReceiptConfirmation({
      chainId: CHAIN_ID,
      contractAddress: CUSTODY_TRANSFER_ADDRESS,
      quantity: awaitingTransfer.quantity,
      receiptHash,
      transferId: TRANSFER_ID,
    });
    const contractInterface = new Interface([
      'function confirmReceipt(bytes32,uint256,uint256,uint256,bytes32,string)',
    ]);
    const decoded = contractInterface.decodeFunctionData('confirmReceipt', prepared.data);

    expect([...decoded]).toEqual([TRANSFER_ID, 250n, 0n, 0n, receiptHash, '']);
    expect(prepared).toMatchObject({
      chainId: CHAIN_ID,
      to: CUSTODY_TRANSFER_ADDRESS,
      value: '0x0',
    });
  });

  it('refreshes a recipient transfer after it is confirmed', async () => {
    getTransfer.mockResolvedValueOnce({ ...awaitingTransfer, status: 2 });

    const response = await request(app)
      .get(`/api/custody-transfers/${TRANSFER_ID}`)
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .expect(200);

    expect(response.body.status).toBe(2);
    expect(response.body.transferId).toBe(TRANSFER_ID);
  });
});
