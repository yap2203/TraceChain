import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queryContractEvents: vi.fn() }));
vi.mock('./contract-events.js', () => ({ queryContractEvents: mocks.queryContractEvents }));

import { BlockchainGatewayService } from './blockchain-gateway.service.js';

const actor = '0x1000000000000000000000000000000000000001';
const other = '0x2000000000000000000000000000000000000002';
const address = '0x3000000000000000000000000000000000000003';

function event(args: Record<string, unknown>) {
  return { args };
}

describe('Stakeholder-scoped operational reads', () => {
  beforeEach(() => mocks.queryContractEvents.mockReset());
  it('skips product and product-custody scans for an authenticated Supplier view', async () => {
    const gateway = new BlockchainGatewayService(
      11155111,
      'http://127.0.0.1:1',
      address,
      address,
      address,
      address,
      address,
      address,
    );
    mocks.queryContractEvents.mockResolvedValue([]);
    const result = await gateway.listOperationalData(actor, { role: 'SUPPLIER' });
    expect(mocks.queryContractEvents).toHaveBeenCalledTimes(3);
    expect(result.productBatches).toEqual([]);
    expect(result.transfers).toEqual([]);
  });

  it('filters indexed events before fetching records and skips unrelated chain records', async () => {
    const gateway = new BlockchainGatewayService(
      11_155_111,
      'http://127.0.0.1:1',
      address,
      address,
      address,
      address,
      address,
      address,
    );
    const getBatch = vi.fn(async () => ({
      supplier: actor,
      metadataHash: 'hash',
      encryptedCid: 'cid',
      credentialId: 'credential',
      totalQuantity: 10n,
      availableQuantity: 8n,
      unit: 'kg',
      producedAt: 1,
      expiresAt: 2,
      status: 1,
    }));
    const getProduct = vi.fn(async (batchId: string) => ({
      manufacturer: batchId === 'own-product' ? actor : other,
      metadataHash: 'hash',
      publicCid: 'cid',
      totalQuantity: 5n,
      unit: 'each',
      producedAt: 1,
      expiresAt: 2,
      status: 1,
    }));
    const getTransfer = vi.fn(async (transferId: string) => ({
      productBatchId: transferId === 'incoming' ? 'received-product' : 'foreign-product',
      sender: other,
      recipient: transferId === 'incoming' ? actor : other,
      quantity: 1n,
      shipmentHash: 'hash',
      shipmentCid: 'cid',
      dispatchedAt: 1,
      expectedAt: 2,
      status: 1,
      usable: 1n,
      damaged: 0n,
      rejected: 0n,
    }));
    const getRequest = vi.fn(async (requestId: string) => ({
      requester: requestId === 'requested' ? actor : other,
      supplier: requestId === 'supplied' ? actor : other,
      ingredientBatchId: 'own-ingredient',
      claimsHash: 'hash',
      challengeHash: 'challenge',
      requestCid: 'cid',
      presentationCid: '',
      presentationHash: '',
      status: 1,
      dueAt: 2,
      presentationExpiresAt: 0,
      updatedAt: 1,
    }));
    const ingredients = {
      filters: {
        IngredientBatchRegistered: (...args: unknown[]) => ({ args, kind: 'ingredient' }),
      },
      getBatch,
    };
    const products = {
      filters: { ProductCreated: (...args: unknown[]) => ({ args, kind: 'product' }) },
      getIngredientLinks: vi.fn(async () => []),
      getProduct,
    };
    const custody = {
      filters: { TransferCreated: (...args: unknown[]) => ({ args, kind: 'transfer' }) },
      getInventory: vi.fn(async () => ({ available: 1n, reserved: 0n, damaged: 0n, rejected: 0n })),
      getTransfer,
    };
    const evidence = {
      filters: { EvidenceRequested: (...args: unknown[]) => ({ args, kind: 'evidence' }) },
      getRequest,
    };
    Object.assign(gateway as unknown as Record<string, unknown>, {
      custody,
      evidence,
      ingredients,
      products,
    });
    mocks.queryContractEvents.mockImplementation(async (contract, filter) => {
      const value = filter as { args: unknown[]; kind: string };
      if (contract === ingredients) return [event({ batchId: 'own-ingredient' })];
      if (contract === products) return [event({ batchId: 'own-product' })];
      if (contract === custody)
        return [
          event({
            productBatchId: 'received-product',
            recipient: actor,
            sender: other,
            transferId: 'incoming',
          }),
          event({
            productBatchId: 'foreign-product',
            recipient: other,
            sender: other,
            transferId: 'foreign',
          }),
        ];
      return value?.args?.[1] || mocks.queryContractEvents.mock.calls.length === 4
        ? [event({ requestId: 'requested' })]
        : [event({ requestId: 'supplied' })];
    });

    const result = await gateway.listOperationalData(actor);

    expect(result.ingredientBatches.map((record) => record.batchId)).toEqual(['own-ingredient']);
    expect(result.productBatches.map((record) => record.batchId)).toEqual([
      'own-product',
      'received-product',
    ]);
    expect(result.transfers.map((record) => record.transferId)).toEqual(['incoming']);
    expect(result.evidenceRequests.map((record) => record.requestId)).toEqual([
      'requested',
      'supplied',
    ]);
    expect(getBatch).toHaveBeenCalledTimes(1);
    expect(getProduct).toHaveBeenCalledTimes(2);
    expect(getTransfer).toHaveBeenCalledTimes(1);
    expect(getRequest).toHaveBeenCalledTimes(2);
    expect(getTransfer).not.toHaveBeenCalledWith('foreign');
    expect(ingredients.filters.IngredientBatchRegistered(actor)).toEqual({
      args: [actor],
      kind: 'ingredient',
    });
    expect(mocks.queryContractEvents.mock.calls[0][1].args).toEqual([null, actor]);
    expect(mocks.queryContractEvents.mock.calls[1][1].args).toEqual([null, actor]);
  });
});
