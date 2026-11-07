import { CompanyRole, ProductQrError, decodeProductQrPayload } from '@tracechain/shared';
import { getAddress } from 'ethers';

import type { AuthService } from '../auth/auth.service.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import type { ProductTraceabilityGateway } from './product-traceability.gateway.js';
import type {
  ProductTraceabilityConfiguration,
  TraceabilityMetadataReader,
  TraceabilityTransferRecord,
} from './product-traceability.types.js';

export class ProductTraceabilityApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Dependencies {
  authService: AuthService;
  clock?: () => Date;
  configuration: () => ProductTraceabilityConfiguration;
  gateway: ProductTraceabilityGateway;
  metadata: TraceabilityMetadataReader;
  stakeholderDirectory: StakeholderDirectory;
}

export class ProductTraceabilityService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async resolve(sessionId: string | undefined, body: unknown) {
    if (
      !body ||
      typeof body !== 'object' ||
      typeof (body as { qrPayload?: unknown }).qrPayload !== 'string'
    )
      throw new ProductTraceabilityApiError(
        'INVALID_REQUEST',
        'A product QR URL is required.',
        400,
      );
    const qrPayload = (body as { qrPayload: string }).qrPayload;
    let qr;
    try {
      qr = decodeProductQrPayload(qrPayload);
    } catch (error) {
      if (error instanceof ProductQrError)
        throw new ProductTraceabilityApiError('INVALID_PRODUCT_QR', error.message, 400);
      throw error;
    }
    const configuration = this.dependencies.configuration();
    if (new URL(qrPayload).origin !== new URL(configuration.publicAppUrl).origin)
      throw new ProductTraceabilityApiError(
        'QR_APP_MISMATCH',
        'This QR belongs to a different TraceChain application.',
        400,
      );
    if (qr.chainId !== configuration.chainId)
      throw new ProductTraceabilityApiError(
        'QR_CHAIN_MISMATCH',
        'This product QR is for a different blockchain network.',
        400,
      );
    if (getAddress(qr.productRegistryAddress) !== getAddress(configuration.productRegistryAddress))
      throw new ProductTraceabilityApiError(
        'QR_REGISTRY_MISMATCH',
        'This product QR references a different ProductRegistry deployment.',
        400,
      );

