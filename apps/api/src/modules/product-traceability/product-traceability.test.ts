import { CompanyRole, encodeProductQrPayload } from '@tracechain/shared';
import type { AuthService } from '../auth/auth.service.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductTraceabilityGateway } from './product-traceability.gateway.js';
import { ProductTraceabilityService } from './product-traceability.service.js';

const PRODUCT = `0x${'11'.repeat(32)}` as `0x${string}`;
const INGREDIENT = `0x${'22'.repeat(32)}`;
const CREDENTIAL = `0x${'33'.repeat(32)}`;
const REGISTRY = '0x1000000000000000000000000000000000000001';
const MANUFACTURER = '0x3000000000000000000000000000000000000003';
const DISTRIBUTOR = '0x4000000000000000000000000000000000000004';
const RETAILER = '0x5000000000000000000000000000000000000005';
const SUPPLIER = '0x2000000000000000000000000000000000000002';
const NOW = new Date('2026-11-07T00:00:00.000Z');

describe('product traceability service', () => {
  let gateway: ProductTraceabilityGateway;
  let service: ProductTraceabilityService;
  let authenticated = false;
  let ingredientReference: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    authenticated = false;
    ingredientReference = vi.fn().mockResolvedValue('COCOA-2026-001');
    gateway = {
      getProduct: vi.fn().mockResolvedValue({
        expiresAt: 1_900_000_000,
        manufacturer: MANUFACTURER,
        producedAt: 1_790_000_000,
        status: 1,
      }),
      getIngredientLinks: vi.fn().mockResolvedValue([INGREDIENT]),
      getIngredient: vi.fn().mockResolvedValue({
        credentialId: CREDENTIAL,
        expiresAt: 1_900_000_000,
        status: 1,
        supplier: SUPPLIER,
      }),
      getCredential: vi.fn().mockResolvedValue({
        credentialType: 2,
        expiresAt: 1_900_000_000,
        issuer: SUPPLIER,
        status: 1,
        subject: SUPPLIER,
      }),
      listTransfers: vi.fn().mockResolvedValue([
        {
          dispatchedAt: 1_790_100_000,
          dispatchTransactionHash: `0x${'aa'.repeat(32)}`,
          productBatchId: PRODUCT,
          quantity: '40',
          receivedAt: 1_790_200_000,
          receiptTransactionHash: `0x${'ab'.repeat(32)}`,
          recipient: DISTRIBUTOR,
          sender: MANUFACTURER,
          status: 2,
          transferId: `0x${'44'.repeat(32)}`,
        },
        {
          dispatchedAt: 1_790_300_000,
          dispatchTransactionHash: `0x${'ba'.repeat(32)}`,
          productBatchId: PRODUCT,
          quantity: '40',
          receivedAt: 1_790_400_000,
          receiptTransactionHash: `0x${'bb'.repeat(32)}`,
          recipient: RETAILER,
          sender: DISTRIBUTOR,
          status: 2,
          transferId: `0x${'55'.repeat(32)}`,
        },
      ]),
    };
    service = new ProductTraceabilityService({
      authService: {
        getSession: vi.fn().mockImplementation(async () =>
          authenticated
            ? {
                address: RETAILER,
                authenticated: true,
                authorizationReady: true,
                authorizationStatus: 'AUTHORIZED',
                credentialVerified: false,
                expiresAt: '2027-01-01T00:00:00.000Z',
                locallyVerified: false,
                message: 'Authorized',
                onChainStatusChecked: true,
                role: CompanyRole.RETAILER,
              }
            : { authenticated: false },
        ),
      } as unknown as AuthService,
      clock: () => NOW,
      configuration: () => ({
        chainId: 31_337,
        productRegistryAddress: REGISTRY,
        publicAppUrl: 'https://tracechain.example',
      }),
      gateway,
      metadata: {
        ingredientReference,
        product: vi.fn().mockResolvedValue({
          name: 'Dark Chocolate Bar',
          reference: 'CHOCOLATE-2026-050',
        }),
      },
      stakeholderDirectory: directory(),
    });
  });

  it('resolves a public product, ingredients, names, chronology, and current custodian safely', async () => {
    const result = await service.resolve(undefined, { qrPayload: qr() });
    expect(result).toMatchObject({
      accessLevel: 'PUBLIC',
      currentCustodianName: 'FreshMart Retail Sdn. Bhd.',
      product: {
        manufacturerName: 'CocoaCraft Manufacturing Sdn. Bhd.',
        name: 'Dark Chocolate Bar',
        reference: 'CHOCOLATE-2026-050',
        status: 'ACTIVE',
      },
      credentialSummary: { active: 1, total: 1, verified: true },
      ingredients: [
        {
          supplierName: 'ABC Ingredients Sdn. Bhd.',
          verified: true,
        },
      ],
    });
    expect(result.timeline.map((event) => event.type)).toEqual([
      'PRODUCT_CREATED',
      'TRANSFER_DISPATCHED',
      'TRANSFER_RECEIVED',
      'TRANSFER_DISPATCHED',
      'TRANSFER_RECEIVED',
    ]);
    expect(result).not.toHaveProperty('technical');
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
    expect(result.ingredients[0]?.reference).toMatch(/^Ingredient 0x/);
    expect(ingredientReference).not.toHaveBeenCalled();
  });

  it('returns additional technical details only to an authorized stakeholder', async () => {
    authenticated = true;
    const result = await service.resolve('session', { qrPayload: qr() });
    expect(result.accessLevel).toBe('AUTHORIZED');
    expect(result.technical).toMatchObject({
      batchId: PRODUCT,
      currentCustodianWallet: RETAILER,
      manufacturerWallet: MANUFACTURER,
    });
    expect(result.ingredients[0]).toHaveProperty('technical.credentialId', CREDENTIAL);
    expect(result.ingredients[0]).toHaveProperty('reference', 'COCOA-2026-001');
    expect(ingredientReference).toHaveBeenCalledOnce();
  });

  it.each([
    ['QR_CHAIN_MISMATCH', { chainId: 1, productRegistryAddress: REGISTRY }],
    [
      'QR_REGISTRY_MISMATCH',
      { chainId: 31_337, productRegistryAddress: '0x9000000000000000000000000000000000000009' },
    ],
  ])('rejects wrong configured references with %s', async (code, override) => {
    await expect(service.resolve(undefined, { qrPayload: qr(override) })).rejects.toMatchObject({
      code,
      status: 400,
    });
  });

  it('rejects an unknown product', async () => {
    vi.mocked(gateway.getProduct).mockResolvedValue(null);
    await expect(service.resolve(undefined, { qrPayload: qr() })).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      status: 404,
    });
  });

  it.each([
    [2, 1_900_000_000, 'SUSPENDED'],
    [3, 1_900_000_000, 'RECALLED'],
    [1, 1_700_000_000, 'EXPIRED'],
  ])('reports non-active product lifecycle states', async (status, expiresAt, expected) => {
    vi.mocked(gateway.getProduct).mockResolvedValue({
      expiresAt,
      manufacturer: MANUFACTURER,
      producedAt: 1_690_000_000,
      status,
    });
    await expect(service.resolve(undefined, { qrPayload: qr() })).resolves.toHaveProperty(
      'product.status',
      expected,
    );
  });

  it('is read-only and exposes no transaction preparation capability', async () => {
    await service.resolve(undefined, { qrPayload: qr() });
    expect(Object.keys(gateway).every((key) => !/confirm|prepare|write/i.test(key))).toBe(true);
  });
});

