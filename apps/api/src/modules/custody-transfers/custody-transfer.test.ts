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
import { InMemoryReceiptWorkflowRepository } from './custody-transfer.repository.js';
import type { CustodyTransferRecord } from './custody-transfer.types.js';

const CHAIN_ID = 31_337;
const COOKIE_NAME = 'tracechain_session';
const SESSION_ID = 'authorized-session';
const WALLET_ONLY_SESSION_ID = 'wallet-only-session';
const INACTIVE_SESSION_ID = 'inactive-session';
const ADMIN_SESSION_ID = 'admin-session';
const NOW = new Date('2026-11-06T08:00:00.000Z');
const RECIPIENT = getAddress('0x1000000000000000000000000000000000000001');
const OTHER_WALLET = getAddress('0x2000000000000000000000000000000000000002');
const SENDER = getAddress('0x3000000000000000000000000000000000000003');
const ADMIN = getAddress('0x6000000000000000000000000000000000000006');
const CUSTODY_TRANSFER_ADDRESS = getAddress('0x4000000000000000000000000000000000000004');
const OTHER_CONTRACT_ADDRESS = getAddress('0x5000000000000000000000000000000000000005');
const TRANSFER_ID = `0x${'11'.repeat(32)}` as const;
const PRODUCT_BATCH_ID = `0x${'22'.repeat(32)}`;

const awaitingTransfer: CustodyTransferRecord = {
  damaged: 0n,
  dispatchedAt: 1_762_416_000n,
  expectedAt: 1_762_502_400n,
  productBatchId: PRODUCT_BATCH_ID,
  quantity: 250n,
  recipient: RECIPIENT,
  rejected: 0n,
  sender: SENDER,
  status: 1,
  usable: 0n,
};