    const authorized = await this.isAuthorized(sessionId);
    try {
      const product = await this.dependencies.gateway.getProduct(qr.batchId);
      if (!product)
        throw new ProductTraceabilityApiError(
          'PRODUCT_NOT_FOUND',
          'The referenced product batch was not found.',
          404,
        );
      const [metadata, ingredientIds, transfers] = await Promise.all([
        this.dependencies.metadata.product(qr.batchId),
        this.dependencies.gateway.getIngredientLinks(qr.batchId),
        this.dependencies.gateway.listTransfers(qr.batchId),
      ]);
      const ingredientRecords = await Promise.all(
        ingredientIds.map(async (batchId) => {
          const batch = await this.dependencies.gateway.getIngredient(batchId);
          if (!batch) return null;
          const [credential, reference] = await Promise.all([
            this.dependencies.gateway.getCredential(batch.credentialId),
            authorized
              ? this.dependencies.metadata.ingredientReference(batchId)
              : Promise.resolve(undefined),
          ]);
          return { batchId, batch, credential, reference };
        }),
      );
      const validIngredients = ingredientRecords.filter((record) => record !== null);
      const wallets = [
        product.manufacturer,
        ...validIngredients.map((record) => record.batch.supplier),
        ...transfers.flatMap((transfer) => [transfer.sender, transfer.recipient]),
      ];
      const identities = await this.dependencies.stakeholderDirectory.resolveMany(wallets);
      const names = new Map(
        identities.map((identity) => [identity.walletAddress.toLowerCase(), identity]),
      );
      const now = Math.floor(this.clock().getTime() / 1_000);
      const ingredients = validIngredients.map(({ batchId, batch, credential, reference }) => {
        const supplier = names.get(batch.supplier.toLowerCase());
        const credentialActive = Boolean(
          credential &&
          credential.status === 1 &&
          credential.expiresAt > now &&
          credential.credentialType === 2 &&
          sameAddress(credential.subject, batch.supplier) &&
          sameAddress(credential.issuer, batch.supplier),
        );
        const verified =
          batch.status === 1 &&
          batch.expiresAt > now &&
          credentialActive &&
          supplier?.role === CompanyRole.SUPPLIER;
        return {
          credentialStatus: credentialStatus(credential?.status, credential?.expiresAt, now),
          reference: reference ?? `Ingredient ${shortIdentifier(batchId)}`,
          status: recordStatus(batch.status, batch.expiresAt, now),
          supplierName: supplier?.companyName ?? 'Verified Supplier record unavailable',
          verified,
          ...(authorized
            ? {
                technical: {
                  batchId,
                  credentialId: batch.credentialId,
                  supplierWallet: batch.supplier,
                },
              }
            : {}),
        };
      });
      const sortedTransfers = [...transfers].sort(
        (left, right) => left.dispatchedAt - right.dispatchedAt,
      );
      const timeline = this.timeline(
        product.manufacturer,
        product.producedAt,
        sortedTransfers,
        names,
      );
      const currentCustodian = determineCurrentCustodian(product.manufacturer, sortedTransfers);
      const currentIdentity = names.get(currentCustodian.toLowerCase());
      const manufacturerIdentity = names.get(product.manufacturer.toLowerCase());
      const state = recordStatus(product.status, product.expiresAt, now);
      return {
        accessLevel: authorized ? ('AUTHORIZED' as const) : ('PUBLIC' as const),
        verificationMessage: 'Blockchain traceability record verified',
        disclaimer:
          'This verifies the recorded blockchain history; it does not by itself prove the physical product is genuine.',
        product: {
          expiresAt: product.expiresAt,
          manufacturerName:
            manufacturerIdentity?.companyName ?? 'Verified Manufacturer record unavailable',
          name: metadata?.name ?? 'Registered product',
          producedAt: product.producedAt,
          reference: metadata?.reference ?? shortIdentifier(qr.batchId),
          status: state,
        },
        ingredients,
        credentialSummary: {
          active: ingredients.filter((ingredient) => ingredient.verified).length,
          total: ingredients.length,
          verified:
            ingredients.length > 0 && ingredients.every((ingredient) => ingredient.verified),
        },
        currentCustodianName:
          currentIdentity?.companyName ?? 'Current custodian record unavailable',
        timeline,
        ...(authorized
          ? {
              technical: {
                batchId: qr.batchId,
                chainId: configuration.chainId,
                currentCustodianWallet: currentCustodian,
                manufacturerWallet: product.manufacturer,
                productRegistryAddress: configuration.productRegistryAddress,
                transfers: sortedTransfers.map((transfer) => ({
                  dispatchTransactionHash: transfer.dispatchTransactionHash,
                  quantity: transfer.quantity,
                  receiptTransactionHash: transfer.receiptTransactionHash,
                  recipientWallet: transfer.recipient,
                  senderWallet: transfer.sender,
                  transferId: transfer.transferId,
                })),
              },
            }
          : {}),
      };
    } catch (error) {
      if (error instanceof ProductTraceabilityApiError) throw error;
      throw new ProductTraceabilityApiError(
        'TRACEABILITY_UNAVAILABLE',
        'The product traceability record is temporarily unavailable.',
        502,
      );
    }
  }

  private timeline(
    manufacturer: string,
    producedAt: number,
    transfers: TraceabilityTransferRecord[],
    identities: Map<string, { companyName: string }>,
  ) {
    const name = (wallet: string, fallback: string) =>
      identities.get(wallet.toLowerCase())?.companyName ?? fallback;
    const events = [
      {
        action: 'Product batch recorded by Manufacturer',
        organizationName: name(manufacturer, 'Verified Manufacturer record unavailable'),
        status: 'RECORDED',
        timestamp: producedAt,
        type: 'PRODUCT_CREATED',
      },
    ];
    for (const transfer of transfers) {
      events.push({
        action: `Dispatched to ${name(transfer.recipient, 'verified recipient')}`,
        organizationName: name(transfer.sender, 'Verified sender record unavailable'),
        status: transferStatus(transfer.status),
        timestamp: transfer.dispatchedAt,
        type: 'TRANSFER_DISPATCHED',
      });
      if (transfer.status === 2) {
        events.push({
          action: 'Custody receipt confirmed',
          organizationName: name(transfer.recipient, 'Verified recipient record unavailable'),
          status: 'RECEIVED',
          timestamp: transfer.receivedAt ?? transfer.dispatchedAt,
          type: 'TRANSFER_RECEIVED',
        });
      }
    }
    return events.sort((left, right) => left.timestamp - right.timestamp);
  }

  private async isAuthorized(sessionId?: string) {
    try {
      const session = await this.dependencies.authService.getSession(sessionId);
      return session.authenticated && session.authorizationReady;
    } catch {
      return false;
    }
  }
}

function determineCurrentCustodian(manufacturer: string, transfers: TraceabilityTransferRecord[]) {
  let wallet = manufacturer;
  for (const transfer of transfers) if (transfer.status === 2) wallet = transfer.recipient;
  return wallet;
}

function recordStatus(status: number, expiresAt: number, now: number) {
  if (status === 2) return 'SUSPENDED';
  if (status === 3) return 'RECALLED';
  if (expiresAt <= now) return 'EXPIRED';
  return status === 1 ? 'ACTIVE' : 'UNKNOWN';
}

function credentialStatus(status: number | undefined, expiresAt: number | undefined, now: number) {
  if (!status) return 'MISSING';
  if (status === 2) return 'SUSPENDED';
  if (status === 3) return 'REVOKED';
  if ((expiresAt ?? 0) <= now) return 'EXPIRED';
  return status === 1 ? 'ACTIVE' : 'UNKNOWN';
}

function transferStatus(status: number) {
  return (
    ['UNKNOWN', 'AWAITING_RECEIPT', 'RECEIVED', 'REJECTED', 'CANCELLED', 'DISCREPANCY'][status] ??
    'UNKNOWN'
  );
}

function shortIdentifier(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function sameAddress(left: string, right: string) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}