function qr(override: Partial<{ chainId: number; productRegistryAddress: string }> = {}) {
  return encodeProductQrPayload({
    batchId: PRODUCT,
    chainId: override.chainId ?? 31_337,
    productRegistryAddress: override.productRegistryAddress ?? REGISTRY,
    publicAppUrl: 'https://tracechain.example',
    version: 1,
  });
}

function directory() {
  const records = new Map([
    [SUPPLIER.toLowerCase(), ['ABC Ingredients Sdn. Bhd.', CompanyRole.SUPPLIER]],
    [MANUFACTURER.toLowerCase(), ['CocoaCraft Manufacturing Sdn. Bhd.', CompanyRole.MANUFACTURER]],
    [DISTRIBUTOR.toLowerCase(), ['Swift Distribution Sdn. Bhd.', CompanyRole.DISTRIBUTOR]],
    [RETAILER.toLowerCase(), ['FreshMart Retail Sdn. Bhd.', CompanyRole.RETAILER]],
  ] as const);
  return {
    list: vi.fn(),
    resolve: vi.fn(),
    resolveMany: vi.fn().mockImplementation(async (wallets: string[]) =>
      [...new Set(wallets.map((wallet) => wallet.toLowerCase()))].flatMap((wallet) => {
        const record = records.get(wallet);
        return record
          ? [
              {
                active: true as const,
                companyName: record[0],
                role: record[1],
                walletAddress: wallets.find((candidate) => candidate.toLowerCase() === wallet)!,
              },
            ]
          : [];
      }),
    ),
  } as unknown as StakeholderDirectory;
}