describe('custody-transfer QR resolution API', () => {
  let app: ReturnType<typeof createApp>;
  let getTransfer: ReturnType<typeof vi.fn<CustodyTransferGateway['getTransfer']>>;
  let prepareReceiptConfirmation: ReturnType<
    typeof vi.fn<CustodyTransferGateway['prepareReceiptConfirmation']>
  >;
  let prepareDiscrepancyReport: ReturnType<
    typeof vi.fn<CustodyTransferGateway['prepareDiscrepancyReport']>
  >;
  let prepareDiscrepancyResolution: ReturnType<
    typeof vi.fn<CustodyTransferGateway['prepareDiscrepancyResolution']>
  >;
  let prepareRejection: ReturnType<typeof vi.fn<CustodyTransferGateway['prepareRejection']>>;
  let getDiscrepancy: ReturnType<typeof vi.fn<CustodyTransferGateway['getDiscrepancy']>>;
  let listDiscrepancies: ReturnType<typeof vi.fn<CustodyTransferGateway['listDiscrepancies']>>;
  let encryptAndStore: ReturnType<typeof vi.fn>;
  let decrypt: ReturnType<typeof vi.fn>;
  let sessionRepository: InMemorySessionRepository;
  let receiptRepository: InMemoryReceiptWorkflowRepository;

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
    await sessionRepository.save({
      address: RECIPIENT,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 28_800_000),
      id: INACTIVE_SESSION_ID,
      onChainAuthorization: {
        checkedAt: NOW,
        role: CompanyRole.DISTRIBUTOR,
        status: 'REVOKED',
      },
    });
    await sessionRepository.save({
      address: ADMIN,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 28_800_000),
      id: ADMIN_SESSION_ID,
      onChainAuthorization: {
        checkedAt: NOW,
        role: CompanyRole.SYSTEM_ADMIN,
        status: 'AUTHORIZED',
      },
    });

    getTransfer = vi.fn().mockResolvedValue(awaitingTransfer);
    prepareReceiptConfirmation = vi.fn().mockReturnValue({
      chainId: CHAIN_ID,
      data: '0x1234',
      to: CUSTODY_TRANSFER_ADDRESS,
      value: '0x0',
    });
    prepareDiscrepancyReport = vi.fn().mockReturnValue({
      chainId: CHAIN_ID,
      data: '0x5678',
      to: CUSTODY_TRANSFER_ADDRESS,
      value: '0x0',
    });
    prepareDiscrepancyResolution = vi.fn().mockReturnValue({
      chainId: CHAIN_ID,
      data: '0x9876',
      to: CUSTODY_TRANSFER_ADDRESS,
      value: '0x0',
    });
    prepareRejection = vi.fn().mockReturnValue({
      chainId: CHAIN_ID,
      data: '0xabcd',
      to: CUSTODY_TRANSFER_ADDRESS,
      value: '0x0',
    });
    getDiscrepancy = vi.fn().mockResolvedValue(null);
    listDiscrepancies = vi.fn().mockResolvedValue([]);
    decrypt = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ evidence: [], notes: 'Counted at receiving bay.' }));
    encryptAndStore = vi.fn().mockResolvedValue({
      cid: 'bafy-encrypted-receipt',
      payload: {
        algorithm: 'aes-256-gcm',
        authTag: 'tag',
        ciphertext: 'ciphertext',
        iv: 'iv',
        version: 1,
      },
    });
    const gateway: CustodyTransferGateway = {
      getDiscrepancy,
      getTransfer,
      listDiscrepancies,
      prepareDiscrepancyReport,
      prepareDiscrepancyResolution,
      prepareReceiptConfirmation,
      prepareRejection,
    };
    receiptRepository = new InMemoryReceiptWorkflowRepository();
    const service = new CustodyTransferService({
      authService,
      configuration: () => ({
        chainId: CHAIN_ID,
        contractAddress: CUSTODY_TRANSFER_ADDRESS,
      }),
      gateway,
      contentStore: {
        decrypt,
        encryptAndStore,
      },
      productMetadata: {
        product: vi.fn().mockResolvedValue({
          name: 'Dark Chocolate Bar',
          reference: 'CHOCOLATE-2026-050',
        }),
      },
      receiptRepository,
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
      .send({
        actualQuantity: '250',
        damagedQuantity: '0',
        evidence: [],
        notes: '',
        rejectedQuantity: '0',
        transferId: TRANSFER_ID,
      });
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

  it('rejects a recipient whose on-chain credential authorization is revoked', async () => {
    const response = await prepare(INACTIVE_SESSION_ID).expect(403);

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
      damaged: '0',
      expectedAt: Number(awaitingTransfer.expectedAt),
      productBatchId: PRODUCT_BATCH_ID,
      productName: 'Dark Chocolate Bar',
      productReference: 'CHOCOLATE-2026-050',
      quantity: '250',
      recipient: RECIPIENT,
      rejected: '0',
      sender: SENDER,
      status: 1,
      transferId: TRANSFER_ID,
      usable: '0',
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

    expect(response.body).toMatchObject({
      action: 'CONFIRM_RECEIPT',
      usableQuantity: '250',
      transaction: { chainId: CHAIN_ID, data: '0x1234', to: CUSTODY_TRANSFER_ADDRESS },
    });
    expect(prepareReceiptConfirmation).toHaveBeenCalledOnce();
    expect(prepareReceiptConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: CHAIN_ID,
        contractAddress: CUSTODY_TRANSFER_ADDRESS,
        damaged: 0n,
        quantity: awaitingTransfer.quantity,
        receiptCid: 'bafy-encrypted-receipt',
        rejected: 0n,
        transferId: TRANSFER_ID,
      }),
    );
  });

  it('encodes the exact confirmReceipt transaction parameters', () => {
    const gateway = new EthersCustodyTransferGateway(
      CHAIN_ID,
      'http://127.0.0.1:8545',
      CUSTODY_TRANSFER_ADDRESS,
    );
    const receiptHash = `0x${'55'.repeat(32)}`;
    const prepared = gateway.prepareReceiptConfirmation({
      chainId: CHAIN_ID,
      contractAddress: CUSTODY_TRANSFER_ADDRESS,
      damaged: 5n,
      quantity: awaitingTransfer.quantity,
      receiptCid: 'bafy-receipt',
      receiptHash,
      rejected: 3n,
      transferId: TRANSFER_ID,
    });
    const contractInterface = new Interface([
      'function confirmReceipt(bytes32,uint256,uint256,uint256,bytes32,string)',
    ]);
    const decoded = contractInterface.decodeFunctionData('confirmReceipt', prepared.data);

    expect([...decoded]).toEqual([TRANSFER_ID, 250n, 5n, 3n, receiptHash, 'bafy-receipt']);
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

  it('prepares damaged and rejected receipt quantities with system-calculated usable inventory', async () => {
    const response = await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '250',
        damagedQuantity: '10',
        evidence: [],
        notes: 'Ten cartons crushed',
        rejectedQuantity: '5',
        transferId: TRANSFER_ID,
      })
      .expect(200);

    expect(response.body.usableQuantity).toBe('235');
    expect(prepareReceiptConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ damaged: 10n, quantity: 250n, rejected: 5n }),
    );
    expect(encryptAndStore).toHaveBeenCalledOnce();
    expect(encryptAndStore.mock.calls[0]?.[0]).toContain('Ten cartons crushed');
    expect(encryptAndStore.mock.calls[0]?.[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const persisted = await receiptRepository.list();
    expect(persisted[0]?.payload).toEqual(
      expect.objectContaining({ algorithm: 'aes-256-gcm', ciphertext: 'ciphertext' }),
    );
    expect(JSON.stringify(persisted)).not.toContain('Ten cartons crushed');
  });

  it('rejects negative or overlapping quantities', async () => {
    const negative = await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '-1',
        damagedQuantity: '0',
        evidence: [],
        notes: '',
        rejectedQuantity: '0',
        transferId: TRANSFER_ID,
      })
      .expect(400);
    expect(negative.body.error.code).toBe('INVALID_RECEIPT');

    const unsafe = await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '9007199254740992',
        damagedQuantity: '0',
        evidence: [],
        notes: '',
        rejectedQuantity: '0',
        transferId: TRANSFER_ID,
      })
      .expect(400);
    expect(unsafe.body.error.code).toBe('INVALID_RECEIPT');

    const overlapping = await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '10',
        damagedQuantity: '8',
        evidence: [],
        notes: 'Checked',
        rejectedQuantity: '3',
        transferId: TRANSFER_ID,
      })
      .expect(400);
    expect(overlapping.body.error.code).toBe('INVALID_RECEIPT_QUANTITIES');
    expect(prepareReceiptConfirmation).not.toHaveBeenCalled();
  });

  it.each([
    ['200', 'SHORTAGE', 1],
    ['300', 'EXCESS', 2],
  ])(
    'reports an encrypted %s quantity mismatch instead of confirming receipt',
    async (actualQuantity, discrepancyType, kind) => {
      const response = await request(app)
        .post('/api/custody-transfers/transactions/confirm-receipt')
        .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
        .send({
          actualQuantity,
          damagedQuantity: '0',
          evidence: [],
          notes: 'Count differs from dispatch',
          rejectedQuantity: '0',
          transferId: TRANSFER_ID,
        })
        .expect(200);
      expect(response.body).toMatchObject({ action: 'REPORT_DISCREPANCY', discrepancyType });
      expect(prepareDiscrepancyReport).toHaveBeenCalledWith(
        expect.objectContaining({ actualQuantity: BigInt(actualQuantity), kind }),
      );
      expect(prepareReceiptConfirmation).not.toHaveBeenCalled();
    },
  );

  it('does not prepare a transaction when encrypted evidence storage fails', async () => {
    encryptAndStore.mockRejectedValueOnce(new Error('pinning unavailable'));
    const response = await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '250',
        damagedQuantity: '0',
        evidence: [{ dataBase64: 'aW1hZ2U=', mediaType: 'image/png' }],
        notes: '',
        rejectedQuantity: '0',
        transferId: TRANSFER_ID,
      })
      .expect(503);
    expect(response.body.error.code).toBe('RECEIPT_STORAGE_UNAVAILABLE');
    expect(prepareReceiptConfirmation).not.toHaveBeenCalled();
  });

  it('encodes the exact reportDiscrepancy transaction parameters', () => {
    const gateway = new EthersCustodyTransferGateway(
      CHAIN_ID,
      'http://127.0.0.1:8545',
      CUSTODY_TRANSFER_ADDRESS,
    );
    const detailsHash = `0x${'66'.repeat(32)}`;
    const prepared = gateway.prepareDiscrepancyReport({
      actualQuantity: 200n,
      chainId: CHAIN_ID,
      contractAddress: CUSTODY_TRANSFER_ADDRESS,
      detailsHash,
      evidenceCid: 'bafy-encrypted-discrepancy',
      kind: 1,
      transferId: TRANSFER_ID,
    });
    const contractInterface = new Interface([
      'function reportDiscrepancy(bytes32,uint8,uint256,bytes32,string)',
    ]);

    expect([...contractInterface.decodeFunctionData('reportDiscrepancy', prepared.data)]).toEqual([
      TRANSFER_ID,
      1n,
      200n,
      detailsHash,
      'bafy-encrypted-discrepancy',
    ]);
  });

  it('makes identical receipt retries idempotent and rejects conflicting details', async () => {
    const [first, second] = await Promise.all([prepare(), prepare()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(encryptAndStore).toHaveBeenCalledOnce();

    const conflict = await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '250',
        damagedQuantity: '1',
        evidence: [],
        notes: 'Changed after preparation',
        rejectedQuantity: '0',
        transferId: TRANSFER_ID,
      })
      .expect(409);

    expect(conflict.body.error.code).toBe('RECEIPT_WORKFLOW_CONFLICT');
  });

  it('prepares a complete rejection without recording usable inventory', async () => {
    const response = await request(app)
      .post('/api/custody-transfers/transactions/reject')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        evidence: [],
        reason: 'The delivered product does not match the manifest.',
        reasonType: 'WRONG_PRODUCT',
        transferId: TRANSFER_ID,
      })
      .expect(200);

    expect(response.body.action).toBe('REJECT_TRANSFER');
    expect(prepareRejection).toHaveBeenCalledOnce();
    expect(prepareReceiptConfirmation).not.toHaveBeenCalled();
  });

  it('restricts decrypted receipt evidence to transfer participants and System Admin', async () => {
    await prepare().expect(200);

    await request(app)
      .get(`/api/custody-transfers/${TRANSFER_ID}/evidence`)
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .expect(200);
    await request(app)
      .get(`/api/custody-transfers/${TRANSFER_ID}/evidence`)
      .set('Cookie', `${COOKIE_NAME}=${ADMIN_SESSION_ID}`)
      .expect(200);

    await sessionRepository.save({
      address: OTHER_WALLET,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 28_800_000),
      id: 'authorized-outsider',
      onChainAuthorization: {
        checkedAt: NOW,
        role: CompanyRole.RETAILER,
        status: 'AUTHORIZED',
      },
    });
    const outsider = await request(app)
      .get(`/api/custody-transfers/${TRANSFER_ID}/evidence`)
      .set('Cookie', `${COOKIE_NAME}=authorized-outsider`)
      .expect(403);

    expect(outsider.body.error.code).toBe('TRANSFER_PARTICIPANT_REQUIRED');
  });

  it('lists real discrepancy records only for an authorized System Admin', async () => {
    await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '200',
        damagedQuantity: '0',
        evidence: [],
        notes: 'Counted at receiving bay.',
        rejectedQuantity: '0',
        transferId: TRANSFER_ID,
      })
      .expect(200);
    getTransfer.mockResolvedValue({ ...awaitingTransfer, status: 5 });
    listDiscrepancies.mockResolvedValue([
      {
        actualQuantity: 200n,
        detailsHash: `0x${'77'.repeat(32)}`,
        evidenceCid: 'bafy-encrypted-discrepancy',
        expectedQuantity: 250n,
        kind: 1,
        reportedAt: 1_762_416_500,
        resolved: false,
        transferId: TRANSFER_ID,
      },
    ]);

    await request(app)
      .get('/api/custody-transfers/discrepancies')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .expect(403);
    const response = await request(app)
      .get('/api/custody-transfers/discrepancies')
      .set('Cookie', `${COOKIE_NAME}=${ADMIN_SESSION_ID}`)
      .expect(200);

    expect(response.body.discrepancies[0]).toMatchObject({
      actualQuantity: '200',
      discrepancyType: 'SHORTAGE',
      expectedQuantity: '250',
      privateDetails: { notes: 'Counted at receiving bay.' },
      status: 5,
    });
  });

  it.each([
    [true, 'ACCEPT_ACTUAL'],
    [false, 'CANCEL_TRANSFER'],
  ])('prepares an unsigned administrator resolution (%s)', async (acceptActual, decision) => {
    getTransfer.mockResolvedValue({ ...awaitingTransfer, status: 5 });
    getDiscrepancy.mockResolvedValue({
      actualQuantity: 200n,
      detailsHash: `0x${'77'.repeat(32)}`,
      evidenceCid: 'bafy-encrypted-discrepancy',
      expectedQuantity: 250n,
      kind: 1,
      reportedAt: 1_762_416_500,
      resolved: false,
      transferId: TRANSFER_ID,
    });

    const response = await request(app)
      .post('/api/custody-transfers/transactions/resolve-discrepancy')
      .set('Cookie', `${COOKIE_NAME}=${ADMIN_SESSION_ID}`)
      .send({
        acceptActual,
        reason: 'Verified against warehouse receiving records.',
        transferId: TRANSFER_ID,
      })
      .expect(200);

    expect(response.body).toMatchObject({ actorWallet: ADMIN, decision });
    expect(prepareDiscrepancyResolution).toHaveBeenCalledWith(
      expect.objectContaining({ acceptActual, transferId: TRANSFER_ID }),
    );
  });

  it('allows a separate recipient confirmation after an accepted discrepancy', async () => {
    await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '200',
        damagedQuantity: '0',
        evidence: [],
        notes: 'Shortage confirmed.',
        rejectedQuantity: '0',
        transferId: TRANSFER_ID,
      })
      .expect(200);
    getTransfer.mockResolvedValue({ ...awaitingTransfer, quantity: 200n, status: 1 });

    const response = await request(app)
      .post('/api/custody-transfers/transactions/confirm-receipt')
      .set('Cookie', `${COOKIE_NAME}=${SESSION_ID}`)
      .send({
        actualQuantity: '200',
        damagedQuantity: '5',
        evidence: [],
        notes: 'Adjusted quantity accepted by administrator.',
        rejectedQuantity: '0',
        transferId: TRANSFER_ID,
      })
      .expect(200);

    expect(response.body).toMatchObject({ action: 'CONFIRM_RECEIPT', usableQuantity: '195' });
    expect(encryptAndStore).toHaveBeenCalledTimes(2);
    expect(prepareReceiptConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ damaged: 5n, quantity: 200n, rejected: 0n }),
    );
  });
});
