import { createHash } from 'node:crypto';
import {
  decodeBytes32String,
  encodeBytes32String,
  getAddress,
  id,
  solidityPackedKeccak256,
  ZeroAddress,
  ZeroHash,
} from 'ethers';
import type { IngredientBatchWorkflowRepository } from '../ingredient-batches/ingredient-batch.repository.js';
import {
  CompanyRole,
  encodeIngredientDeliveryQr,
  decodeIngredientDeliveryQr,
  decodeShipmentQr,
  encodeShipmentQr,
} from '@tracechain/shared';
import { assertAuthorizationAvailable, type AuthService } from '../auth/auth.service.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type { OrdersGateway, ChainRecord } from './orders.gateway.js';
import type { OrderAction } from './orders.schema.js';
import { supplierStock } from './supplier-stock.js';
import { readLogistics } from './logistics-state.js';
import { readBusinessTraceability } from './business-traceability.js';
import { readProductInventorySnapshot } from './product-inventory.js';
import { OrderSummaryReader, type OrderListQuery } from './order-summaries.js';
import { DisplaySnapshots } from './display-snapshots.js';
import { CustodyOffers, type CustodyOffer } from './custody-offers.js';
import type { ApplicationMetadataRepository } from '../blockchain/application-metadata.repository.js';
import type { LogisticsAction } from './logistics.schema.js';
import type { ProductionFlowService } from '../production-flow/production-flow.service.js';
import type { EvidenceRequestInput } from '../production-flow/production-flow.schema.js';
import type { DidCommService } from '../didcomm/didcomm.service.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import {
  CatalogueImageError,
  decodeStoredCatalogueImage,
  extensionFor,
  validateCatalogueImage,
  type CatalogueImageInput,
  type StoredCatalogueImage,
} from './catalogue-media.js';

export class OrdersError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

export interface ApplicationLogoSource {
  read(
    applicationId: string,
    applicantWallet: string,
  ): Promise<
    | {
        bytes: Buffer;
        contentHash: string;
        fileName: string;
        mimeType: string;
      }
    | undefined
  >;
}
const same = (a: string, b: string) => a?.toLowerCase() === b?.toLowerCase();
export class OrdersService {
  private summaryReader?: OrderSummaryReader;
  private displaySnapshots = new DisplaySnapshots<ChainRecord & { shipments: ChainRecord[] }>();
  async listOrders(sessionId: string | undefined, query: OrderListQuery) {
    const session = await this.session(sessionId);
    if (!session.role)
      throw new OrdersError(
        'AUTHORIZATION_REQUIRED',
        'Sign in with an authorized company role.',
        403,
      );
    this.summaryReader ??= new OrderSummaryReader(this.gateway, this.directory, async (row) => {
      const requested = await this.optionalRead('orders', 'requestedBatch', [row.orderId]);
      const batchId =
        requested && !same(requested, ZeroHash)
          ? requested
          : row.proposedBatch && !same(row.proposedBatch, ZeroHash)
            ? row.proposedBatch
            : row.item.batches?.[0];
      if (!batchId || same(batchId, ZeroHash)) return;
      const kind = Number(row.item.kind);
      const summary = await this.discoverBatch(
        kind,
        batchId,
        await this.catalogueBatch(kind, batchId),
      );
      return {
        ...(summary.name && !summary.name.endsWith('name unavailable')
          ? { name: summary.name }
          : {}),
        batchReference: summary.batchReference,
      };
    });
    return this.summaryReader.list(session.address, session.role, query);
  }
  private custodyOfferService?: CustodyOffers;
  private offers() {
    return (this.custodyOfferService ??= new CustodyOffers({
      gateway: this.gateway,
      repository: this.repository,
      store: this.store,
      session: async (sessionId) => {
        const session = await this.session(sessionId);
        return { address: session.address, role: session.role };
      },
      prepare: (sessionId, input, signal) => this.prepareLogistics(sessionId, input, signal),
      proofCheck: async (_sessionId, offer) => {
        const requestId = id(
          `ingredient-delivery-identity:${offer.offerId.toLowerCase()}:${offer.distributor.toLowerCase()}`,
        );
        const workflow = await this.repository.findEvidence(requestId);
        if (!workflow?.identityProof) return;
        if (!this.flow)
          throw new OrdersError(
            'IDENTITY_UNAVAILABLE',
            'Company proof verification is unavailable.',
            503,
          );
        // The 5-minute presentation is verified cryptographically once; later custody steps use
        // the recorded outcome. Callers already require live on-chain authorization of both parties.
        const proof = await this.flow.companyIdentityProofOutcome(requestId, offer.distributor);
        // Business rule: an expired, unverified request no longer gates the offer; the
        // Distributor may request again or decide without it.
        if (proof.status !== 'VERIFIED' && workflow.identityProof.expiresAt <= Date.now() / 1000)
          return;
        if (proof.status !== 'VERIFIED' || !same(proof.presenterWallet ?? '', offer.sender))
          throw new OrdersError(
            'COMPANY_PROOF_REQUIRED',
            'Verify the requested company evidence before accepting, scheduling or handing off this stock.',
          );
      },
    }));
  }
  private async offerBatchSummary(offer: CustodyOffer) {
    const batch = await this.gateway.read(
      offer.kind === 1 ? 'ingredients' : 'products',
      offer.kind === 1 ? 'getBatch' : 'getProduct',
      [offer.batchId],
    );
    return this.discoverBatch(offer.kind, offer.batchId, batch);
  }
  private async offerView(offer: CustodyOffer) {
    const [summary, resolved, events] = await Promise.all([
      this.offerBatchSummary(offer),
      this.directory?.resolveMany([offer.sender, offer.distributor]),
      this.gateway.events('orders', 'LocationRegistered'),
    ]);
    const identities = resolved ?? [];
    const name = (wallet: string) =>
      identities.find((identity) => same(identity.walletAddress, wallet))?.companyName ??
      'Company name unavailable';
    const locationName = async (location: string, owner: string) => {
      const alias = await this.locationAlias(location, owner);
      if (alias) return alias;
      const event = events.find(
        (event) => same(event.location, location) && same(event.company, owner),
      );
      if (event) {
        const details = await this.readOptionalPrivateRecord({
          cid: event.detailsCid,
          contentHash: event.detailsHash,
          id: location,
          owner,
        });
        return String(details?.label ?? 'Location name unavailable');
      }
      return 'Location name unavailable';
    };
    const [fromLocationName, fromLocationAddress, toLocationName, toLocationAddress] =
      await Promise.all([
        locationName(offer.fromLocation, offer.sender),
        this.locationAddress(
          offer.fromLocation,
          offer.sender,
          events.find((e) => same(e.location, offer.fromLocation))?.detailsHash,
        ),
        locationName(offer.toLocation, offer.distributor),
        this.locationAddress(
          offer.toLocation,
          offer.distributor,
          events.find((e) => same(e.location, offer.toLocation))?.detailsHash,
        ),
      ]);
    return {
      ...offer,
      itemName: summary.name ?? 'Registered batch',
      batchReference: summary.batchReference,
      senderName: name(offer.sender),
      distributorName: name(offer.distributor),
      fromLocationName,
      fromLocationAddress,
      toLocationName,
      toLocationAddress,
    };
  }
  async listCustodyOffers(sessionId?: string) {
    const result = await this.offers().list(sessionId);
    return { offers: await Promise.all(result.offers.map((offer) => this.offerView(offer))) };
  }
  async getCustodyOffer(sessionId: string | undefined, offerId: string) {
    return { offer: await this.offerView(await this.offers().get(sessionId, offerId)) };
  }
  async createCustodyOffer(
    sessionId: string | undefined,
    input: Parameters<CustodyOffers['create']>[1],
  ) {
    const result = await this.offers().create(sessionId, input);
    return { offer: await this.offerView(result.offer) };
  }
  async actCustodyOffer(
    sessionId: string | undefined,
    offerId: string,
    input: Parameters<CustodyOffers['act']>[2],
  ) {
    const result = await this.offers().act(sessionId, offerId, input);
    return { offer: await this.offerView(result.offer) };
  }
  async prepareCustodyOffer(sessionId: string | undefined, offerId: string, signal?: AbortSignal) {
    return this.offers().prepare(sessionId, offerId, signal);
  }
  private requireResourceOwner(owner: string | undefined, actor: string) {
    if (!owner || !same(owner, actor))
      throw new OrdersError(
        'RESOURCE_NOT_FOUND',
        'This record is not available for your company to manage.',
        404,
      );
  }
  async informationRequests(sessionId?: string) {
    const session = await this.session(sessionId);
    if (!this.repository.listEvidence || !this.flow)
      throw new OrdersError(
        'INFORMATION_REQUESTS_UNAVAILABLE',
        'The company proof request service is unavailable.',
        503,
      );
    const flow = this.flow;
    const sharedRecords = (await flow.listSharedCompanyRequests?.(sessionId)) ?? [];
    // Shared records were just loaded and hash-checked against the registry; reloading them
    // for their status repeated the same chain read, IPFS fetch and decryption.
    const sharedIds = new Set(sharedRecords.map((record) => record.requestId));
    const localRecords = await this.repository.listEvidence().catch((error) => {
      if (!sharedRecords.length) throw error;
      return [];
    });
    const records = new Map(localRecords.map((record) => [record.requestId, record]));
    for (const record of sharedRecords) records.set(record.requestId, record);
    // Rows are independent; chain reads batch through multicall when issued together.
    const rows = await Promise.all(
      [...records.values()].map(async (record): Promise<ChainRecord | undefined> => {
        if (
          !record.identityProof ||
          (!same(record.requester, session.address) && !same(record.supplier, session.address))
        )
          return undefined;
        const counterparty = same(record.requester, session.address)
          ? record.supplier
          : record.requester;
        let status: string =
          record.identityProof.expiresAt <= Date.now() / 1000
            ? 'EXPIRED'
            : record.identityProof.status;
        try {
          if (!record.deliveryOrderId) {
            const context = await this.gateway.read(
              record.orderContext ? 'orders' : 'evidence',
              record.orderContext ? 'getOrder' : 'getRequest',
              [record.requestId],
            );
            if (
              !same(record.requester, record.orderContext ? context.buyer : context.requester) ||
              !same(record.supplier, record.orderContext ? context.seller : context.supplier)
            )
              throw new OrdersError(
                'PROOF_CONTEXT_UNAVAILABLE',
                'The original company proof context is no longer available.',
                404,
              );
          }
          // Recorded outcome: re-verifying the short-lived presentation would mark verified rows unavailable.
          const current = sharedIds.has(record.requestId)
            ? { status: record.identityProof.status }
            : await flow.companyIdentityProofOutcome(record.requestId, session.address);
          status =
            record.identityProof.expiresAt <= Date.now() / 1000
              ? 'EXPIRED'
              : (current.status ?? 'REQUESTED');
        } catch (cause) {
          if (
            !(cause instanceof Error) ||
            !('status' in cause) ||
            ![403, 404, 409].includes(Number(cause.status))
          )
            throw cause;
          status = 'UNAVAILABLE';
        }
        const [company, offer] = await Promise.all([
          this.directory?.resolve(counterparty),
          record.deliveryOrderId
            ? this.offers().lookup(record.deliveryOrderId, session.address)
            : undefined,
        ]);
        return {
          sharedReference: record.sharedIdentity === true,
          requestId: record.requestId,
          referenceId: record.deliveryOrderId ?? record.requestId,
          context: record.deliveryOrderId
            ? offer
              ? 'custody'
              : 'delivery'
            : record.orderContext
              ? 'order'
              : 'ingredient',
          // Display context only; every value here is already visible to both participants.
          counterpartyWallet: counterparty,
          counterpartyRole: company?.role,
          // Only the item name is needed; the full offer view also scans location events.
          subject: offer
            ? `${(await this.offerBatchSummary(offer)).name ?? 'Registered batch'} · ${offer.quantity} ${offer.unit}`
            : undefined,
          requiredClaims: record.identityProof.requiredClaims ?? [],
          optionalClaims: record.identityProof.optionalClaims ?? [],
          verifiedAt: record.identityProof.verifiedAt,
          direction: same(record.requester, session.address) ? 'received' : 'sent',
          company: company?.companyName ?? counterparty,
          purpose: record.identityProof.purpose,
          requestedFieldsCount: new Set([
            ...(record.identityProof.requiredClaims ?? []),
            ...(record.identityProof.optionalClaims ?? []),
          ]).size,
          requiredFieldsCount: new Set(record.identityProof.requiredClaims ?? []).size,
          expiresAt: record.identityProof.expiresAt,
          status,
        };
      }),
    );
    return {
      requests: rows.filter((row): row is ChainRecord => row !== undefined),
      actor: session.address,
    };
  }
  private async prepareWarehouseTransaction(
    actor: string,
    contract: string,
    method: string,
    args: unknown[],
    signal?: AbortSignal,
  ) {
    try {
      return signal
        ? await this.gateway.prepare(actor, contract, method, args, signal)
        : await this.gateway.prepare(actor, contract, method, args);
    } catch (cause) {
      if (
        cause &&
        typeof cause === 'object' &&
        'code' in cause &&
        cause.code === 'CALL_EXCEPTION'
      ) {
        // Ethers staticCall decodes custom errors using this contract's loaded deployment ABI.
        const name = (cause as { revert?: { name?: string } }).revert?.name;
        if (contract === 'custody' && method === 'createRoadTransfer') {
          const explanations: Record<string, string> = {
            InvalidInput:
              'Check product and linked ingredient validity, actual dispatch time, expected arrival and location owners.',
            InsufficientInventory:
              'Refresh available product stock at the selected pickup location. Another transfer may have used or reserved it.',
            InvalidState:
              'Refresh the product inventory and its recorded production or pickup location.',
            Unauthorized:
              'Check the sender and recipient roles, active credentials and transfer permissions.',
          };
          if (name && explanations[name])
            throw new OrdersError(
              'PRODUCT_HANDOFF_REJECTED',
              `Product handoff simulation rejected (${name}). ${explanations[name]} No transaction was submitted.`,
              409,
            );
        }
        throw new OrdersError(
          contract === 'productDelivery'
            ? 'PRODUCT_DELIVERY_REJECTED'
            : 'CUSTODY_TRANSITION_REJECTED',
          contract === 'productDelivery'
            ? 'The product delivery state rejected this action. Refresh and check Manufacturer approval, assigned Distributor acceptance, route ownership, available stock, actual dispatch time and any requested company proof.'
            : 'The warehouse/shipment simulation rejected this action before wallet submission. Refresh and check authorization, location ownership, available or reserved quantity, Supplier approval and requested company proof.',
        );
      }
      throw cause;
    }
  }
  async prepareLogistics(
    sessionId: string | undefined,
    input: LogisticsAction,
    signal?: AbortSignal,
  ) {
    const session = await this.session(sessionId);
    this.displaySnapshots.invalidate();
    this.summaryReader?.invalidate();
    if (
      input.action === 'product-order-select' ||
      input.action === 'product-order-respond' ||
      input.action === 'product-order-dispatch' ||
      input.action === 'product-order-close'
    )
      return this.prepareProductDelivery(session, input, sessionId);
    if (Number(await this.optionalRead('delivery', 'custodyPolicy')) !== 1)
      throw new OrdersError(
        'CUSTODY_UPGRADE_REQUIRED',
        'Deploy the warehouse-first contract suite before using this flow.',
      );
    const key = id(
      `logistics:${this.gateway.chainId}:${this.gateway.address}:${session.address.toLowerCase()}:${input.operationId}`,
    );
    let contract = 'delivery',
      method: string,
      args: unknown[];
    if ('occurredAt' in input && input.occurredAt > Date.now() / 1000)
      throw new OrdersError(
        'INVALID_EVENT_TIME',
        'Actual dispatch/receipt time cannot be in the future.',
        400,
      );
    if (
      ['arrange-delivery', 'warehouse-decision', 'shipment-return'].includes(input.action) &&
      Number(await this.optionalRead('delivery', 'reviewPolicy')) !== 1
    )
      throw new OrdersError(
        'SHIPMENT_REVIEW_UPGRADE_REQUIRED',
        'Deploy the updated full suite to use custody acceptance and Supplier-arranged delivery.',
      );
    if (input.action === 'arrange-from-custody') {
      if (session.role !== CompanyRole.SUPPLIER)
        throw new OrdersError(
          'SUPPLIER_REQUIRED',
          'Only the owning Supplier can select custody fulfilment.',
          403,
        );
      const order = await this.gateway.read('orders', 'getOrder', [input.orderId]);
      this.requireResourceOwner(order.seller, session.address);
      if (Number(await this.optionalRead('delivery', 'fulfilmentPolicy')) !== 2)
        throw new OrdersError(
          'FULFILMENT_UPGRADE_REQUIRED',
          'Deploy the two-mode delivery suite before selecting custody fulfilment.',
        );
      const [delivery, decision] = await Promise.all([
        this.gateway.read('delivery', 'get', [input.orderId]),
        this.gateway.read('orders', 'requestDecision', [input.orderId]),
      ]);
      if (
        Number(delivery.stage) !== 1 ||
        Number(decision.status) !== 1 ||
        Number(order.status) !== 1 ||
        Number(order.expiresAt) <= Date.now() / 1000
      )
        throw new OrdersError(
          'FULFILMENT_SELECTION_CLOSED',
          'Approve the request first, then choose fulfilment before assigning a carrier or reaching the deadline.',
        );
      const [stock, batchId] = await Promise.all([
        this.gateway.read('delivery', 'getPosition', [input.positionId]),
        this.gateway.read('orders', 'requestedBatch', [input.orderId]),
      ]);
      if (
        !same(stock.position.supplier, session.address) ||
        !same(stock.position.batchId, batchId) ||
        BigInt(stock.available) < BigInt(order.requested)
      )
        throw new OrdersError(
          'INSUFFICIENT_CUSTODY_STOCK',
          'Select received, unreserved custody stock belonging to your company and this exact ingredient batch, sufficient for the full request.',
        );
      this.requireResourceOwner(
        await this.gateway.read('orders', 'locationOwner', [input.receivingLocation]),
        order.buyer,
      );
      method = 'arrangeFromCustody';
      args = [input.orderId, input.positionId, input.receivingLocation];
    } else if (input.action === 'arrange-delivery') {
      if (session.role !== CompanyRole.SUPPLIER)
        throw new OrdersError(
          'SUPPLIER_REQUIRED',
          'Only the Supplier can arrange this approved ingredient delivery.',
          403,
        );
      method = 'arrangeDelivery';
      this.requireResourceOwner(
        (await this.gateway.read('orders', 'getOrder', [input.orderId])).seller,
        session.address,
      );
      args = [input.orderId];
    } else if (input.action === 'warehouse-decision') {
      if (session.role !== CompanyRole.DISTRIBUTOR)
        throw new OrdersError(
          'DISTRIBUTOR_REQUIRED',
          'Only the intended Distributor can decide custody acceptance.',
          403,
        );
      method = 'decideWarehouseShipment';
      this.requireResourceOwner(
        (await this.gateway.read('delivery', 'getRoadShipment', [input.shipmentId])).recipient,
        session.address,
      );
      args = [input.shipmentId, input.decision];
    } else if (input.action === 'shipment-return') {
      if (session.role !== CompanyRole.SUPPLIER)
        throw new OrdersError(
          'SUPPLIER_REQUIRED',
          'Only the original Supplier can confirm returned stock.',
          403,
        );
      try {
        decodeShipmentQr(input.qrPayload, {
          shipmentId: input.shipmentId,
          kind: 'ingredient',
          chainId: this.gateway.chainId,
          ordersAddress: this.gateway.address,
          publicAppUrl: process.env.VITE_PUBLIC_APP_URL ?? '',
        });
      } catch (error) {
        throw new OrdersError(
          'SHIPMENT_QR_INVALID',
          'Scan this rejected shipment label before confirming its physical return.',
          400,
        );
      }
      method = 'confirmRejectedReturn';
      this.requireResourceOwner(
        (await this.gateway.read('delivery', 'getRoadShipment', [input.shipmentId])).sender,
        session.address,
      );
      args = [key, input.shipmentId, input.occurredAt];
    } else if (input.action === 'warehouse') {
      if (session.role !== CompanyRole.DISTRIBUTOR)
        throw new OrdersError(
          'DISTRIBUTOR_REQUIRED',
          'Only a Distributor can register its warehouse.',
          403,
        );
      this.requireResourceOwner(
        await this.gateway.read('orders', 'locationOwner', [input.location]),
        session.address,
      );
      method = 'registerWarehouse';
      args = [input.location, input.name];
    } else if (input.action === 'shipment-vehicle') {
      if (session.role !== CompanyRole.DISTRIBUTOR)
        throw new OrdersError(
          'DISTRIBUTOR_REQUIRED',
          'Only an involved Distributor can record shipment vehicles.',
          403,
        );
      const shipment = await this.gateway.read('delivery', 'getRoadShipment', [input.shipmentId]);
      if (!same(shipment.sender, session.address) && !same(shipment.recipient, session.address))
        this.requireResourceOwner(undefined, session.address);
      contract = 'delivery';
      method = 'setShipmentVehicle';
      args = [input.shipmentId, input.vehicle];
    } else if (input.action === 'shipment-receive') {
      try {
        decodeShipmentQr(input.qrPayload, {
          shipmentId: input.shipmentId,
          kind: input.kind,
          chainId: this.gateway.chainId,
          ordersAddress: this.gateway.address,
          publicAppUrl: process.env.VITE_PUBLIC_APP_URL ?? '',
        });
      } catch {
        throw new OrdersError(
          'SHIPMENT_QR_INVALID',
          'Scan the label for this shipment, network and registry.',
          400,
        );
      }
      if (input.kind === 'ingredient') {
        this.requireResourceOwner(
          (await this.gateway.read('delivery', 'getRoadShipment', [input.shipmentId])).recipient,
          session.address,
        );
        if (input.vehicle) {
          method = 'receiveRoadShipmentWithVehicle';
          args = [key, input.shipmentId, input.quantity, input.occurredAt, input.vehicle];
        } else {
          method = 'receiveRoadShipment';
          args = [key, input.shipmentId, input.quantity, input.occurredAt];
        }
      } else {
        const shipment = await this.gateway.read('custody', 'getTransfer', [input.shipmentId]);
        if (!same(shipment.recipient, session.address) || shipment.quantity !== input.quantity)
          throw new OrdersError(
            'RECEIPT_MISMATCH',
            'Confirm the complete expected product quantity here; use the existing reconciliation workflow for discrepancies.',
          );
        const receipt = await this.privateRecord(key, session.address, {
          shipmentId: input.shipmentId,
          quantity: input.quantity,
          occurredAt: input.occurredAt,
        });
        contract = 'custody';
        method = 'confirmReceiptWithMissing';
        args = [
          input.shipmentId,
          input.quantity,
          '0',
          '0',
          '0',
          input.occurredAt,
          receipt.contentHash,
          receipt.cid,
        ];
      }
    } else {
      if (input.expectedAt <= input.occurredAt)
        throw new OrdersError(
          'INVALID_ARRIVAL',
          'Expected arrival must be after actual dispatch.',
          400,
        );
      if (input.action === 'product-dispatch') {
        const product = await this.gateway.read('products', 'getProduct', [input.batchId]);
        if (session.role === CompanyRole.MANUFACTURER)
          this.requireResourceOwner(product.manufacturer, session.address);
        else if (
          session.role !== CompanyRole.DISTRIBUTOR ||
          BigInt(
            (await this.gateway.read('custody', 'getInventory', [input.batchId, session.address]))
              .available ?? '0',
          ) === 0n
        )
          this.requireResourceOwner(undefined, session.address);
        this.requireResourceOwner(
          await this.gateway.read('orders', 'locationOwner', [input.fromLocation]),
          session.address,
        );
        const details = await this.privateRecord(key, session.address, {
          purpose: 'Road shipment',
          batchId: input.batchId,
        });
        contract = 'custody';
        method = 'createRoadTransfer';
        args = [
          key,
          input.batchId,
          input.recipient,
          input.quantity,
          input.expectedAt,
          details.contentHash,
          details.cid,
          input.fromLocation,
          input.toLocation,
          input.occurredAt,
          input.vehicle,
        ];
      } else {
        if (input.action === 'stock-dispatch') {
          if (session.role !== CompanyRole.SUPPLIER)
            throw new OrdersError(
              'SUPPLIER_REQUIRED',
              'Only the owning Supplier can send ingredient stock.',
              403,
            );
          this.requireResourceOwner(
            (await this.gateway.read('ingredients', 'getBatch', [input.batchId])).supplier,
            session.address,
          );
        } else {
          if (session.role !== CompanyRole.DISTRIBUTOR)
            throw new OrdersError(
              'DISTRIBUTOR_REQUIRED',
              'Only the order custodian can dispatch ingredients.',
              403,
            );
          const order = await this.gateway.read('delivery', 'custodyOrders', [input.orderId]);
          const stock = await this.gateway.read('delivery', 'getPosition', [order.positionId]);
          this.requireResourceOwner(stock.position?.distributor, session.address);
        }
        this.requireResourceOwner(
          await this.gateway.read('orders', 'locationOwner', [input.fromLocation]),
          session.address,
        );
        method = input.action === 'stock-dispatch' ? 'dispatchToWarehouse' : 'dispatchCustodyOrder';
        args = [
          {
            shipmentId: key,
            referenceId: input.action === 'stock-dispatch' ? input.batchId : input.orderId,
            quantity: input.quantity,
            fromLocation: input.fromLocation,
            toLocation: input.toLocation,
            vehicle: input.vehicle,
            occurredAt: input.occurredAt,
            expectedAt: input.expectedAt,
          },
        ];
      }
    }
    return {
      resultId: key,
      transaction: await this.prepareWarehouseTransaction(
        session.address,
        contract,
        method,
        args,
        signal,
      ),
    };
  }
  private async prepareProductDelivery(
    session: Awaited<ReturnType<OrdersService['session']>>,
    input: LogisticsAction,
    sessionId?: string,
  ) {
    if (Number(await this.optionalRead('custody', 'productDeliveryPolicy')) !== 1)
      throw new OrdersError(
        'PRODUCT_DELIVERY_UPGRADE_REQUIRED',
        'Deploy the product delivery suite before arranging product orders.',
      );
    if (!('orderId' in input))
      throw new OrdersError('INVALID_REQUEST', 'An order reference is required.', 400);
    const order = await this.gateway.read('orders', 'getOrder', [input.orderId]);
    const delivery = await this.gateway.read('productDelivery', 'get', [input.orderId]);
    const isManufacturer =
      same(order.seller, session.address) && session.role === CompanyRole.MANUFACTURER;
    const isCarrier =
      same(delivery.distributor, session.address) && session.role === CompanyRole.DISTRIBUTOR;
    const isBuyer = same(order.buyer, session.address) && session.role === CompanyRole.RETAILER;
    if (!isManufacturer && !isCarrier && !isBuyer)
      throw new OrdersError(
        'RESOURCE_NOT_FOUND',
        'This product order is unavailable to your company.',
        404,
      );
    let method: string,
      args: unknown[],
      resultId = input.orderId;
    if (input.action === 'product-order-select') {
      if (!isManufacturer)
        throw new OrdersError(
          'MANUFACTURER_REQUIRED',
          'Only this product Manufacturer selects fulfilment.',
          403,
        );
      const batchId = await this.gateway.read('orders', 'requestedBatch', [input.orderId]);
      const requestRecord = await this.repository.findPrivate('products', input.orderId);
      if (
        requestRecord &&
        same(requestRecord.owner, order.buyer) &&
        same(requestRecord.contentHash, order.detailsHash) &&
        requestRecord.cid === order.detailsCid
      ) {
        const details = JSON.parse(await this.store.decrypt(requestRecord.payload));
        const source = details.custodySource;
        if (
          source &&
          (input.mode !== 2 ||
            !same(input.distributor, source.distributor) ||
            !same(input.fromLocation, source.location))
        )
          throw new OrdersError(
            'REQUESTED_CUSTODY_REQUIRED',
            'Use the Distributor warehouse selected on this Retailer request.',
          );
      }
      this.requireResourceOwner(
        (await this.gateway.read('products', 'getProduct', [batchId])).manufacturer,
        session.address,
      );
      this.requireResourceOwner(
        await this.gateway.read('orders', 'locationOwner', [input.fromLocation]),
        input.mode === 1 ? session.address : input.distributor,
      );
      this.requireResourceOwner(
        await this.gateway.read('orders', 'locationOwner', [input.toLocation]),
        order.buyer,
      );
      if (input.mode === 2) {
        const [stock, located] = await Promise.all([
          this.gateway.read('custody', 'getInventory', [batchId, input.distributor]),
          this.gateway.read('custody', 'locationStock', [
            batchId,
            input.distributor,
            input.fromLocation,
          ]),
        ]);
        if (
          BigInt(stock.available ?? '0') < BigInt(order.requested) ||
          BigInt(located) < BigInt(order.requested)
        )
          throw new OrdersError(
            'INSUFFICIENT_PRODUCT_CUSTODY',
            'This Distributor location has insufficient unreserved received stock for the full order.',
          );
      }
      method = 'select';
      args = [input.orderId, input.mode, input.distributor, input.fromLocation, input.toLocation];
    } else if (input.action === 'product-order-respond') {
      if (!isCarrier)
        throw new OrdersError(
          'DISTRIBUTOR_REQUIRED',
          'Only the assigned Distributor may respond.',
          403,
        );
      method = 'respond';
      args = [input.orderId, input.accept];
    } else if (input.action === 'product-order-close') {
      method = 'close';
      args = [input.orderId];
    } else if (input.action === 'product-order-dispatch') {
      if (!isCarrier)
        throw new OrdersError(
          'DISTRIBUTOR_REQUIRED',
          'Only the assigned Distributor may dispatch.',
          403,
        );
      if (Number(delivery.stage) !== 3)
        throw new OrdersError(
          'PRODUCT_DELIVERY_NOT_READY',
          'Accept the direct carrier request, or wait for Manufacturer custody arrangement.',
        );
      if (Number(delivery.mode) === 1) {
        try {
          decodeShipmentQr(input.qrPayload ?? '', {
            shipmentId: input.orderId,
            kind: 'product',
            chainId: this.gateway.chainId,
            ordersAddress: this.gateway.address,
            publicAppUrl: process.env.VITE_PUBLIC_APP_URL ?? '',
          });
        } catch {
          throw new OrdersError(
            'SHIPMENT_QR_INVALID',
            'Scan the exact approved product-order label before confirming physical pickup.',
            400,
          );
        }
        if (!(await this.pickupPlan(sessionId, input.orderId)).plan)
          throw new OrdersError(
            'PICKUP_PLAN_REQUIRED',
            'Arrange a pickup time before recording physical collection.',
          );
      }
      if (input.occurredAt > Date.now() / 1000 || input.expectedAt <= Date.now() / 1000)
        throw new OrdersError(
          'INVALID_EVENT_TIME',
          'Use an actual pickup/dispatch time and a future arrival.',
          400,
        );
      resultId = id(
        `product-delivery:${this.gateway.chainId}:${this.gateway.address}:${session.address}:${input.operationId}`,
      );
      method = 'dispatch';
      args = [
        input.orderId,
        {
          transferId: resultId,
          occurredAt: input.occurredAt,
          expectedAt: input.expectedAt,
          vehicle: input.vehicle,
          detailsHash: id(
            JSON.stringify({
              orderId: input.orderId,
              vehicle: input.vehicle,
              occurredAt: input.occurredAt,
              expectedAt: input.expectedAt,
            }),
          ),
          cid: '',
        },
      ];
    } else throw new OrdersError('INVALID_REQUEST', 'Unsupported product delivery action.', 400);
    return {
      resultId,
      transaction: await this.prepareWarehouseTransaction(
        session.address,
        'productDelivery',
        method,
        args,
      ),
    };
  }
  private deliveryQr(orderId: `0x${string}`) {
    try {
      return encodeIngredientDeliveryQr({
        orderId,
        chainId: this.gateway.chainId,
        ordersAddress: this.gateway.address,
        publicAppUrl: process.env.VITE_PUBLIC_APP_URL ?? '',
      });
    } catch {
      return undefined;
    }
  }
  private productOrderQr(orderId: `0x${string}`) {
    try {
      return encodeShipmentQr({
        shipmentId: orderId,
        kind: 'product',
        chainId: this.gateway.chainId,
        ordersAddress: this.gateway.address,
        publicAppUrl: process.env.VITE_PUBLIC_APP_URL ?? '',
      });
    } catch {
      return undefined;
    }
  }
  private assertDeliveryQr(payload: string | undefined, orderId: string) {
    try {
      decodeIngredientDeliveryQr(payload ?? '', {
        orderId,
        chainId: this.gateway.chainId,
        ordersAddress: this.gateway.address,
        publicAppUrl: process.env.VITE_PUBLIC_APP_URL ?? '',
      });
    } catch {
      throw new OrdersError(
        'DELIVERY_QR_INVALID',
        'Scan the label for this exact ingredient request and configured deployment before confirming.',
        400,
      );
    }
  }
  async deliveryIdentityParticipants(
    record: import('../production-flow/production-flow.repository.js').EvidenceWorkflowRecord,
  ) {
    if (!record.deliveryOrderId) return false;
    const { order, delivery, contract } = await this.deliveryReference(
      record.deliveryOrderId,
      record.requester,
    );
    return (
      (contract !== 'custody-offer' || same(record.batchId, delivery.batchId)) &&
      [2, 3, 4, 5].includes(Number(delivery.stage)) &&
      same(record.requester, order.seller) &&
      same(record.supplier, delivery.distributor) &&
      record.requestId ===
        id(
          `ingredient-delivery-identity:${record.deliveryOrderId.toLowerCase()}:${delivery.distributor.toLowerCase()}`,
        )
    );
  }
  private async deliveryReference(referenceId: string, actor?: string) {
    const offer = await this.offers().lookup(referenceId, actor);
    if (offer) {
      if (
        !(await this.gateway.read('stakeholders', 'isAuthorized', [
          offer.sender,
          offer.kind === 1 ? 2 : 3,
        ])) ||
        !(await this.gateway.read('stakeholders', 'isAuthorized', [offer.distributor, 4]))
      )
        throw new OrdersError(
          'PARTICIPANT_UNAUTHORIZED',
          'The sender and Distributor must both remain authorized.',
        );
      return {
        order: {
          seller: offer.sender,
          buyer: offer.distributor,
          proposedBatch: offer.batchId,
          expiresAt: offer.expiresAt,
        },
        delivery: {
          distributor: offer.distributor,
          batchId: offer.batchId,
          stage:
            offer.status === 'REQUESTED'
              ? 2
              : ['ACCEPTED', 'SCHEDULED'].includes(offer.status)
                ? 3
                : offer.status === 'DISPATCHED'
                  ? 4
                  : offer.status === 'RECEIVED'
                    ? 5
                    : 6,
        },
        contract: 'custody-offer',
      };
    }
    let order = await this.gateway.read('orders', 'getOrder', [referenceId]);
    if (Number(await this.optionalRead('custody', 'productDeliveryPolicy')) === 1) {
      const delivery = await this.gateway.read('productDelivery', 'get', [referenceId]);
      if (Number(delivery.mode) > 0)
        return {
          order: { ...order, proposedBatch: delivery.batchId },
          delivery,
          contract: 'productDelivery',
        };
    }
    if (Number(await this.optionalRead('delivery', 'reviewPolicy')) === 1) {
      const shipment = await this.gateway.read('delivery', 'getRoadShipment', [referenceId]);
      if (Number(shipment.leg) === 1) {
        const batch = await this.gateway.read('ingredients', 'getBatch', [shipment.batchId]);
        order = {
          ...order,
          seller: shipment.sender,
          buyer: shipment.recipient,
          proposedBatch: shipment.batchId,
          expiresAt: batch.expiresAt,
        };
      }
    }
    return {
      order,
      delivery: await this.gateway.read('delivery', 'get', [referenceId]),
      contract: 'delivery',
    };
  }
  private async optionalRead(contract: string, method: string, args: unknown[] = []) {
    try {
      return await this.gateway.read(contract, method, args);
    } catch (cause) {
      const failure = cause as { code?: string; data?: string; value?: string };
      if (
        (failure.code === 'CALL_EXCEPTION' && failure.data === '0x') ||
        (failure.code === 'BAD_DATA' && failure.value === '0x')
      )
        return undefined;
      throw cause;
    }
  }
  private async loadRequestDecision(requestId: string, seller: string) {
    const decision = await this.optionalRead('orders', 'requestDecision', [requestId]);
    if (decision && Number(decision.status) !== 0) {
      const key = id(`request-decision:${requestId.toLowerCase()}`);
      const details = await this.readOptionalPrivateRecord({
        cid: decision.encryptedCid,
        contentHash: decision.detailsHash,
        id: key,
        owner: seller,
      });
      decision.reason = details?.reason;
    }
    return decision;
  }
  private catalogueBatch(kind: number, batchId: string) {
    return this.gateway.read(
      kind === 1 ? 'ingredients' : 'products',
      kind === 1 ? 'getBatch' : 'getProduct',
      [batchId],
    );
  }
  private batchUnit(value: string) {
    try {
      return decodeBytes32String(value);
    } catch {
      return 'unrecognized unit';
    }
  }
  async prepareEvidence(
    sessionId: string | undefined,
    orderId: string,
    input: {
      operationId: string;
      batchId: string;
      policy?: EvidenceRequestInput['policy'];
      claims: string[];
      requiredClaims: string[];
      reason: string;
      dueAt: Date;
    },
  ) {
    const session = await this.session(sessionId);
    const order = await this.gateway.read('orders', 'getOrder', [orderId]);
    if (!same(order.buyer, session.address))
      throw new OrdersError('NOT_FOUND', 'Order not found.', 404);
    const item = await this.gateway.read('orders', 'getItem', [order.itemId]);
    if (
      ![1, 2].includes(Number(order.status)) ||
      Number(order.expiresAt) <= Date.now() / 1000 ||
      input.dueAt.getTime() / 1000 > Number(order.expiresAt)
    )
      throw new OrdersError(
        'ORDER_EXPIRED',
        'Use an active order and an evidence deadline within its deadline.',
      );
    const links =
      Number(item.kind) === 1
        ? [{ batchId: order.proposedBatch }]
        : await this.gateway.read('products', 'getIngredientLinks', [order.proposedBatch]);
    if (!links.some((link: ChainRecord) => same(link.batchId, input.batchId)))
      throw new OrdersError(
        'WRONG_BATCH',
        'Choose the exact proposed ingredient or an ingredient linked to this proposed finished batch.',
      );
    if (!this.flow)
      throw new OrdersError('EVIDENCE_SERVICE_UNAVAILABLE', 'Evidence service unavailable.', 503);
    return this.flow.prepareEvidenceRequest(sessionId, {
      ...input,
      policy: {
        ...input.policy,
        policyVersion: 2,
        template: input.policy?.template ?? 'custom',
        allowUnknownAllergens: input.policy?.allowUnknownAllergens ?? false,
      },
      reason: `Order ${orderId}: ${input.reason}`.slice(0, 500),
      ...(Number(item.kind) === 2 ? { productBatchId: order.proposedBatch } : {}),
    });
  }
  constructor(
    private auth: AuthService,
    public gateway: OrdersGateway,
    private store: CredentialContentStore,
    private repository: ProductionFlowRepository,
    private flow?: ProductionFlowService,
    private messaging?: DidCommService,
    private directory?: StakeholderDirectory,
    private ingredientRecords?: IngredientBatchWorkflowRepository,
    private applicationMetadata?: ApplicationMetadataRepository,
    private applicationLogos?: ApplicationLogoSource,
  ) {}
  async traceability(
    sessionId: string | undefined,
    selection: { kind?: string; batchId?: string },
  ) {
    const session = await this.session(sessionId);
    if (session.role === CompanyRole.SYSTEM_ADMIN)
      throw new OrdersError(
        'ROLE_NOT_ALLOWED',
        'Business traceability is for participating companies.',
        403,
      );
    const state = await this.state(sessionId);
    const result = await readBusinessTraceability(
      this.gateway,
      state,
      selection,
      async (wallets) => {
        const identities = (await this.directory?.resolveMany(wallets)) ?? [];
        return new Map(
          await Promise.all(
            identities.map(
              async (identity) =>
                [
                  identity.walletAddress.toLowerCase(),
                  {
                    companyName: identity.companyName,
                    logoPath: (await this.hasCompanyLogo(
                      identity.walletAddress,
                      identity.applicationId,
                    ))
                      ? `/branding/${getAddress(identity.walletAddress)}/logo`
                      : undefined,
                  },
                ] as const,
            ),
          ),
        );
      },
    );
    if (selection.batchId && !result.root)
      throw new OrdersError(
        'TRACE_NOT_FOUND',
        'This batch is not available in your company traceability records.',
        404,
      );
    return result;
  }
  private locationLabelKey(location: string) {
    return id(
      `location-label:${this.gateway.chainId}:${this.gateway.address.toLowerCase()}:${location.toLowerCase()}`,
    );
  }
  private async locationAlias(location: string, owner: string) {
    const record = await this.repository.findPrivate('products', this.locationLabelKey(location));
    if (record && same(record.owner, owner)) {
      const serialized = await this.store.decrypt(record.payload);
      if (!same(record.contentHash, `0x${createHash('sha256').update(serialized).digest('hex')}`))
        throw new OrdersError(
          'PROFILE_UNAVAILABLE',
          'Location display metadata could not be checked.',
          503,
        );
      return (JSON.parse(serialized) as { label: string; address?: string }).label;
    }
    const event = (await this.gateway.events('orders', 'LocationRegistered')).find(
      (entry) => same(entry.location, location) && same(entry.company, owner),
    );
    if (!event) return undefined;
    const details = await this.readOptionalPrivateRecord({
      cid: event.detailsCid,
      contentHash: event.detailsHash,
      id: location,
      owner,
    });
    return typeof details?.label === 'string' ? details.label : undefined;
  }
  private async locationAddress(location: string, owner: string, detailsHash?: string) {
    const alias = await this.repository.findPrivate('products', this.locationLabelKey(location));
    const original = detailsHash
      ? await this.repository.findPrivate('products', location)
      : undefined;
    for (const record of [alias, original]) {
      if (
        !record ||
        !same(record.owner, owner) ||
        (record === original && (!detailsHash || !same(record.contentHash, detailsHash)))
      )
        continue;
      const text = await this.store.decrypt(record.payload);
      if (!same(record.contentHash, '0x' + createHash('sha256').update(text).digest('hex')))
        throw new OrdersError('PROFILE_UNAVAILABLE', 'Location details could not be checked.', 503);
      const data = JSON.parse(text);
      if (typeof data.address === 'string') return data.address;
    }
    if (detailsHash) {
      const event = (await this.gateway.events('orders', 'LocationRegistered')).find(
        (entry) => same(entry.location, location) && same(entry.company, owner),
      );
      if (event) {
        const data = await this.readOptionalPrivateRecord({
          cid: event.detailsCid,
          contentHash: event.detailsHash,
          id: location,
          owner,
        });
        if (typeof data?.address === 'string') return data.address;
      }
    }
    return undefined;
  }
  async companyProfile(sessionId?: string) {
    const session = await this.session(sessionId);
    if (session.role === CompanyRole.SYSTEM_ADMIN)
      throw new OrdersError(
        'ROLE_NOT_ALLOWED',
        'Operational locations belong to participating companies.',
        403,
      );
    const events = (await this.gateway.events('orders', 'LocationRegistered')).filter((event) =>
      same(event.company, session.address),
    );
    const locations = await Promise.all(
      events.map(async (event) => {
        this.requireResourceOwner(
          await this.gateway.read('orders', 'locationOwner', [event.location]),
          session.address,
        );
        const details = await this.readOptionalPrivateRecord({
          cid: event.detailsCid,
          contentHash: event.detailsHash,
          id: event.location,
          owner: session.address,
        });
        const registeredLabel =
          typeof details?.label === 'string' ? details.label : 'Registered location';
        const warehouse =
          session.role === CompanyRole.DISTRIBUTOR &&
          Number(await this.optionalRead('delivery', 'custodyPolicy')) === 1
            ? await this.gateway.read('delivery', 'warehouses', [event.location])
            : undefined;
        return {
          location: event.location,
          registeredLabel,
          address: await this.locationAddress(event.location, session.address, event.detailsHash),
          label: (await this.locationAlias(event.location, session.address)) ?? registeredLabel,
          warehouse: same(warehouse?.distributor, session.address),
        };
      }),
    );
    let initialLocationName: string | undefined;
    let initialLocationAddress: string | undefined;
    if (this.applicationMetadata)
      for (const event of await this.gateway.events('stakeholders', 'ApplicationSubmitted')) {
        if (!same(event.applicant, session.address)) continue;
        const applicationId = event.applicationId;
        const application = await this.gateway.read('stakeholders', 'getApplication', [
          applicationId,
        ]);
        const metadata = await this.applicationMetadata.find(applicationId);
        if (
          same(application.applicant, session.address) &&
          metadata &&
          same(metadata.profileHash, application.profileHash)
        ) {
          initialLocationName = metadata.initialLocationName;
          if (metadata.initialLocationDetails)
            initialLocationAddress = JSON.parse(
              await this.store.decrypt(metadata.initialLocationDetails.payload),
            ).address;
        }
      }
    return {
      wallet: session.address,
      role: session.role,
      locations,
      initialLocationName,
      initialLocationAddress,
    };
  }
  async updateLocationLabel(
    sessionId: string | undefined,
    location: string,
    label: string,
    address?: string,
  ) {
    if (address !== undefined) {
      address = address.trim();
      if (!address || address.length > 1000)
        throw new OrdersError(
          'INVALID_LOCATION_ADDRESS',
          'Enter a location address up to 1000 characters.',
          400,
        );
    }
    const session = await this.session(sessionId);
    if (session.role === CompanyRole.SYSTEM_ADMIN)
      throw new OrdersError(
        'COMPANY_ROLE_REQUIRED',
        'Locations belong to operating companies.',
        403,
      );
    this.requireResourceOwner(
      await this.gateway.read('orders', 'locationOwner', [location]),
      session.address,
    );
    const event = (await this.gateway.events('orders', 'LocationRegistered')).find(
      (e) => same(e.location, location) && same(e.company, session.address),
    );
    const savedAddress =
      address ?? (await this.locationAddress(location, session.address, event?.detailsHash));
    await this.replacePresentationRecord(this.locationLabelKey(location), session.address, {
      label,
      ...(savedAddress ? { address: savedAddress } : {}),
    });
    return {
      location,
      label,
      address: savedAddress,
      source: 'Company profile location details',
    };
  }
  private pickupKey(referenceId: string, distributor: string) {
    return id(
      `pickup:${this.gateway.chainId}:${this.gateway.address.toLowerCase()}:${referenceId.toLowerCase()}:${distributor.toLowerCase()}`,
    );
  }
  async pickupPlan(
    sessionId: string | undefined,
    referenceId: string,
    input?: { pickupAt: number },
  ) {
    const session = await this.session(sessionId);
    const { order, delivery, contract } = await this.deliveryReference(
      referenceId,
      session.address,
    );
    if (contract === 'custody-offer')
      throw new OrdersError('USE_CUSTODY_PICKUP', 'Arrange this pickup from the custody request.');
    if (
      ![order.seller, order.buyer, delivery.distributor].some((wallet) =>
        same(wallet, session.address),
      )
    )
      throw new OrdersError(
        'PICKUP_NOT_FOUND',
        'This pickup is not available to your company.',
        404,
      );
    const originBlockHash = (await this.gateway.events('orders', 'OrderRequested')).find((event) =>
      same(event.orderId, referenceId),
    )?.blockHash;
    const binding = {
      referenceId: referenceId.toLowerCase(),
      distributor: delivery.distributor?.toLowerCase(),
      seller: order.seller.toLowerCase(),
      buyer: order.buyer.toLowerCase(),
      batchId: delivery.batchId ?? order.requestedBatch ?? order.proposedBatch,
      expiresAt: Number(order.expiresAt),
      mode: Number(delivery.mode ?? 1),
      contract,
      originBlockHash,
    };
    const key = this.pickupKey(referenceId, delivery.distributor ?? ZeroAddress);
    if (input) {
      if (
        session.role !== CompanyRole.DISTRIBUTOR ||
        !same(session.address, delivery.distributor) ||
        Number(delivery.stage) !== 3 ||
        (contract === 'productDelivery' && Number(delivery.mode) !== 1)
      )
        throw new OrdersError(
          'PICKUP_NOT_READY',
          'Only the accepted direct-delivery Distributor can arrange pickup before dispatch.',
        );
      if (input.pickupAt <= Date.now() / 1000 || input.pickupAt >= Number(order.expiresAt))
        throw new OrdersError(
          'PICKUP_TIME_INVALID',
          'Choose a future pickup time before this request expires.',
          400,
        );
      await this.replacePresentationRecord(key, session.address, {
        ...binding,
        pickupAt: input.pickupAt,
        arrangedAt: new Date().toISOString(),
      });
    }
    const record = await this.repository.findPrivate('products', key);
    if (!record || !same(record.owner, delivery.distributor)) return { plan: null };
    const serialized = await this.store.decrypt(record.payload);
    if (!same(record.contentHash, `0x${createHash('sha256').update(serialized).digest('hex')}`))
      throw new OrdersError(
        'PICKUP_UNAVAILABLE',
        'Pickup planning data could not be checked.',
        503,
      );
    const plan = JSON.parse(serialized);
    if (Object.entries(binding).some(([key, value]) => plan[key] !== value)) return { plan: null };
    return {
      plan: { pickupAt: plan.pickupAt, arrangedAt: plan.arrangedAt, distributor: plan.distributor },
    };
  }
  private async discoverBatch(kind: number, batchId: string, batch: ChainRecord) {
    let metadata: ChainRecord = {};
    if (kind === 1) {
      const record = await this.ingredientRecords?.find(batchId);
      const localMatches =
        record &&
        same(record.supplierWallet, batch.supplier) &&
        same(record.metadataHash, batch.metadataHash) &&
        record.encryptedCid === batch.encryptedCid;
      if (localMatches || batch.encryptedCid) {
        let envelope;
        try {
          const serialized = localMatches
            ? await this.store.decrypt(record.encryptedPayload)
            : await this.store.retrieveAndDecrypt?.(batch.encryptedCid);
          if (!serialized) throw new Error('Encrypted content unavailable');
          envelope = JSON.parse(serialized);
        } catch {
          throw new OrdersError(
            'INGREDIENT_METADATA_UNAVAILABLE',
            'The encrypted ingredient metadata could not be downloaded or decrypted.',
            503,
          );
        }
        if (
          !envelope ||
          !envelope.metadata ||
          typeof envelope.metadata !== 'object' ||
          !same(
            `0x${createHash('sha256').update(JSON.stringify(envelope.metadata)).digest('hex')}`,
            batch.metadataHash,
          )
        )
          throw new OrdersError(
            'INGREDIENT_METADATA_INTEGRITY_MISMATCH',
            'The ingredient metadata does not match its blockchain hash.',
            409,
          );
        if (
          typeof envelope.metadata.batchId !== 'string' ||
          !same(id(envelope.metadata.batchId), batchId) ||
          !same(String(envelope.metadata.supplierWallet), batch.supplier)
        )
          throw new OrdersError(
            'INGREDIENT_METADATA_BINDING_MISMATCH',
            'The ingredient metadata belongs to another batch or Supplier.',
            409,
          );
        metadata = envelope.metadata;
      }
    } else {
      const record = await this.repository.findPrivate('products', batchId);
      const localMatches =
        record &&
        same(record.owner, batch.manufacturer) &&
        same(record.contentHash, batch.metadataHash) &&
        record.cid === batch.publicCid;
      if (localMatches || batch.publicCid) {
        let serialized: string;
        try {
          const recovered = localMatches
            ? await this.store.decrypt(record.payload)
            : await this.store.retrieveAndDecrypt?.(batch.publicCid);
          if (!recovered) throw new Error('Encrypted content unavailable');
          serialized = recovered;
          metadata = JSON.parse(serialized);
        } catch {
          throw new OrdersError(
            'PRODUCT_METADATA_UNAVAILABLE',
            'The encrypted product metadata could not be downloaded or decrypted.',
            503,
          );
        }
        if (!same(`0x${createHash('sha256').update(serialized).digest('hex')}`, batch.metadataHash))
          throw new OrdersError(
            'PRODUCT_METADATA_INTEGRITY_MISMATCH',
            'The product metadata does not match its blockchain hash.',
            409,
          );
        if (
          !metadata ||
          typeof metadata.batchReference !== 'string' ||
          !same(id(metadata.batchReference), batchId)
        )
          throw new OrdersError(
            'PRODUCT_METADATA_BINDING_MISMATCH',
            'The product metadata belongs to another batch.',
            409,
          );
      }
    }
    // Explicit public business summary only. Never spread the private metadata or credential.
    const summary: ChainRecord = {
      name:
        metadata.ingredientName ??
        metadata.productName ??
        (kind === 1 ? 'Ingredient name unavailable' : 'Product name unavailable'),
      category: metadata.category,
      countryOfOrigin: metadata.originDetails?.countryName ?? metadata.origin,
      description: metadata.description,
      batchReference: metadata.batchId ?? metadata.batchReference,
      price: metadata.price,
      priceBasis: metadata.priceBasis,
      currency: metadata.price !== undefined ? metadata.currency : undefined,
      productionLocation: metadata.productionLocation,
      productionLocationName: metadata.productionLocationName,
    };
    if (kind === 1) {
      try {
        const credential = await this.gateway.read('credentials', 'getCredential', [
          batch.credentialId,
        ]);
        summary.credentialStatus = Number(credential.status);
        summary.credentialExpiresAt = credential.expiresAt;
        summary.evidenceAvailability =
          Number(credential.status) === 1
            ? 'Credential registered; evidence available by request'
            : 'Credential evidence is not currently active';
      } catch {
        summary.credentialStatus = 0;
        summary.evidenceAvailability = 'Credential status unavailable';
      }
      const image = await this.optionalRead('ingredients', 'getMedia', [batchId]);
      if (image && !same(image.contentHash, ZeroHash))
        summary.imagePath = `/catalogue/ingredients/${batchId}/image`;
      const listing = await this.optionalRead('ingredients', 'getListing', [batchId]);
      summary.archived = Boolean(listing?.archived);
      summary.listingHash = listing?.metadataHash ?? ZeroHash;
      summary.listingSupported = !!listing;
      summary.credentialName = summary.name;
      if (listing && listing.metadataHash !== ZeroHash) {
        const key = id(`ingredient-listing:${batchId.toLowerCase()}`);
        const value = await this.readPrivateRecord({
          id: key,
          owner: batch.supplier,
          contentHash: listing.metadataHash,
          cid: listing.encryptedCid,
        });
        if (value) {
          if (
            !same(
              `0x${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`,
              listing.metadataHash,
            )
          )
            throw new OrdersError(
              'ENCRYPTED_RECORD_INTEGRITY_MISMATCH',
              'The ingredient listing does not match its blockchain hash.',
              409,
            );
          summary.name = value.name;
          summary.category = value.category;
          summary.description = value.description;
          summary.price = value.price;
          summary.priceBasis = value.priceBasis ?? this.batchUnit(batch.unit);
          summary.currency = value.price !== undefined ? value.currency : undefined;
          summary.nameSource = 'Supplier listing metadata';
        }
      }
    } else {
      const transferable = Boolean(
        await this.gateway.read('products', 'isTransferable', [batchId]),
      );
      summary.credentialStatus = transferable ? 1 : 0;
      summary.credentialLabel = transferable
        ? 'Linked credentials active'
        : 'Linked credential check failed';
      summary.evidenceAvailability = transferable
        ? 'All linked ingredient credentials and product traceability checks are active'
        : 'One or more linked ingredient credentials or traceability checks are not active';
      const image = await this.optionalRead('products', 'getMedia', [batchId]);
      if (image && !same(image.contentHash, ZeroHash))
        summary.imagePath = `/catalogue/products/${batchId}/image`;
    }
    return summary;
  }
  async identity(
    sessionId: string | undefined,
    orderId: string,
    input: {
      action: 'request' | 'material' | 'present' | 'verify' | 'decline' | 'status' | 'reject';
      purpose?: string;
      expiresAt?: number;
      required?: boolean;
      requiredClaims?: string[];
      optionalClaims?: string[];
      presentation?: string;
      reason?: string;
    },
    deliveryIdentity = false,
  ) {
    const session = await this.session(sessionId);
    const actualOrderId = orderId;
    let identityContract = 'delivery';
    let order: ChainRecord = deliveryIdentity
      ? {}
      : await this.gateway.read('orders', 'getOrder', [orderId]);
    if (deliveryIdentity) {
      const reference = await this.deliveryReference(orderId, session.address);
      identityContract = reference.contract;
      order = reference.order;
      const delivery = reference.delivery;
      if (![2, 3, 4, 5].includes(Number(delivery.stage)))
        throw new OrdersError(
          'DELIVERY_IDENTITY_UNAVAILABLE',
          'A current assigned Distributor is required.',
        );
      order = {
        ...order,
        buyer: order.seller,
        seller: delivery.distributor,
        identityChallenge: delivery.identityChallenge,
        identityCredentialHash: delivery.identityCredentialHash,
        identityValidUntil: delivery.identityValidUntil,
        proposedBatch:
          order.proposedBatch && !/^0x0+$/.test(order.proposedBatch)
            ? order.proposedBatch
            : await this.gateway.read('orders', 'requestedBatch', [orderId]),
      };
      orderId = id(
        `ingredient-delivery-identity:${actualOrderId.toLowerCase()}:${delivery.distributor.toLowerCase()}`,
      );
    }
    if (!same(order.buyer, session.address) && !same(order.seller, session.address))
      throw new OrdersError('NOT_FOUND', 'Order not found.', 404);
    if (!this.flow)
      throw new OrdersError(
        'IDENTITY_UNAVAILABLE',
        'The existing company presentation service is unavailable.',
        503,
      );
    if (input.action === 'request') {
      if (!same(order.seller, session.address))
        throw new OrdersError(
          'SELLER_REQUIRED',
          'Only the seller may request buyer identity.',
          403,
        );
      if (deliveryIdentity) {
        const previous = await this.repository.findEvidence(orderId);
        const proof = previous?.identityProof;
        if (proof?.status === 'REQUESTED' && proof.expiresAt > Date.now() / 1000) {
          input = {
            ...input,
            purpose: proof.purpose,
            expiresAt: proof.expiresAt,
            requiredClaims: proof.requiredClaims,
            optionalClaims: proof.optionalClaims,
          };
        }
      }
      if (
        !input.purpose ||
        !input.expiresAt ||
        input.expiresAt > Number(order.expiresAt) ||
        input.expiresAt <= Date.now() / 1000
      )
        throw new OrdersError(
          'INVALID_IDENTITY_DEADLINE',
          'Choose a future identity deadline within the order deadline.',
          400,
        );
      const proof = await this.flow.startOrderIdentity(sessionId, {
        ...(deliveryIdentity ? { deliveryOrderId: actualOrderId } : {}),
        orderId,
        seller: order.seller,
        buyer: order.buyer,
        batchId: order.proposedBatch,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
        requiredClaims: input.requiredClaims ?? [],
        optionalClaims: input.optionalClaims ?? [],
        selectiveDisclosure: true,
      });
      if (
        same(order.identityChallenge, id(proof.challenge)) &&
        (!deliveryIdentity || Number(order.identityValidUntil) >= proof.expiresAt)
      )
        return proof.referenceTransaction
          ? { transaction: proof.referenceTransaction }
          : { state: 'COMPLETE', status: 'REQUESTED' };
      const transaction =
        identityContract === 'custody-offer'
          ? undefined
          : await this.gateway.prepare(
              session.address,
              deliveryIdentity ? identityContract : 'orders',
              deliveryIdentity ? 'act' : 'requestIdentity',
              deliveryIdentity
                ? deliveryArgs(session.address, 4, actualOrderId, {
                    challenge: id(proof.challenge),
                    validUntil: proof.expiresAt,
                  })
                : [
                    actualOrderId,
                    id(proof.challenge),
                    id(input.purpose),
                    id(
                      JSON.stringify({
                        required: input.requiredClaims,
                        optional: input.optionalClaims,
                      }),
                    ),
                    proof.expiresAt,
                    !!input.required,
                  ],
            );
      return {
        transaction: transaction
          ? {
              ...transaction,
              ...(proof.referenceTransaction
                ? { nextTransactions: [proof.referenceTransaction] }
                : {}),
            }
          : proof.referenceTransaction,
      };
    }
    if (input.action === 'material')
      return this.flow.getCompanyIdentityProofMaterial(sessionId, orderId);
    if (input.action === 'reject')
      return this.flow.rejectCompanyIdentityProof(sessionId, orderId, input.reason ?? '');
    if (input.action === 'status') {
      try {
        return await this.flow.getCompanyIdentityProofStatus(sessionId, orderId);
      } catch (error) {
        if ((error as { code?: string }).code === 'REQUEST_NOT_FOUND')
          return { status: 'NOT_REQUESTED' };
        throw error;
      }
    }
    if (input.action === 'verify') {
      const proof = await this.flow.orderIdentityAttestation(sessionId, orderId);
      if (identityContract === 'custody-offer')
        return { state: 'COMPLETE', checks: proof.checks, transaction: proof.referenceTransaction };
      if (
        same(order.identityCredentialHash, proof.credentialHash) &&
        same(order.identityChallenge, proof.challengeHash) &&
        Number(order.identityValidUntil) >= proof.expiresAt
      )
        return { state: 'COMPLETE', checks: proof.checks, transaction: proof.referenceTransaction };
      return {
        checks: proof.checks,
        transaction: {
          ...(await this.gateway.prepare(
            session.address,
            deliveryIdentity ? identityContract : 'orders',
            deliveryIdentity ? 'act' : 'attestIdentity',
            deliveryIdentity
              ? deliveryArgs(session.address, 5, actualOrderId, {
                  challenge: proof.challengeHash,
                  credentialHash: proof.credentialHash,
                  presentationHash: proof.presentationHash,
                  presentationCid: proof.presentationCid,
                  validUntil: proof.expiresAt,
                })
              : [
                  actualOrderId,
                  proof.challengeHash,
                  proof.credentialHash,
                  proof.presentationHash,
                  proof.expiresAt,
                  proof.presentationCid,
                ],
          )),
          ...(proof.referenceTransaction ? { nextTransactions: [proof.referenceTransaction] } : {}),
        },
      };
    }
    await this.flow.getCompanyIdentityProofStatus(sessionId, orderId);
    if (!same(order.buyer, session.address))
      throw new OrdersError('BUYER_REQUIRED', 'Only the buyer may present or decline.', 403);
    return input.action === 'present'
      ? this.flow.presentCompanyIdentityProof(sessionId, orderId, input.presentation!)
      : this.flow.declineCompanyIdentityProof(sessionId, orderId);
  }
  async session(sessionId?: string) {
    const session = await this.authorizedSession(sessionId);
    try {
      await this.gateway.assertDeployment?.();
    } catch {
      throw new OrdersError(
        'ORDER_DEPLOYMENT_UNAVAILABLE',
        'The order ledger could not be verified. Check the RPC and match the contract addresses to the same deployment journal.',
        503,
      );
    }
    return session;
  }
  private async authorizedSession(sessionId?: string) {
    const session = await this.auth.getSession(sessionId, { includeCompanyIdentity: false });
    assertAuthorizationAvailable(session);
    if (!session.authenticated || !session.authorizationReady || !session.address)
      throw new OrdersError(
        'AUTHORIZATION_REQUIRED',
        'Sign in with an active authorized company wallet.',
        403,
      );
    return session;
  }
  private async privateRecord(key: string, actor: string, value: unknown) {
    const serialized = JSON.stringify(this.bindPrivateValue(key, actor, value));
    const contentHash = `0x${createHash('sha256').update(serialized).digest('hex')}`;
    const existing = await this.repository.findPrivate('products', key);
    if (existing) {
      if (existing.contentHash !== contentHash || !same(existing.owner, actor))
        throw new OrdersError(
          'OPERATION_CONFLICT',
          'This operation ID was already used for different values.',
        );
      return existing;
    }
    const encrypted = await this.store.encryptAndStore(serialized, key);
    const record = {
      id: key,
      owner: actor,
      contentHash,
      cid: encrypted.cid,
      payload: encrypted.payload,
    };
    await this.repository.savePrivate('products', record);
    return record;
  }
  private async replacePresentationRecord(key: string, actor: string, value: unknown) {
    const existing = await this.repository.findPrivate('products', key);
    if (existing && !same(existing.owner, actor))
      throw new OrdersError(
        'PRESENTATION_OWNER_REQUIRED',
        'This presentation record is not yours.',
        403,
      );
    const serialized = JSON.stringify(this.bindPrivateValue(key, actor, value));
    const contentHash = `0x${createHash('sha256').update(serialized).digest('hex')}`;
    if (existing?.contentHash === contentHash) return existing;
    const encrypted = await this.store.encryptAndStore(serialized, key);
    const record = {
      id: key,
      owner: actor,
      contentHash,
      cid: encrypted.cid,
      payload: encrypted.payload,
    };
    await this.repository.savePrivate('products', record);
    return record;
  }

  private bindPrivateValue(key: string, actor: string, value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return {
      ...(value as Record<string, unknown>),
      tracechainBinding: {
        chainId: this.gateway.chainId,
        contractAddress: this.gateway.address.toLowerCase(),
        owner: getAddress(actor),
        recordId: key.toLowerCase(),
        version: 1,
      },
    };
  }

  private async readPrivateRecord(input: {
    cid?: string;
    contentHash?: string;
    id: string;
    owner?: string;
  }) {
    if (!input.contentHash || same(input.contentHash, ZeroHash)) return undefined;
    const local = await this.repository.findPrivate('products', input.id);
    let serialized: string;
    let localRecord = false;
    if (
      local &&
      same(local.contentHash, input.contentHash) &&
      (!input.owner || same(local.owner, input.owner)) &&
      (!input.cid || local.cid === input.cid)
    ) {
      serialized = await this.store.decrypt(local.payload);
      localRecord = true;
    } else {
      if (!input.cid || !this.store.retrieveAndDecrypt)
        throw new OrdersError(
          'LEGACY_RECORD_NOT_MIGRATED',
          'This confirmed record has not been migrated to discoverable encrypted storage.',
          409,
        );
      try {
        serialized = await this.store.retrieveAndDecrypt(input.cid);
      } catch (error) {
        throw new OrdersError(
          'ENCRYPTED_RECORD_UNAVAILABLE',
          'The encrypted record could not be downloaded or decrypted.',
          503,
        );
      }
    }
    const calculated = `0x${createHash('sha256').update(serialized).digest('hex')}`;
    const value = JSON.parse(serialized) as Record<string, unknown>;
    const binding = value.tracechainBinding as Record<string, unknown> | undefined;
    if ((!localRecord || binding) && !same(calculated, input.contentHash))
      throw new OrdersError(
        'ENCRYPTED_RECORD_INTEGRITY_MISMATCH',
        'The encrypted record does not match its blockchain hash.',
        409,
      );
    if (binding) {
      if (
        Number(binding.chainId) !== this.gateway.chainId ||
        String(binding.contractAddress).toLowerCase() !== this.gateway.address.toLowerCase() ||
        String(binding.recordId).toLowerCase() !== input.id.toLowerCase() ||
        (input.owner && !same(String(binding.owner), input.owner))
      )
        throw new OrdersError(
          'ENCRYPTED_RECORD_BINDING_MISMATCH',
          'The encrypted record belongs to a different deployment, record, or participant.',
          409,
        );
    } else if (!localRecord) {
      throw new OrdersError(
        'LEGACY_RECORD_NOT_MIGRATED',
        'This legacy record must be migrated before another API can trust it.',
        409,
      );
    }
    return value;
  }

  private async readOptionalPrivateRecord(input: {
    cid?: string;
    contentHash?: string;
    id: string;
    owner?: string;
  }) {
    try {
      return await this.readPrivateRecord(input);
    } catch (error) {
      if (error instanceof OrdersError && error.code === 'LEGACY_RECORD_NOT_MIGRATED')
        return undefined;
      throw error;
    }
  }

  async updateIngredientImage(
    sessionId: string | undefined,
    batchId: string,
    input: CatalogueImageInput,
  ) {
    const session = await this.session(sessionId);
    if (session.role !== CompanyRole.SUPPLIER)
      throw new OrdersError(
        'INGREDIENT_OWNER_REQUIRED',
        'Only a Supplier can manage ingredient images.',
        403,
      );
    const batch = await this.gateway.read('ingredients', 'getBatch', [batchId]);
    if (!same(batch.supplier, session.address))
      throw new OrdersError(
        'INGREDIENT_OWNER_REQUIRED',
        'Only this ingredient’s Supplier can replace its image.',
        403,
      );
    const image = validateImage(input);
    const record = await this.replacePresentationRecord(
      mediaKey('ingredient', batchId),
      session.address,
      image,
    );
    const current = await this.gateway.read('ingredients', 'getMedia', [batchId]);
    return {
      actorWallet: session.address,
      image: {
        height: image.height,
        mimeType: image.mimeType,
        path: `/catalogue/ingredients/${batchId}/image`,
        supplierProvided: true,
        width: image.width,
      },
      state:
        same(current.contentHash, record.contentHash) && current.encryptedCid === record.cid
          ? ('COMPLETE' as const)
          : ('TRANSACTION_REQUIRED' as const),
      transaction:
        same(current.contentHash, record.contentHash) && current.encryptedCid === record.cid
          ? undefined
          : await this.gateway.prepare(session.address, 'ingredients', 'updateMedia', [
              batchId,
              record.contentHash,
              record.cid,
            ]),
    };
  }

  async updateProductImage(
    sessionId: string | undefined,
    batchId: string,
    input: CatalogueImageInput,
  ) {
    const session = await this.session(sessionId);
    if (session.role !== CompanyRole.MANUFACTURER)
      throw new OrdersError(
        'PRODUCT_OWNER_REQUIRED',
        'Only a Manufacturer can manage product images.',
        403,
      );
    const product = await this.gateway.read('products', 'getProduct', [batchId]);
    if (!same(product.manufacturer, session.address))
      throw new OrdersError(
        'PRODUCT_OWNER_REQUIRED',
        'Only this product’s Manufacturer can replace its image.',
        403,
      );
    const image = validateImage(input);
    const record = await this.replacePresentationRecord(
      mediaKey('product', batchId),
      session.address,
      image,
    );
    const current = await this.gateway.read('products', 'getMedia', [batchId]);
    return {
      actorWallet: session.address,
      image: {
        height: image.height,
        manufacturerProvided: true,
        mimeType: image.mimeType,
        path: `/catalogue/products/${batchId}/image`,
        width: image.width,
      },
      state:
        same(current.contentHash, record.contentHash) && current.encryptedCid === record.cid
          ? ('COMPLETE' as const)
          : ('TRANSACTION_REQUIRED' as const),
      transaction:
        same(current.contentHash, record.contentHash) && current.encryptedCid === record.cid
          ? undefined
          : await this.gateway.prepare(session.address, 'products', 'updateMedia', [
              batchId,
              record.contentHash,
              record.cid,
            ]),
    };
  }

  async updateCompanyLogo(
    sessionId: string | undefined,
    targetWallet: string,
    input: CatalogueImageInput,
  ) {
    const session = await this.authorizedSession(sessionId);
    if (!same(getAddress(targetWallet), session.address))
      throw new OrdersError(
        'COMPANY_BRANDING_OWNER_REQUIRED',
        'You can update only your own company logo.',
        403,
      );
    const identity = await this.directory?.resolve(session.address);
    if (!identity)
      throw new OrdersError(
        'COMPANY_IDENTITY_REQUIRED',
        'A current verified company identity is required.',
        403,
      );
    const image = validateImage(input);
    const record = await this.replacePresentationRecord(
      mediaKey('company', session.address),
      session.address,
      image,
    );
    const current = await this.gateway.read('stakeholders', 'getCompanyBranding', [
      session.address,
    ]);
    return {
      actorWallet: session.address,
      branding: {
        companyName: identity.companyName,
        logoPath: `/branding/${getAddress(session.address)}/logo`,
        role: identity.role,
        companyProvided: true,
      },
      state:
        same(current.contentHash, record.contentHash) && current.encryptedCid === record.cid
          ? ('COMPLETE' as const)
          : ('TRANSACTION_REQUIRED' as const),
      transaction:
        same(current.contentHash, record.contentHash) && current.encryptedCid === record.cid
          ? undefined
          : await this.gateway.prepare(session.address, 'stakeholders', 'updateCompanyBranding', [
              record.contentHash,
              record.cid,
            ]),
    };
  }

  validatePendingCompanyLogo(logo: CatalogueImageInput) {
    const image = validateImage(logo);
    return { image, logoDigest: id(`${image.mimeType}:${image.data}`) };
  }

  async savePendingCompanyLogo(input: {
    applicationId: string;
    applicantWallet: string;
    image: StoredCatalogueImage;
  }) {
    const applicantWallet = getAddress(input.applicantWallet);
    await this.replacePresentationRecord(
      pendingCompanyLogoKey(input.applicationId),
      applicantWallet,
      {
        version: 1,
        applicationId: input.applicationId.toLowerCase(),
        applicantWallet,
        image: input.image,
      },
    );
  }

  async hasPendingCompanyLogo(applicationId: string, applicantWallet: string) {
    return Boolean(await this.pendingCompanyLogoRecord(applicationId, applicantWallet));
  }

  async pendingCompanyLogo(applicationId: string, applicantWallet: string) {
    const record = await this.pendingCompanyLogoRecord(applicationId, applicantWallet);
    if (!record) throw new OrdersError('MEDIA_NOT_FOUND', 'Company logo was not found.', 404);
    const stored = await this.decodeCompanyLogo(record, true);
    return {
      ...stored,
      fileName: `company-${createHash('sha256').update(applicationId.toLowerCase()).digest('hex').slice(0, 16)}.${extensionFor(stored.mimeType)}`,
    };
  }

  async myBranding(sessionId: string | undefined) {
    const session = await this.authorizedSession(sessionId);
    const identity = await this.directory?.resolve(session.address);
    if (!identity)
      throw new OrdersError(
        'COMPANY_IDENTITY_REQUIRED',
        'A current verified company identity is required.',
        403,
      );
    const logo = await this.hasCompanyLogo(session.address, identity.applicationId);
    return {
      branding: {
        companyName: identity.companyName,
        logoPath: logo ? `/branding/${getAddress(session.address)}/logo` : undefined,
        role: identity.role,
      },
    };
  }

  async catalogueMedia(
    sessionId: string | undefined,
    kind: 'company' | 'ingredient' | 'product',
    reference: string,
  ) {
    await this.authorizedSession(sessionId);
    let owner: string;
    if (kind === 'company') {
      owner = getAddress(reference);
      const identity = await this.directory?.resolve(owner);
      if (!identity)
        throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
      const logo = await this.readCompanyLogo(owner, identity.applicationId);
      if (!logo) throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
      try {
        return {
          bytes: logo.bytes,
          contentHash: logo.contentHash,
          fileName: logo.fileName,
          mimeType: logo.mimeType,
        };
      } catch (error) {
        if (error instanceof OrdersError) throw error;
        throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
      }
    } else if (kind === 'ingredient') {
      const batch = await this.gateway.read('ingredients', 'getBatch', [reference]);
      owner = batch.supplier;
    } else {
      const product = await this.gateway.read('products', 'getProduct', [reference]);
      owner = product.manufacturer;
    }
    const media = await this.gateway.read(
      kind === 'ingredient' ? 'ingredients' : 'products',
      'getMedia',
      [reference],
    );
    if (!media || same(media.contentHash, ZeroHash))
      throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
    try {
      const stored = decodeStoredCatalogueImage(
        await this.readPrivateRecord({
          cid: media.encryptedCid,
          contentHash: media.contentHash,
          id: mediaKey(kind, reference),
          owner,
        }),
      );
      return {
        bytes: stored.bytes,
        contentHash: media.contentHash,
        fileName: `${kind}-${createHash('sha256').update(reference.toLowerCase()).digest('hex').slice(0, 16)}.${extensionFor(stored.mimeType)}`,
        mimeType: stored.mimeType,
      };
    } catch (error) {
      if (error instanceof OrdersError) throw error;
      throw new OrdersError(
        'MEDIA_UNAVAILABLE',
        'The recorded catalogue image could not be loaded.',
        503,
      );
    }
  }

  private async pendingCompanyLogoRecord(applicationId: string, applicantWallet: string) {
    const record = await this.repository.findPrivate(
      'products',
      pendingCompanyLogoKey(applicationId),
    );
    return record && same(record.owner, applicantWallet) ? record : undefined;
  }

  private async companyLogoRecord(wallet: string, applicationId?: string) {
    const active = await this.repository.findPrivate('products', mediaKey('company', wallet));
    if (active && same(active.owner, wallet)) return active;
    return applicationId ? this.pendingCompanyLogoRecord(applicationId, wallet) : undefined;
  }

  private async readCompanyLogo(wallet: string, applicationId?: string) {
    const branding = await this.optionalRead('stakeholders', 'getCompanyBranding', [wallet]);
    if (branding && !same(branding.contentHash, ZeroHash)) {
      const stored = decodeStoredCatalogueImage(
        await this.readPrivateRecord({
          cid: branding.encryptedCid,
          contentHash: branding.contentHash,
          id: mediaKey('company', wallet),
          owner: wallet,
        }),
      );
      return {
        bytes: stored.bytes,
        contentHash: branding.contentHash,
        fileName: `company-${createHash('sha256').update(wallet.toLowerCase()).digest('hex').slice(0, 16)}.${extensionFor(stored.mimeType)}`,
        mimeType: stored.mimeType,
      };
    }
    const record = await this.companyLogoRecord(wallet, applicationId);
    if (record) {
      const stored = await this.decodeCompanyLogo(
        record,
        record.id !== mediaKey('company', wallet),
      );
      return {
        bytes: stored.bytes,
        contentHash: record.contentHash,
        fileName: `company-${createHash('sha256').update(wallet.toLowerCase()).digest('hex').slice(0, 16)}.${extensionFor(stored.mimeType)}`,
        mimeType: stored.mimeType,
      };
    }
    return applicationId ? this.applicationLogos?.read(applicationId, wallet) : undefined;
  }

  private async hasCompanyLogo(wallet: string, applicationId?: string) {
    return Boolean(await this.readCompanyLogo(wallet, applicationId));
  }

  private async decodeCompanyLogo(
    record: Awaited<ReturnType<ProductionFlowRepository['findPrivate']>>,
    pending = false,
  ) {
    if (!record) throw new OrdersError('MEDIA_NOT_FOUND', 'Company logo was not found.', 404);
    const stored = JSON.parse(await this.store.decrypt(record.payload));
    const image = pending || stored?.image ? stored.image : stored;
    return decodeStoredCatalogueImage(image);
  }
  async state(
    sessionId?: string,
    scope?: 'supplier-inventory' | 'shipment-workspace' | 'custody-inventory' | 'catalogue',
    detailOrderId?: string,
    refresh = false,
  ) {
    const session = await this.session(sessionId);
    // Page display only; actions re-read the live chain outside this wrapper.
    const display = <T>(build: () => Promise<T>) =>
      this.gateway.display ? this.gateway.display(build, refresh) : build();
    if (scope === 'shipment-workspace' || scope === 'custody-inventory' || scope === 'catalogue') {
      const key = `${this.gateway.chainId}:${this.gateway.address.toLowerCase()}:${session.address.toLowerCase()}:${session.role}:${scope}`;
      const snapshot = await this.displaySnapshots.get(
        key,
        () =>
          display<ChainRecord & { shipments: ChainRecord[] }>(() =>
            scope === 'custody-inventory'
              ? this.custodyInventory(session)
              : this.buildState(session, scope),
          ),
        refresh,
      );
      return { ...snapshot.value, readModel: snapshot.readModel };
    }
    return display(() => this.buildState(session, scope, detailOrderId));
  }

  private async custodyInventory(session: Awaited<ReturnType<OrdersService['session']>>) {
    const actor = session.address;
    const admin = session.role === CompanyRole.SYSTEM_ADMIN;
    if (
      ![
        CompanyRole.SUPPLIER,
        CompanyRole.MANUFACTURER,
        CompanyRole.DISTRIBUTOR,
        CompanyRole.SYSTEM_ADMIN,
      ].includes(session.role!)
    )
      throw new OrdersError(
        'INVENTORY_UNAVAILABLE',
        'Your role does not have custody inventory.',
        403,
      );
    const warehouseSupported = Number(await this.optionalRead('delivery', 'custodyPolicy')) === 1;
    const logistics = warehouseSupported
      ? await readLogistics(
          this.gateway,
          actor,
          admin,
          false,
          false,
          false,
          'inventory',
          session.role === CompanyRole.SUPPLIER
            ? 'ingredient'
            : session.role === CompanyRole.MANUFACTURER
              ? 'product'
              : undefined,
        )
      : { warehouses: [], positions: [], shipments: [], productStock: [], productPositions: [] };
    // readLogistics can see public chain records; only return this company's inventory.
    logistics.positions = logistics.positions.filter(
      (p) =>
        admin ||
        (session.role === CompanyRole.DISTRIBUTOR
          ? same(p.distributor, actor)
          : session.role === CompanyRole.SUPPLIER && same(p.supplier, actor)),
    );
    const batches = new Map<string, { kind: number; batch: ChainRecord }>();
    for (const p of logistics.positions)
      if (!batches.has(p.batchId))
        batches.set(p.batchId, { kind: 1, batch: await this.catalogueBatch(1, p.batchId) });
    const productPositions: ChainRecord[] = [];
    for (const p of logistics.productPositions) {
      const batch = batches.get(p.batchId)?.batch ?? (await this.catalogueBatch(2, p.batchId));
      if (
        !admin &&
        !(session.role === CompanyRole.DISTRIBUTOR && same(p.distributor, actor)) &&
        !(session.role === CompanyRole.MANUFACTURER && same(batch.manufacturer, actor))
      )
        continue;
      batches.set(p.batchId, { kind: 2, batch });
      productPositions.push({ ...p, quantity: p.available, unit: this.batchUnit(batch.unit) });
    }
    logistics.productPositions = productPositions;
    if (session.role === CompanyRole.DISTRIBUTOR || admin) {
      for (const p of logistics.productStock)
        if (!batches.has(p.batchId))
          batches.set(p.batchId, { kind: 2, batch: await this.catalogueBatch(2, p.batchId) });
    } else logistics.productStock = [];
    const catalogue = await Promise.all(
      [...batches].map(async ([batchId, { kind, batch }]) => ({
        ...(await this.discoverBatch(kind, batchId, batch)),
        kind,
        seller: kind === 1 ? batch.supplier : batch.manufacturer,
        batches: [batchId],
        unit: this.batchUnit(batch.unit),
        active: Number(batch.status) === 1 && Number(batch.expiresAt) > Date.now() / 1000,
        batchDetails: [{ batchId, ...batch }],
      })),
    );
    const wallets = [
      ...new Set([
        actor,
        ...catalogue.map((i) => i.seller),
        ...logistics.positions.flatMap((p) => [p.supplier, p.distributor]),
        ...productPositions.map((p) => p.distributor),
      ]),
    ];
    const identities = (await this.directory?.resolveMany(wallets)) ?? [];
    const name = (wallet: string) =>
      identities.find((i) => same(i.walletAddress, wallet))?.companyName;
    return {
      actor,
      role: session.role,
      chainId: this.gateway.chainId,
      ordersAddress: this.gateway.address,
      warehouseSupported,
      orders: [],
      shipments: [],
      locations: [],
      catalogue: catalogue.map((i) => ({ ...i, sellerName: name(i.seller) })),
      logistics: {
        ...logistics,
        positions: logistics.positions.map((p) => ({
          ...p,
          supplierName: name(p.supplier),
          distributorName: name(p.distributor),
        })),
        productPositions: productPositions.map((p) => ({
          ...p,
          distributorName: name(p.distributor),
        })),
      },
    };
  }

  private async buildState(
    session: Awaited<ReturnType<OrdersService['session']>>,
    scope?: 'supplier-inventory' | 'shipment-workspace' | 'catalogue',
    detailOrderId?: string,
  ) {
    const shipmentOnly = scope === 'shipment-workspace';
    // Catalogue display only: skip order, shipment, transfer, logistics and location reads.
    // Distributor catalogue visibility is derived from those records, so it keeps the full build.
    const catalogueOnly = scope === 'catalogue' && session.role !== CompanyRole.DISTRIBUTOR;
    const detailOrder = detailOrderId
      ? await this.gateway.read('orders', 'getOrder', [detailOrderId])
      : undefined;
    const detailBatches = new Set<string>();
    if (detailOrderId && detailOrder) {
      if (
        !same(detailOrder.buyer, session.address) &&
        !same(detailOrder.seller, session.address) &&
        session.role !== CompanyRole.SYSTEM_ADMIN
      ) {
        if (session.role !== CompanyRole.DISTRIBUTOR)
          throw new OrdersError('NOT_FOUND', 'This order is not available to your company.', 404);
        const [ingredient, product] = await Promise.all([
          this.optionalRead('delivery', 'get', [detailOrderId]),
          this.optionalRead('productDelivery', 'get', [detailOrderId]),
        ]);
        if (
          !same(ingredient?.distributor, session.address) &&
          !same(product?.distributor, session.address)
        )
          throw new OrdersError('NOT_FOUND', 'This order is not available to your company.', 404);
      }
      detailBatches.add(String(detailOrder.proposedBatch));
      const requested = await this.optionalRead('orders', 'requestedBatch', [detailOrderId]);
      if (requested) detailBatches.add(String(requested));
    }
    const inventoryOnly = scope === 'supplier-inventory';
    if (inventoryOnly && session.role !== CompanyRole.SUPPLIER)
      throw new OrdersError(
        'SUPPLIER_REQUIRED',
        'Only Suppliers can view their ingredient inventory.',
        403,
      );
    const [
      listings,
      orderEvents,
      locations,
      shipmentEvents,
      transferEvents,
      inventoryInitializationEvents,
    ] = await Promise.all([
      this.gateway
        .events('orders', 'ItemListed')
        .then((events) =>
          detailOrder ? events.filter((e) => same(e.itemId, detailOrder.itemId)) : events,
        ),
      catalogueOnly
        ? []
        : this.gateway
            .events('orders', 'OrderRequested')
            .then((events) =>
              detailOrderId ? events.filter((e) => same(e.orderId, detailOrderId)) : events,
            ),
      inventoryOnly || catalogueOnly ? [] : this.gateway.events('orders', 'LocationRegistered'),
      inventoryOnly || catalogueOnly ? [] : this.gateway.events('orders', 'ShipmentDispatched'),
      inventoryOnly || catalogueOnly ? [] : this.gateway.events('custody', 'OrderTransferLinked'),
      inventoryOnly || catalogueOnly ? [] : this.gateway.events('custody', 'InventoryInitialized'),
    ]);
    // Deployment policy flags are independent reads; fetch them together.
    const [
      approvedPolicy,
      ingredientPolicy,
      custodyPolicy,
      reviewPolicy,
      fulfilmentPolicy,
      productPolicy,
    ] = await Promise.all([
      this.optionalRead('orders', 'approvedReceiptPolicy'),
      this.optionalRead('orders', 'ingredientDeliveryPolicy'),
      this.optionalRead('delivery', 'custodyPolicy'),
      inventoryOnly ? undefined : this.optionalRead('delivery', 'reviewPolicy'),
      inventoryOnly ? undefined : this.optionalRead('delivery', 'fulfilmentPolicy'),
      inventoryOnly ? undefined : this.optionalRead('custody', 'productDeliveryPolicy'),
    ]);
    const approvedReceiptsSupported = Number(approvedPolicy) === 1;
    const ingredientDeliverySupported = Number(ingredientPolicy) === 1;
    const warehouseSupported = ingredientDeliverySupported && Number(custodyPolicy) === 1;
    const shipmentReviewSupported =
      !inventoryOnly && warehouseSupported && Number(reviewPolicy) === 1;
    const fulfilmentSupported =
      !inventoryOnly && warehouseSupported && Number(fulfilmentPolicy) === 2;
    const productDeliverySupported = !inventoryOnly && Number(productPolicy) === 1;
    const logistics =
      warehouseSupported && !catalogueOnly
        ? await readLogistics(
            this.gateway,
            session.address,
            session.role === CompanyRole.SYSTEM_ADMIN,
            shipmentReviewSupported,
            productDeliverySupported,
            inventoryOnly,
            shipmentOnly ? 'shipments' : 'workspace',
          )
        : undefined;
    const focusedOrders = new Map<string, ChainRecord>();
    const focusedBatches = new Set<string>();
    if (shipmentOnly) {
      // Resolve only batches used by this company's orders, rather than the whole catalogue.
      const focused = await Promise.all(
        orderEvents.map(async (event) => {
          if (
            session.role !== CompanyRole.SYSTEM_ADMIN &&
            session.role !== CompanyRole.DISTRIBUTOR &&
            event.buyer &&
            event.seller &&
            !same(event.buyer, session.address) &&
            !same(event.seller, session.address)
          )
            return undefined;
          const order = await this.gateway.read('orders', 'getOrder', [event.orderId]);
          if (
            !same(order.buyer, session.address) &&
            !same(order.seller, session.address) &&
            session.role !== CompanyRole.SYSTEM_ADMIN
          ) {
            if (session.role !== CompanyRole.DISTRIBUTOR) return undefined;
            const [ingredient, product] = await Promise.all([
              this.optionalRead('delivery', 'get', [event.orderId]),
              this.optionalRead('productDelivery', 'get', [event.orderId]),
            ]);
            if (
              !same(ingredient?.distributor, session.address) &&
              !same(product?.distributor, session.address)
            )
              return undefined;
          }
          const requested = approvedReceiptsSupported
            ? await this.optionalRead('orders', 'requestedBatch', [event.orderId])
            : undefined;
          return { orderId: event.orderId as string, order, requested };
        }),
      );
      for (const entry of focused) {
        if (!entry) continue;
        focusedOrders.set(entry.orderId, entry.order);
        focusedBatches.add(entry.order.proposedBatch);
        if (entry.requested) focusedBatches.add(entry.requested);
      }
      // Include intake and product transfers that do not have a buyer order.
      for (const shipment of logistics?.shipments ?? []) focusedBatches.add(shipment.batchId);
    }
    if (detailOrderId) for (const listing of listings) detailBatches.add(listing.batchId);
    const listedCatalogue = await Promise.all(
      [
        ...new Set(
          listings
            .filter((entry) => !inventoryOnly || same(entry.seller, session.address))
            .filter((entry) => !shipmentOnly || focusedBatches.has(entry.batchId))
            .map((entry) => entry.itemId),
        ),
      ].map(async (itemId) => {
        const item = await this.gateway.read('orders', 'getItem', [itemId]);
        if (
          !detailOrderId &&
          !shipmentOnly &&
          session.role === CompanyRole.MANUFACTURER &&
          Number(item.kind) === 2 &&
          !same(item.seller, session.address)
        )
          return null;
        if (inventoryOnly && (Number(item.kind) !== 1 || !same(item.seller, session.address)))
          return null;
        const batches = [
          ...new Set(
            listings
              .filter(
                (entry) =>
                  entry.itemId === itemId && (!shipmentOnly || focusedBatches.has(entry.batchId)),
              )
              .map((entry) => entry.batchId),
          ),
        ];
        const batchDetails = await Promise.all(
          batches.map(async (batchId) => {
            const batch = await this.gateway.read(
              Number(item.kind) === 1 ? 'ingredients' : 'products',
              Number(item.kind) === 1 ? 'getBatch' : 'getProduct',
              [batchId],
            );
            const inventory =
              Number(item.kind) === 2 && !shipmentOnly && !catalogueOnly
                ? await readProductInventorySnapshot(
                    this.gateway,
                    batchId,
                    batch.manufacturer,
                    batch,
                    inventoryInitializationEvents,
                  )
                : undefined;
            return {
              batchId,
              expiresAt: batch.expiresAt,
              producedAt: batch.producedAt,
              status: batch.status,
              totalQuantity: batch.totalQuantity,
              ...(Number(item.kind) === 1
                ? { supplierAvailable: batch.availableQuantity }
                : {
                    manufacturerAvailable: inventory?.available,
                    producedAt: batch.producedAt,
                    recordedAt: await this.gateway.read('products', 'productionRecordedAt', [
                      batchId,
                    ]),
                    productionLocation: await this.gateway.read('products', 'productionLocation', [
                      batchId,
                    ]),
                    ingredientLinks:
                      shipmentOnly || catalogueOnly
                        ? undefined
                        : await this.gateway.read('products', 'getIngredientLinks', [batchId]),
                  }),
            };
          }),
        );
        return { ...item, itemId, unit: decodeBytes32String(item.unit), batches, batchDetails };
      }),
    );
    const catalogue = listedCatalogue.filter((item) => item !== null);
    for (const kind of inventoryOnly ? [1] : [1, 2]) {
      const events = await this.gateway.events(
        kind === 1 ? 'ingredients' : 'products',
        kind === 1 ? 'IngredientBatchRegistered' : 'ProductCreated',
      );
      // Reads run concurrently; the catalogue is then assembled in event order.
      const reads = await Promise.all(
        events.map(async (event) => {
          if (inventoryOnly && !same(event.supplier, session.address)) return undefined;
          // These products are excluded from the Manufacturer catalogue below; avoid enriching them.
          if (
            !detailOrderId &&
            !shipmentOnly &&
            session.role === CompanyRole.MANUFACTURER &&
            kind === 2 &&
            event.manufacturer &&
            !same(event.manufacturer, session.address)
          )
            return undefined;
          const batchId = event.batchId ?? event.productBatchId;
          if (!batchId) return undefined;
          if (shipmentOnly && !focusedBatches.has(batchId)) return undefined;
          if (detailOrderId && !detailBatches.has(batchId)) return undefined;
          const batch = await this.catalogueBatch(kind, batchId);
          if (
            !detailOrderId &&
            !shipmentOnly &&
            session.role === CompanyRole.MANUFACTURER &&
            kind === 2 &&
            !same(batch.manufacturer, session.address)
          )
            return undefined;
          if (inventoryOnly && !same(batch.supplier, session.address)) return undefined;
          const listed = catalogue.some((entry) => entry.batches.includes(batchId));
          const productReads = kind === 2 && !listed;
          const [summary, inventory, recordedAt, productionLocation, ingredientLinks] =
            await Promise.all([
              this.discoverBatch(kind, batchId, batch),
              productReads && !shipmentOnly && !catalogueOnly
                ? readProductInventorySnapshot(
                    this.gateway,
                    batchId,
                    batch.manufacturer,
                    batch,
                    inventoryInitializationEvents,
                  )
                : undefined,
              productReads
                ? this.gateway.read('products', 'productionRecordedAt', [batchId])
                : undefined,
              productReads
                ? this.gateway.read('products', 'productionLocation', [batchId])
                : undefined,
              productReads && !shipmentOnly && !catalogueOnly
                ? this.gateway.read('products', 'getIngredientLinks', [batchId])
                : undefined,
            ]);
          return {
            event,
            batchId,
            batch,
            summary,
            inventory,
            recordedAt,
            productionLocation,
            ingredientLinks,
          };
        }),
      );
      for (const read of reads) {
        if (!read) continue;
        const {
          event,
          batchId,
          batch,
          summary,
          inventory,
          recordedAt,
          productionLocation,
          ingredientLinks,
        } = read;
        const existing = catalogue.find((entry) => entry.batches.includes(batchId));
        if (existing) {
          (existing as ChainRecord).batchSummaries = {
            ...(existing as ChainRecord).batchSummaries,
            [batchId]: summary,
          };
          Object.assign(existing, summary);
          existing.registeredBlock = Math.max(
            Number(existing.registeredBlock ?? 0),
            Number(event.blockNumber ?? 0),
          );
          existing.active = existing.active && !summary.archived;
          continue;
        }
        catalogue.push({
          itemId: solidityPackedKeccak256(
            ['string', 'uint8', 'bytes32'],
            ['registered:', kind, batchId],
          ),
          seller: kind === 1 ? batch.supplier : batch.manufacturer,
          kind,
          unit: this.batchUnit(batch.unit),
          active:
            Number(batch.status) === 1 &&
            Number(batch.expiresAt) > Date.now() / 1000 &&
            !summary.archived,
          ...summary,
          batchSummaries: { [batchId]: summary },
          registeredBatch: true,
          registeredBlock: Number(event.blockNumber ?? 0),
          batches: [batchId],
          batchDetails: [
            {
              batchId,
              status: batch.status,
              expiresAt: batch.expiresAt,
              producedAt: batch.producedAt,
              totalQuantity: batch.totalQuantity,
              ...(kind === 1
                ? { supplierAvailable: batch.availableQuantity }
                : {
                    manufacturerAvailable: inventory?.available,
                    producedAt: batch.producedAt,
                    recordedAt,
                    productionLocation,
                    ingredientLinks,
                  }),
            },
          ],
        } as any);
      }
    }
    if (inventoryOnly) {
      const actor = session.address;
      const stockOrders = (
        await Promise.all(
          orderEvents.map(async (event): Promise<ChainRecord | undefined> => {
            if (!same(event.seller, actor)) return undefined;
            const order = await this.gateway.read('orders', 'getOrder', [event.orderId]);
            if (!same(order.seller, actor)) return undefined;
            const [
              custody,
              isRequestOnly,
              requestedBatch,
              approvedReceivedQuantity,
              decision,
              delivery,
            ] = await Promise.all([
              warehouseSupported
                ? this.gateway.read('delivery', 'custodyOrders', [event.orderId])
                : undefined,
              this.optionalRead('orders', 'requestOnly', [event.orderId]),
              approvedReceiptsSupported
                ? this.gateway.read('orders', 'requestedBatch', [event.orderId])
                : undefined,
              approvedReceiptsSupported
                ? this.gateway.read('orders', 'approvedReceivedQuantity', [event.orderId])
                : undefined,
              this.optionalRead('orders', 'requestDecision', [event.orderId]),
              ingredientDeliverySupported
                ? this.gateway.read('delivery', 'get', [event.orderId])
                : undefined,
            ]);
            return {
              ...order,
              orderId: event.orderId,
              isRequestOnly,
              requestedBatch,
              approvedReceivedQuantity,
              decision,
              delivery,
              custodyOrder:
                custody &&
                logistics?.positions.some((position) =>
                  same(position.positionId, custody.positionId),
                )
                  ? true
                  : undefined,
            };
          }),
        )
      ).filter((order): order is ChainRecord => order !== undefined);
      const positions =
        logistics?.positions.filter((position) => same(position.supplier, actor)) ?? [];
      const identities =
        (await this.directory?.resolveMany([
          ...new Set([actor, ...positions.map((position) => position.distributor)]),
        ])) ?? [];
      const companyName = (wallet: string) =>
        identities.find((identity) => same(identity.walletAddress, wallet))?.companyName;
      return {
        actor,
        role: session.role,
        chainId: this.gateway.chainId,
        ordersAddress: this.gateway.address,
        catalogue: catalogue.map((item) => ({
          ...item,
          sellerName: companyName(actor),
          custodyPositions: positions
            .filter((position) => item.batches.includes(position.batchId))
            .map((position) => ({
              ...position,
              distributorName: companyName(position.distributor),
              supplierName: companyName(actor),
            })),
        })),
        supplierStock: supplierStock(actor, catalogue, stockOrders, Math.floor(Date.now() / 1000)),
        orders: [],
        shipments: [],
        locations: [],
      };
    }
    const orders: ChainRecord[] = [];
    const shipments: ChainRecord[] = [];
    const actor = session.address;
    const ownsInventory = (position: ChainRecord) =>
      session.role === CompanyRole.SYSTEM_ADMIN ||
      (session.role === CompanyRole.DISTRIBUTOR && same(position.distributor, actor)) ||
      (session.role === CompanyRole.SUPPLIER && same(position.supplier, actor));
    const cataloguePosition = (position: ChainRecord) => {
      if (ownsInventory(position)) return position;
      const {
        positionId,
        batchId,
        distributor,
        location,
        unit,
        available,
        orderable,
        warehouseName,
      } = position;
      return {
        positionId,
        batchId,
        distributor,
        location,
        unit,
        available,
        orderable,
        warehouseName,
      };
    };
    const listingBatches: ChainRecord[] = [];
    const listingKind =
      session.role === CompanyRole.SUPPLIER ? 1 : session.role === CompanyRole.MANUFACTURER ? 2 : 0;
    if (listingKind && !catalogueOnly) {
      const registered = await this.gateway.events(
        listingKind === 1 ? 'ingredients' : 'products',
        listingKind === 1 ? 'IngredientBatchRegistered' : 'ProductCreated',
      );
      const owned = registered.filter(
        (entry) =>
          !(detailOrderId && !detailBatches.has(entry.batchId)) &&
          same(listingKind === 1 ? entry.supplier : entry.manufacturer, actor),
      );
      const ownedBatches = await Promise.all(
        owned.map((entry) => this.catalogueBatch(listingKind, entry.batchId)),
      );
      for (const [index, entry] of owned.entries()) {
        const batch = ownedBatches[index];
        const unit = this.batchUnit(batch.unit);
        const supported = /^[A-Za-z0-9._/-]{1,31}$/.test(unit);
        const active = Number(batch.status) === 1 && Number(batch.expiresAt) > Date.now() / 1000;
        listingBatches.push({
          batchId: entry.batchId,
          unit,
          eligible: supported && active,
          reason: !supported
            ? 'The on-chain unit is not a readable registered unit. Select a batch with a named unit.'
            : !active
              ? 'This batch is inactive or expired.'
              : '',
        });
      }
    }
    const admin = session.role === CompanyRole.SYSTEM_ADMIN;
    const ownTransfers = new Map<string, ChainRecord>();
    const transferRecords = await Promise.all(
      transferEvents.map(async (event) => {
        const [transfer, linkedOrder] = await Promise.all([
          this.gateway.read('custody', 'getTransfer', [event.transferId]),
          this.gateway.read('orders', 'getOrder', [event.orderId]),
        ]);
        if (
          !admin &&
          !same(actor, transfer.sender) &&
          !same(actor, transfer.recipient) &&
          !same(actor, linkedOrder.seller) &&
          !same(actor, linkedOrder.buyer)
        )
          return undefined;
        const [missing, receivedAt, receiptRecordedAt, occurredAt, fromLocation, toLocation] =
          await Promise.all(
            [
              'missingQuantity',
              'receiptOccurredAt',
              'receiptRecordedAt',
              'reportedDispatchAt',
              'dispatchLocation',
              'receivingLocation',
            ].map((method) => this.gateway.read('custody', method, [event.transferId])),
          );
        return {
          ...transfer,
          shipmentId: event.transferId,
          orderId: event.orderId,
          missing,
          receivedAt,
          receiptRecordedAt,
          occurredAt,
          fromLocation,
          toLocation,
          product: true,
        } as ChainRecord;
      }),
    );
    for (const record of transferRecords) if (record) ownTransfers.set(record.shipmentId, record);
    // Orders are read concurrently in dependent phases so each phase batches into few RPC calls.
    const orderRecords = await Promise.all(
      orderEvents.map(async (event) => {
        if (shipmentOnly && !focusedOrders.has(event.orderId)) return undefined;
        const [order, custody, delivery, productDelivery] = await Promise.all([
          focusedOrders.get(event.orderId) ??
            this.gateway.read('orders', 'getOrder', [event.orderId]),
          warehouseSupported
            ? this.gateway.read('delivery', 'custodyOrders', [event.orderId])
            : undefined,
          ingredientDeliverySupported
            ? this.gateway.read('delivery', 'get', [event.orderId])
            : undefined,
          productDeliverySupported
            ? this.gateway.read('productDelivery', 'get', [event.orderId])
            : undefined,
        ]);
        const custodyPosition =
          custody && logistics?.positions.find((entry) => entry.positionId === custody.positionId);
        if (
          delivery &&
          ((Number(delivery.stage) === 1 &&
            Number(delivery.assignmentDeadline) <= Date.now() / 1000) ||
            ([1, 2, 3].includes(Number(delivery.stage)) &&
              (Number(order.expiresAt) <= Date.now() / 1000 || Number(order.status) === 3)))
        ) {
          delivery.chainStage = delivery.stage;
          delivery.stage = '6';
        }
        const involved =
          admin ||
          same(actor, order.buyer) ||
          same(actor, order.seller) ||
          same(actor, delivery?.distributor) ||
          same(actor, productDelivery?.distributor) ||
          same(actor, custodyPosition?.distributor);
        // Private records are only read for orders this company is involved in.
        if (!involved) return undefined;
        const [
          details,
          decision,
          evidenceIds,
          requestedBatch,
          approvedReceivedQuantity,
          isRequestOnly,
          arranged,
        ] = await Promise.all([
          shipmentOnly
            ? undefined
            : this.readOptionalPrivateRecord({
                cid: order.detailsCid,
                contentHash: order.detailsHash,
                id: event.orderId,
                owner: order.buyer,
              }),
          shipmentOnly
            ? this.optionalRead('orders', 'requestDecision', [event.orderId])
            : this.loadRequestDecision(event.orderId, order.seller),
          shipmentOnly
            ? undefined
            : this.gateway.read('orders', 'getOrderEvidence', [event.orderId]),
          approvedReceiptsSupported
            ? this.gateway.read('orders', 'requestedBatch', [event.orderId])
            : undefined,
          approvedReceiptsSupported
            ? this.gateway.read('orders', 'approvedReceivedQuantity', [event.orderId])
            : undefined,
          this.optionalRead('orders', 'requestOnly', [event.orderId]),
          custodyPosition && shipmentReviewSupported
            ? this.gateway.read('delivery', 'deliveryArranged', [event.orderId])
            : false,
        ]);
        const deliveryReceivingLocation =
          typeof details?.receivingLocation === 'string' &&
          same(
            await this.gateway.read('orders', 'locationOwner', [details.receivingLocation]),
            order.buyer,
          )
            ? details.receivingLocation
            : undefined;
        const distributorView =
          same(actor, delivery?.distributor) ||
          same(actor, custodyPosition?.distributor) ||
          same(actor, productDelivery?.distributor);
        return {
          custodyOrder: custodyPosition
            ? {
                ...custody,
                ...cataloguePosition(custodyPosition),
                positionId: custody.positionId,
                quantity: custody.quantity,
                arranged,
              }
            : undefined,
          ...order,
          deliveryReceivingLocation: shipmentOnly
            ? (productDelivery?.toLocation ?? delivery?.toLocation ?? custody?.receivingLocation)
            : deliveryReceivingLocation,
          productDelivery:
            productDelivery && Number(productDelivery.mode) > 0 ? productDelivery : undefined,
          productDeliveryQr:
            productDelivery && Number(productDelivery.mode) > 0
              ? this.productOrderQr(event.orderId)
              : undefined,
          orderId: event.orderId,
          details: distributorView ? undefined : details,
          delivery: delivery && Number(delivery.stage) > 0 ? delivery : undefined,
          evidenceIds,
          decision:
            (distributorView || shipmentOnly) && decision
              ? { status: decision.status, recordedAt: decision.recordedAt }
              : decision,
          requestedBatch,
          approvedReceivedQuantity,
          isRequestOnly,
        } as ChainRecord;
      }),
    );
    for (const record of orderRecords) if (record) orders.push(record);
    const visibleOrderIds = new Set(orders.map((order) => order.orderId));
    const shipmentRecords = await Promise.all(
      shipmentEvents.map(async (event): Promise<ChainRecord | undefined> => {
        const shipment = await this.gateway.read('orders', 'getShipment', [event.shipmentId]);
        if (!visibleOrderIds.has(event.orderId) && !same(actor, shipment.recipient))
          return undefined;
        const item = catalogue.find(
          (item) => item.itemId === orders.find((order) => order.orderId === event.orderId)?.itemId,
        );
        if (Number(item?.kind) === 2 || ownTransfers.has(event.shipmentId)) {
          const [transfer, missing] = await Promise.all([
            this.gateway.read('custody', 'getTransfer', [event.shipmentId]),
            this.gateway.read('custody', 'missingQuantity', [event.shipmentId]),
          ]);
          return {
            ...shipment,
            ...transfer,
            ...ownTransfers.get(event.shipmentId),
            shipmentId: event.shipmentId,
            missing,
            product: true,
          };
        }
        const stock = await this.gateway.read('ingredients', 'getReceivedStock', [
          shipment.batchId,
          shipment.recipient,
          shipment.toLocation,
        ]);
        return { ...shipment, shipmentId: event.shipmentId, product: false, stock };
      }),
    );
    for (const record of shipmentRecords) if (record) shipments.push(record);
    for (const [key, transfer] of ownTransfers)
      if (!shipments.some((shipment) => shipment.shipmentId === key)) shipments.push(transfer);
    const safeLocations = await Promise.all(
      locations.map(async (location) => {
        if (
          !same(actor, location.company) &&
          !orders.some(
            (order) =>
              order.custodyOrder?.receivingLocation === location.location ||
              order.deliveryReceivingLocation === location.location ||
              [order.delivery?.fromLocation, order.delivery?.toLocation].includes(
                location.location,
              ),
          ) &&
          !shipments.some((s) => [s.fromLocation, s.toLocation].includes(location.location))
        )
          return { location: location.location, company: location.company };
        const locationDetails = await this.readOptionalPrivateRecord({
          cid: location.detailsCid,
          contentHash: location.detailsHash,
          id: location.location,
          owner: location.company,
        });
        const label = locationDetails?.label ?? 'Location label unavailable';
        return {
          location: location.location,
          company: location.company,
          address: await this.locationAddress(
            location.location,
            location.company,
            location.detailsHash,
          ),
          label: (await this.locationAlias(location.location, location.company)) ?? label,
        };
      }),
    );
    const wallets = [
      ...new Set([
        ...catalogue.map((item) => item.seller),
        ...orders.flatMap((order) => [
          order.buyer,
          order.seller,
          ...(order.delivery?.distributor ? [order.delivery.distributor] : []),
        ]),
        ...shipments.flatMap((shipment) => [shipment.sender, shipment.recipient]),
        ...(logistics?.shipments.flatMap((shipment) => [shipment.sender, shipment.recipient]) ??
          []),
        ...(logistics?.warehouses.map((warehouse) => warehouse.distributor) ?? []),
        ...(logistics?.positions.flatMap((position) => [position.distributor, position.supplier]) ??
          []),
      ]),
    ];
    const directoryCompanies =
      shipmentOnly || catalogueOnly ? [] : ((await this.directory?.list()) ?? []);
    const identities =
      (await this.directory?.resolveMany([
        ...new Set([...wallets, ...directoryCompanies.map((company) => company.walletAddress)]),
      ])) ?? [];
    const name = (wallet: string) =>
      identities.find((identity) => same(identity.walletAddress, wallet))?.companyName;
    const role = (wallet: string) =>
      identities.find((identity) => same(identity.walletAddress, wallet))?.role;
    const logoWallets = new Set<string>();
    await Promise.all(
      (shipmentOnly ? [] : identities).map(async (identity) => {
        const logo = await this.hasCompanyLogo(identity.walletAddress, identity.applicationId);
        if (logo) logoWallets.add(identity.walletAddress.toLowerCase());
      }),
    );
    return {
      actor,
      listingBatches,
      approvedReceiptsSupported,
      ingredientDeliverySupported,
      warehouseSupported,
      fulfilmentSupported,
      productDeliverySupported,
      shipmentReviewSupported,
      logistics: logistics
        ? {
            ...logistics,
            warehouses: logistics.warehouses.map((warehouse) => ({
              ...warehouse,
              distributorName: name(warehouse.distributor),
            })),
            productPositions: logistics.productPositions
              .filter(
                (position) =>
                  session.role === CompanyRole.SYSTEM_ADMIN ||
                  same(position.distributor, actor) ||
                  (session.role === CompanyRole.MANUFACTURER &&
                    catalogue.some(
                      (item) =>
                        Number(item.kind) === 2 &&
                        same(item.seller, actor) &&
                        item.batches.some((batch: string) => same(batch, position.batchId)),
                    )),
              )
              .map((position) => ({
                ...position,
                quantity: position.available,
                unit:
                  catalogue.find((item) =>
                    item.batches.some((batch: string) => same(batch, position.batchId)),
                  )?.unit ?? 'Unavailable',
                distributorName: name(position.distributor),
              })),
            positions: logistics.positions.filter(ownsInventory).map((position) => ({
              ...position,
              distributorName: name(position.distributor),
              supplierName: name(position.supplier),
            })),
            shipments: logistics.shipments.map((shipment) => ({
              ...shipment,
              senderName: name(shipment.sender),
              senderLogoPath: logoWallets.has(shipment.sender.toLowerCase())
                ? `/branding/${getAddress(shipment.sender)}/logo`
                : undefined,
              recipientName: name(shipment.recipient),
              recipientLogoPath: logoWallets.has(shipment.recipient.toLowerCase())
                ? `/branding/${getAddress(shipment.recipient)}/logo`
                : undefined,
              itemName: catalogue.find((item) =>
                item.batches.some((batch: string) => same(batch, shipment.batchId)),
              )?.name,
              unit:
                shipment.unit ??
                catalogue.find((item) =>
                  item.batches.some((batch: string) => same(batch, shipment.batchId)),
                )?.unit,
            })),
          }
        : undefined,
      companies: warehouseSupported
        ? directoryCompanies.map((company) => ({
            wallet: company.walletAddress,
            companyName: company.companyName,
            role: company.role,
            logoPath: logoWallets.has(company.walletAddress.toLowerCase())
              ? `/branding/${getAddress(company.walletAddress)}/logo`
              : undefined,
          }))
        : undefined,
      chainId: this.gateway.chainId,
      ordersAddress: this.gateway.address,
      distributors:
        ingredientDeliverySupported && session.role === CompanyRole.SUPPLIER
          ? directoryCompanies
              .filter((identity) => identity.active && identity.role === CompanyRole.DISTRIBUTOR)
              .map((identity) => ({
                wallet: identity.walletAddress,
                companyName: identity.companyName,
                logoPath: logoWallets.has(identity.walletAddress.toLowerCase())
                  ? `/branding/${getAddress(identity.walletAddress)}/logo`
                  : undefined,
              }))
          : [],
      ...(session.role === CompanyRole.SUPPLIER
        ? { supplierStock: supplierStock(actor, catalogue, orders, Math.floor(Date.now() / 1000)) }
        : {}),
      role: session.role,
      catalogue: catalogue
        .filter((item) => {
          if (session.role === CompanyRole.SYSTEM_ADMIN) return true;
          if (session.role === CompanyRole.SUPPLIER) return same(item.seller, actor);
          if (session.role === CompanyRole.MANUFACTURER)
            return Number(item.kind) === 1 || same(item.seller, actor);
          if (session.role === CompanyRole.RETAILER) return Number(item.kind) === 2;
          return (
            orders.some((order) => same(order.itemId, item.itemId)) ||
            item.batches.some(
              (batch: string) =>
                logistics?.positions.some(
                  (position) => same(position.distributor, actor) && same(position.batchId, batch),
                ) ||
                logistics?.shipments.some((shipment) => same(shipment.batchId, batch)) ||
                shipments.some((shipment) =>
                  same(shipment.batchId ?? shipment.productBatchId, batch),
                ),
            )
          );
        })
        .map((item) => ({
          ...item,
          custodyPositions:
            warehouseSupported && Number(item.kind) === 1
              ? (logistics?.positions ?? [])
                  .filter(
                    (position) =>
                      item.batches.some((batch: string) => same(batch, position.batchId)) &&
                      (session.role !== CompanyRole.DISTRIBUTOR ||
                        same(position.distributor, actor)) &&
                      (session.role !== CompanyRole.SUPPLIER || same(position.supplier, actor)),
                  )
                  .map((position) => ({
                    ...cataloguePosition(position),
                    distributorName: name(position.distributor),
                    supplierName: name(position.supplier),
                  }))
              : undefined,
          storageLocations:
            Number(item.kind) === 2
              ? logistics?.productPositions.filter(
                  (position) =>
                    item.batches.some((batch: string) => same(batch, position.batchId)) &&
                    (session.role !== CompanyRole.DISTRIBUTOR || same(position.distributor, actor)),
                )
              : undefined,
          sellerName: name(item.seller),
          sellerRole: role(item.seller),
          sellerLogoPath: logoWallets.has(item.seller.toLowerCase())
            ? `/branding/${getAddress(item.seller)}/logo`
            : undefined,
        })),
      orders: orders.map((order) => ({
        ...order,
        buyerName: name(order.buyer),
        buyerLogoPath: logoWallets.has(order.buyer.toLowerCase())
          ? `/branding/${getAddress(order.buyer)}/logo`
          : undefined,
        sellerName: name(order.seller),
        sellerLogoPath: logoWallets.has(order.seller.toLowerCase())
          ? `/branding/${getAddress(order.seller)}/logo`
          : undefined,
        delivery: order.delivery
          ? {
              ...order.delivery,
              distributorName: name(order.delivery.distributor),
              distributorLogoPath: logoWallets.has(order.delivery.distributor.toLowerCase())
                ? `/branding/${getAddress(order.delivery.distributor)}/logo`
                : undefined,
            }
          : undefined,
        deliveryQr: order.delivery ? this.deliveryQr(order.orderId) : undefined,
      })),
      shipments: shipments.map((shipment): ChainRecord => ({
        ...shipment,
        senderName: name(shipment.sender),
        senderLogoPath: logoWallets.has(shipment.sender.toLowerCase())
          ? `/branding/${getAddress(shipment.sender)}/logo`
          : undefined,
        recipientName: name(shipment.recipient),
        recipientLogoPath: logoWallets.has(shipment.recipient.toLowerCase())
          ? `/branding/${getAddress(shipment.recipient)}/logo`
          : undefined,
      })),
      locations: safeLocations,
    };
  }
  async prepare(sessionId: string | undefined, input: OrderAction) {
    const session = await this.session(sessionId);
    this.summaryReader?.invalidate();
    this.displaySnapshots.invalidate();
    const operationKey = id(
      `${this.gateway.chainId}:${this.gateway.address}:${session.address.toLowerCase()}:${input.operationId}`,
    );
    if (input.action === 'request') {
      const kind =
        input.kind ?? Number((await this.gateway.read('orders', 'getItem', [input.itemId])).kind);
      if (
        (kind === 1 && session.role !== CompanyRole.MANUFACTURER) ||
        (kind === 2 && session.role !== CompanyRole.RETAILER)
      )
        throw new OrdersError(
          'BUYER_ROLE_REQUIRED',
          'Only a Manufacturer can request ingredients; only a Retailer can request finished products.',
          403,
        );
      if (input.location)
        this.requireResourceOwner(
          await this.gateway.read('orders', 'locationOwner', [input.location]),
          session.address,
        );
    }
    if (
      input.action === 'request' &&
      input.kind === 1 &&
      !!input.positionId &&
      Number(await this.optionalRead('delivery', 'custodyPolicy')) === 1
    ) {
      if (session.role !== CompanyRole.MANUFACTURER)
        throw new OrdersError(
          'MANUFACTURER_REQUIRED',
          'Only a Manufacturer can request ingredient custody stock.',
          403,
        );
      if (!input.positionId || !input.location || !input.batchId)
        throw new OrdersError(
          'WAREHOUSE_SELECTION_REQUIRED',
          'Select available Distributor custody stock and your receiving location.',
          400,
        );
      const stock = await this.gateway.read('delivery', 'getPosition', [input.positionId]);
      if (
        !same(stock.position.batchId, input.batchId) ||
        this.batchUnit(stock.position.unit) !== input.unit ||
        BigInt(input.quantity) > BigInt(stock.available)
      )
        throw new OrdersError(
          'INSUFFICIENT_CUSTODY_STOCK',
          'The selected warehouse has insufficient unreserved stock. Refresh before ordering.',
        );
      const stored = await this.privateRecord(operationKey, session.address, {
        note: input.note,
        positionId: input.positionId,
        requestOnly: true,
        receivingLocation: input.location,
      });
      return {
        resultId: operationKey,
        transaction: await this.prepareWarehouseTransaction(
          session.address,
          'delivery',
          'placeCustodyOrder',
          [
            operationKey,
            input.positionId,
            input.quantity,
            input.location,
            input.expiresAt,
            stored.contentHash,
            stored.cid,
          ],
        ),
      };
    }
    let method: string;
    let args: unknown[];
    let contract = 'orders';
    let resultId = operationKey;
    const now = Math.floor(Date.now() / 1000);
    if ('occurredAt' in input && input.occurredAt > now)
      throw new OrdersError(
        'INVALID_EVENT_TIME',
        'The reported event cannot be in the future.',
        400,
      );
    if (
      input.action === 'delivery-assign' ||
      input.action === 'delivery-respond' ||
      input.action === 'delivery-pickup' ||
      input.action === 'delivery-expire'
    ) {
      if (Number(await this.optionalRead('orders', 'ingredientDeliveryPolicy')) !== 1)
        throw new OrdersError(
          'INGREDIENT_DELIVERY_UPGRADE_REQUIRED',
          'Deploy the updated contract suite to use Distributor ingredient deliveries.',
        );
      const order = await this.gateway.read('orders', 'getOrder', [input.orderId]);
      const delivery = await this.gateway.read('delivery', 'get', [input.orderId]);
      const supplier = same(order.seller, session.address) && session.role === CompanyRole.SUPPLIER;
      const distributor =
        same(delivery.distributor, session.address) && session.role === CompanyRole.DISTRIBUTOR;
      if (!supplier && !distributor && !same(order.buyer, session.address))
        throw new OrdersError('NOT_FOUND', 'Delivery not found.', 404);
      if (input.action === 'delivery-assign') {
        if (!supplier || Number(delivery.stage) !== 1 || Number(delivery.assignmentDeadline) <= now)
          throw new OrdersError(
            'DELIVERY_ASSIGNMENT_CLOSED',
            'Only the Supplier can request a Distributor before the assignment deadline.',
          );
        if (!(await this.gateway.read('stakeholders', 'isAuthorized', [input.distributor, 4])))
          throw new OrdersError(
            'DISTRIBUTOR_UNAUTHORIZED',
            'Choose an active authorized Distributor.',
          );
        contract = 'delivery';
        method = 'act';
        args = deliveryArgs(session.address, 1, input.orderId, { distributor: input.distributor });
      } else if (input.action === 'delivery-respond') {
        if (
          !distributor ||
          (Number(delivery.stage) !== 2 &&
            !(input.accept === false && Number(delivery.stage) === 3))
        )
          throw new OrdersError(
            'DELIVERY_RESPONSE_UNAVAILABLE',
            'Only the assigned Distributor can accept or decline before pickup.',
          );
        contract = 'delivery';
        method = 'act';
        args = deliveryArgs(session.address, input.accept ? 2 : 3, input.orderId);
      } else if (input.action === 'delivery-pickup') {
        if (!distributor || Number(delivery.stage) !== 3)
          throw new OrdersError(
            'PICKUP_UNAVAILABLE',
            'Accept this delivery before scanning to confirm pickup.',
          );
        this.assertDeliveryQr(input.qrPayload, input.orderId);
        if (!(await this.pickupPlan(sessionId, input.orderId)).plan)
          throw new OrdersError(
            'PICKUP_PLAN_REQUIRED',
            'Arrange a pickup time before recording physical collection.',
          );
        contract = 'delivery';
        method = 'act';
        args = deliveryArgs(session.address, 6, input.orderId, { occurredAt: input.occurredAt });
      } else if (input.action === 'delivery-expire') {
        if (Number(delivery.stage) !== 6)
          throw new OrdersError('DELIVERY_NOT_EXPIRED', 'This delivery has not expired.');
        contract = 'delivery';
        method = 'act';
        args = deliveryArgs(session.address, 7, input.orderId);
      } else throw new OrdersError('INVALID_DELIVERY_ACTION', 'Invalid delivery action.', 400);
    } else if (input.action === 'approved-receipt') {
      if (Number(await this.optionalRead('orders', 'approvedReceiptPolicy')) !== 1)
        throw new OrdersError(
          'APPROVED_RECEIPT_UPGRADE_REQUIRED',
          'Deploy the updated registry suite to confirm receipt of approved ingredient requests. Existing stock is unchanged.',
        );
      const order = await this.gateway.read('orders', 'getOrder', [input.orderId]);
      if (!same(order.buyer, session.address) || session.role !== CompanyRole.MANUFACTURER)
        throw new OrdersError('NOT_FOUND', 'Request not found.', 404);
      const decision = await this.gateway.read('orders', 'requestDecision', [input.orderId]);
      const item = await this.gateway.read('orders', 'getItem', [order.itemId]);
      const delivery =
        Number(await this.optionalRead('orders', 'ingredientDeliveryPolicy')) === 1
          ? await this.gateway.read('delivery', 'get', [input.orderId])
          : undefined;
      const routed = Number(delivery?.stage ?? 0) > 0;
      if (routed) {
        if (Number(delivery.stage) !== 4)
          throw new OrdersError(
            'DELIVERY_NOT_IN_TRANSIT',
            'The assigned Distributor must accept and scan pickup before receipt.',
          );
        this.assertDeliveryQr(input.qrPayload, input.orderId);
      }
      if (
        !(await this.gateway.read('orders', 'requestOnly', [input.orderId])) ||
        Number(decision.status) !== 1 ||
        Number(order.status) !== 1 ||
        (!routed && Number(order.expiresAt) <= now) ||
        Number(item.kind) !== 1
      )
        throw new OrdersError(
          'RECEIPT_NOT_AVAILABLE',
          'Only an open Supplier-approved ingredient request can be received.',
        );
      const received = BigInt(
        await this.gateway.read('orders', 'approvedReceivedQuantity', [input.orderId]),
      );
      if (BigInt(input.quantity) > BigInt(order.requested) - received)
        throw new OrdersError(
          'RECEIPT_EXCEEDS_APPROVAL',
          'Received quantity exceeds the approved amount still outstanding.',
        );
      if (
        !same(await this.gateway.read('orders', 'locationOwner', [input.location]), session.address)
      )
        throw new OrdersError(
          'RECEIVING_LOCATION_REQUIRED',
          'Select a receiving location registered to your company.',
        );
      if (input.occurredAt < Number(decision.recordedAt))
        throw new OrdersError(
          'INVALID_EVENT_TIME',
          'Receipt time must be after Supplier approval.',
          400,
        );
      const batchId = await this.gateway.read('orders', 'requestedBatch', [input.orderId]);
      if (!batchId || /^0x0+$/.test(batchId))
        throw new OrdersError(
          'RECEIPT_BATCH_UNAVAILABLE',
          'This older request has no bound receipt batch. Submit a new request using the updated suite.',
        );
      const batch = await this.gateway.read('ingredients', 'getBatch', [batchId]);
      if (
        !same(batch.supplier, order.seller) ||
        !(await this.gateway.read(
          'ingredients',
          routed ? 'isValidTraceabilitySource' : 'isUsable',
          [batchId],
        )) ||
        BigInt(routed ? delivery.reservedQuantity : batch.availableQuantity) <
          BigInt(input.quantity)
      )
        throw new OrdersError(
          'INSUFFICIENT_SUPPLIER_STOCK',
          'The Supplier batch is invalid or has insufficient remaining stock for this receipt.',
        );
      method = 'confirmApprovedIngredientReceipt';
      args = [operationKey, input.orderId, input.quantity, input.location, input.occurredAt];
    } else if (input.action === 'ingredient-update' || input.action === 'ingredient-archive') {
      const batch = await this.gateway.read('ingredients', 'getBatch', [input.batchId]);
      if (!same(batch.supplier, session.address) || session.role !== CompanyRole.SUPPLIER)
        throw new OrdersError(
          'INGREDIENT_OWNER_REQUIRED',
          'Only this ingredient’s authorized Supplier can manage its listing.',
          403,
        );
      if (
        !(await this.gateway.read('stakeholders', 'hasPermission', [
          session.address,
          id('REGISTER_INGREDIENT'),
        ]))
      )
        throw new OrdersError(
          'INGREDIENT_PERMISSION_REQUIRED',
          'Your company does not have permission to manage ingredient listings.',
          403,
        );
      if (Number(await this.optionalRead('ingredients', 'listingManagementPolicy')) !== 1)
        throw new OrdersError(
          'INGREDIENT_MANAGEMENT_UPGRADE_REQUIRED',
          'Deploy the updated contract suite before editing or archiving listings. Existing credentials are unchanged.',
        );
      contract = 'ingredients';
      if (input.action === 'ingredient-archive') {
        method = 'setArchived';
        args = [input.batchId, input.archived];
      } else {
        const listing = await this.gateway.read('ingredients', 'getListing', [input.batchId]);
        if (input.priceBasis) {
          const unit = this.batchUnit(batch.unit);
          const choices = ['g', 'kg'].includes(unit)
            ? ['g', 'kg']
            : ['litre', 'mL', 'ml', 'L', 'l'].includes(unit)
              ? ['litre', 'mL']
              : ['unit', 'each', 'units'].includes(unit)
                ? ['each', unit]
                : [unit];
          if (!choices.includes(input.priceBasis))
            throw new OrdersError(
              'INVALID_PRICE_BASIS',
              'Choose a price basis compatible with this batch unit.',
              400,
            );
        }
        if (!same(listing.metadataHash, input.expectedHash))
          throw new OrdersError(
            'INGREDIENT_LISTING_CHANGED',
            'This listing changed. Refresh before editing again.',
          );
        const payload = {
          name: input.name,
          category: input.category,
          description: input.description,
          price: input.price,
          currency: input.currency,
          ...(input.priceBasis ? { priceBasis: input.priceBasis } : {}),
        };
        const stored = await this.privateRecord(
          id(`ingredient-listing:${input.batchId.toLowerCase()}`),
          session.address,
          payload,
        );
        method = 'updateListing';
        args = [input.batchId, input.expectedHash, stored.contentHash, stored.cid];
      }
    } else if (input.action === 'decide-request') {
      const order = await this.gateway.read('orders', 'getOrder', [input.orderId]);
      if (!same(order.seller, session.address))
        throw new OrdersError('NOT_FOUND', 'Request not found.', 404);
      if (Number(order.status) === 3 || Number(order.expiresAt) <= now)
        throw new OrdersError('REQUEST_CLOSED', 'This request is closed or expired.');
      if (Number(await this.optionalRead('orders', 'supplierManagementPolicy')) !== 1)
        throw new OrdersError(
          'REQUEST_DECISION_UPGRADE_REQUIRED',
          'Deploy the updated contract suite to approve or reject requests.',
        );
      if (!(await this.gateway.read('orders', 'requestOnly', [input.orderId])))
        throw new OrdersError(
          'REQUEST_ONLY_REQUIRED',
          'This action applies only to request-only records. Earlier physical records are preserved.',
        );
      const previous = await this.gateway.read('orders', 'requestDecision', [input.orderId]);
      if (Number(previous.status) !== 0)
        throw new OrdersError(
          'REQUEST_ALREADY_DECIDED',
          'A final decision is already recorded. Refresh this request.',
        );
      const details = { requestId: input.orderId, decision: input.decision, reason: input.reason };
      const stored = await this.privateRecord(
        id(`request-decision:${input.orderId.toLowerCase()}`),
        session.address,
        details,
      );
      method = 'decideRequest';
      args = [input.orderId, input.decision, stored.contentHash, stored.cid];
      if (
        input.decision === 1 &&
        session.role === CompanyRole.SUPPLIER &&
        Number(await this.optionalRead('orders', 'ingredientDeliveryPolicy')) === 1
      ) {
        method = 'approveIngredientDelivery';
        args = [input.orderId, stored.contentHash, stored.cid];
      }
    } else if (input.action === 'location') {
      const stored = await this.privateRecord(operationKey, session.address, {
        label: input.label,
        ...(input.address ? { address: input.address } : {}),
      });
      method = 'registerLocation';
      args = [operationKey, stored.contentHash, stored.cid];
    } else if (input.action === 'list') {
      if (
        (input.kind === 1 && session.role !== CompanyRole.SUPPLIER) ||
        (input.kind === 2 && session.role !== CompanyRole.MANUFACTURER)
      )
        throw new OrdersError(
          'CATALOGUE_ROLE_REQUIRED',
          'Only a Supplier can list ingredients and only a Manufacturer can list finished products.',
          403,
        );
      const batch = await this.catalogueBatch(input.kind, input.batchId);
      if (!same(input.kind === 1 ? batch.supplier : batch.manufacturer, session.address))
        throw new OrdersError(
          'CATALOGUE_BATCH_OWNER_REQUIRED',
          'Select a batch registered by your connected company.',
          403,
        );
      const unit = this.batchUnit(batch.unit);
      if (!/^[A-Za-z0-9._/-]{1,31}$/.test(unit))
        throw new OrdersError(
          'CATALOGUE_UNIT_INVALID',
          'The batch does not contain a readable registered unit. Its unit will not be guessed or converted.',
          409,
        );
      if (Number(batch.status) !== 1 || Number(batch.expiresAt) <= now)
        throw new OrdersError(
          'CATALOGUE_BATCH_INACTIVE',
          'This batch is inactive or expired. Select an active, unexpired batch.',
          409,
        );
      if (!['g', 'each'].includes(unit)) {
        let policy = 0;
        try {
          policy = Number(await this.gateway.read('orders', 'catalogueUnitPolicy'));
        } catch (cause) {
          const failure = cause as { code?: string; data?: string };
          if (failure.code !== 'CALL_EXCEPTION' || failure.data !== '0x')
            throw new OrdersError(
              'CATALOGUE_POLICY_UNAVAILABLE',
              'The API could not check the deployed unit policy. Check the RPC connection and rebuild contract artifacts.',
              503,
            );
        }
        if (policy !== 2)
          throw new OrdersError(
            'CATALOGUE_UPGRADE_REQUIRED',
            `The batch unit ${unit} is valid. The deployed order contract needs the registered-unit update. Deploy the updated contract suite before publishing this batch; its quantity and unit have not been changed.`,
          );
      }
      resultId = input.itemId ?? operationKey;
      method = 'listItem';
      args = [resultId, input.name, input.kind, input.batchId, id(JSON.stringify(input))];
    } else if (input.action === 'request') {
      if (input.requestOnly && (!input.batchId || !input.kind))
        throw new OrdersError(
          'INVALID_REGISTERED_REQUEST',
          'Select a registered ingredient or product for this request.',
          400,
        );
      if (!input.requestOnly && !input.location)
        throw new OrdersError(
          'RECEIVING_LOCATION_REQUIRED',
          'A receiving location is required for the legacy physical flow.',
          400,
        );
      if (input.requestOnly) {
        let supported: unknown;
        try {
          supported = await this.gateway.read('orders', 'requestOnlyPolicy');
        } catch (error) {
          const failure = error as { code?: string; data?: string };
          if (failure.code !== 'CALL_EXCEPTION' || failure.data !== '0x') throw error;
        }
        if (Number(supported) !== 1)
          throw new OrdersError(
            'REQUEST_ONLY_UPGRADE_REQUIRED',
            'This deployment does not support requests without fulfilment steps. Deploy the updated suite and update all seven configured addresses. No reservation or dispatch was performed.',
          );
      }
      if (input.expiresAt <= now)
        throw new OrdersError('INVALID_EXPIRY', 'Choose a future order deadline.', 400);
      if (Boolean(input.batchId) !== Boolean(input.kind))
        throw new OrdersError(
          'INVALID_REGISTERED_REQUEST',
          'Select both a registered batch and its item type.',
          400,
        );
      if (input.batchId && input.kind) {
        let policy: unknown;
        try {
          policy = await this.gateway.read('orders', 'registeredRequestPolicy');
        } catch (error) {
          const failure = error as { code?: string; data?: string };
          if (failure.code !== 'CALL_EXCEPTION' || failure.data !== '0x') throw error;
        }
        if (Number(policy) !== 1)
          throw new OrdersError(
            'REGISTERED_REQUEST_UPGRADE_REQUIRED',
            'Direct requests for registered batches need the updated contract suite. Deploy it and configure all seven addresses; a separate catalogue publishing transaction is no longer used.',
          );
      }
      const batch =
        input.batchId && input.kind
          ? await this.catalogueBatch(input.kind, input.batchId)
          : undefined;
      if (
        input.kind === 1 &&
        input.batchId &&
        (await this.optionalRead('ingredients', 'getListing', [input.batchId]))?.archived
      )
        throw new OrdersError(
          'INGREDIENT_ARCHIVED',
          'This ingredient is archived and cannot receive new requests. Choose an active listing.',
        );
      const item = batch
        ? { unit: batch.unit }
        : await this.gateway.read('orders', 'getItem', [input.itemId]);
      if (this.batchUnit(item.unit) !== input.unit)
        throw new OrdersError(
          'ORDER_UNIT_MISMATCH',
          'Use the same unit as the selected catalogue item. Quantities are not converted automatically.',
          400,
        );
      if (input.custodySource) {
        if (input.kind !== 2 || !input.batchId || session.role !== CompanyRole.RETAILER)
          throw new OrdersError(
            'INVALID_CUSTODY_SOURCE',
            'A product custody selection requires a Retailer product request.',
            400,
          );
        const { distributor, location } = input.custodySource;
        const warehouse = await this.gateway.read('delivery', 'warehouses', [location]);
        if (
          !same(warehouse.distributor, distributor) ||
          !(await this.gateway.read('stakeholders', 'isAuthorized', [distributor, 4])) ||
          !same(await this.gateway.read('orders', 'locationOwner', [location]), distributor)
        )
          throw new OrdersError(
            'INVALID_CUSTODY_SOURCE',
            'Choose an active Distributor warehouse.',
            400,
          );
        if (
          BigInt(
            await this.gateway.read('custody', 'locationStock', [
              input.batchId,
              distributor,
              location,
            ]),
          ) < BigInt(input.quantity)
        )
          throw new OrdersError(
            'INSUFFICIENT_CUSTODY_STOCK',
            'The selected warehouse no longer has enough available product stock.',
          );
      }
      const stored = await this.privateRecord(operationKey, session.address, {
        note: input.note,
        ...(input.custodySource ? { custodySource: input.custodySource } : {}),
        ...(input.requestOnly ? { requestOnly: true } : {}),
        receivingLocation: input.location,
      });
      method = 'requestOrder';
      args = [
        operationKey,
        input.itemId,
        input.quantity,
        encodeBytes32String(input.unit),
        input.location,
        input.expiresAt,
        input.evidenceRequired,
        stored.contentHash,
        stored.cid,
      ];
      if (input.batchId && input.kind) {
        method = 'requestBatch';
        args = [
          operationKey,
          input.kind,
          input.batchId,
          input.quantity,
          input.location,
          input.expiresAt,
          input.evidenceRequired,
          stored.contentHash,
          stored.cid,
        ];
        if (
          input.kind === 1 &&
          Number(await this.optionalRead('orders', 'ingredientDeliveryPolicy')) === 1
        ) {
          method = 'requestIngredientDelivery';
          args = [
            operationKey,
            input.batchId,
            input.quantity,
            input.expiresAt,
            stored.contentHash,
            stored.cid,
          ];
        }
      }
      if (input.requestOnly && method !== 'requestIngredientDelivery') {
        method = 'requestInterest';
        args = [
          operationKey,
          input.kind,
          input.batchId,
          input.quantity,
          input.expiresAt,
          stored.contentHash,
          stored.cid,
        ];
      }
    } else if (input.action === 'propose') {
      this.requireResourceOwner(
        (await this.gateway.read('orders', 'getOrder', [input.orderId])).seller,
        session.address,
      );
      method = 'propose';
      args = [input.orderId, input.batchId, input.location];
    } else if (input.action === 'allocate') {
      const order = await this.gateway.read('orders', 'getOrder', [input.orderId]);
      if (!same(order.seller, session.address))
        throw new OrdersError(
          'ORDER_SELLER_REQUIRED',
          'Only the seller on this order can reserve stock.',
          403,
        );
      if (Number(order.status) === 0 || Number(order.status) > 2)
        throw new OrdersError(
          'ORDER_NOT_OPEN',
          'This order is closed or unavailable. Open a current order before reserving stock.',
        );
      if (Number(order.expiresAt) <= now)
        throw new OrdersError(
          'ORDER_EXPIRED',
          'The order deadline has passed. Close it to release unused stock; a new order is needed.',
        );
      if (!order.proposedBatch || order.proposedBatch === ZeroHash)
        throw new OrdersError(
          'ORDER_PROPOSAL_REQUIRED',
          'Confirm a batch proposal in step 1 before reserving stock.',
        );
      const reserved = BigInt(order.allocated) - BigInt(order.dispatched);
      if (reserved > 0n)
        throw new OrdersError(
          'ORDER_ALREADY_RESERVED',
          `${reserved} units are already reserved for this order. Continue to the checks and dispatch step; do not reserve the same stock again.`,
        );
      const outstanding = BigInt(order.requested) - BigInt(order.dispatched);
      if (BigInt(input.quantity) > outstanding)
        throw new OrdersError(
          'ORDER_ALLOCATION_EXCEEDS_REQUEST',
          `Only ${outstanding} units remain to fulfil this order. Enter that quantity or a smaller partial allocation.`,
          400,
        );
      const item = await this.gateway.read('orders', 'getItem', [order.itemId]);
      const permission = Number(item.kind) === 1 ? 'REGISTER_INGREDIENT' : 'INITIATE_TRANSFER';
      if (
        !(await this.gateway.read('stakeholders', 'hasPermission', [
          session.address,
          id(permission),
        ]))
      )
        throw new OrdersError(
          'ORDER_RESERVATION_PERMISSION_REQUIRED',
          `Your company does not currently have ${permission} permission. Ask the administrator to review role defaults and individual permission overrides.`,
          403,
        );
      if (Number(item.kind) === 1) {
        const batch = await this.gateway.read('ingredients', 'getBatch', [order.proposedBatch]);
        const unit = this.batchUnit(batch.unit);
        if (BigInt(input.quantity) > BigInt(batch.availableQuantity))
          throw new OrdersError(
            'ORDER_INSUFFICIENT_STOCK',
            `Only ${batch.availableQuantity} ${unit} remain unreserved in the proposed batch. Reserve a smaller quantity or propose another batch.`,
          );
        if (!(await this.gateway.read('ingredients', 'isUsable', [order.proposedBatch])))
          throw new OrdersError(
            'ORDER_BATCH_UNUSABLE',
            'The proposed ingredient batch is not usable. Check its expiry, recall/status, Ingredient Credential and Supplier authorization before reserving stock.',
          );
      }
      method = 'allocate';
      args = [input.orderId, input.quantity];
    } else if (input.action === 'close') {
      const order = await this.gateway.read('orders', 'getOrder', [input.orderId]);
      if (!same(order.buyer, session.address) && !same(order.seller, session.address))
        this.requireResourceOwner(undefined, session.address);
      method = 'closeOrder';
      args = [input.orderId];
    } else if (input.action === 'evidence' || input.action === 'bind-evidence') {
      this.requireResourceOwner(
        (await this.gateway.read('orders', 'getOrder', [input.orderId])).buyer,
        session.address,
      );
      method = input.action === 'evidence' ? 'linkEvidence' : 'bindEvidenceRequest';
      args = [input.orderId, input.evidenceId];
    } else if (input.action === 'dispatch') {
      const order = await this.gateway.read('orders', 'getOrder', [input.orderId]);
      if (!same(order.seller, session.address))
        throw new OrdersError(
          'ORDER_SELLER_REQUIRED',
          'Only this order’s seller can dispatch its reserved goods.',
          403,
        );
      if (Number(order.status) === 0 || Number(order.status) > 2 || Number(order.expiresAt) <= now)
        throw new OrdersError(
          'ORDER_DISPATCH_CLOSED',
          'This order is closed or expired. Dispatch is unavailable; review its history and release unused stock.',
        );
      const remaining = BigInt(order.allocated) - BigInt(order.dispatched);
      if (remaining <= 0n)
        throw new OrdersError(
          'ORDER_RESERVATION_REQUIRED',
          'No reserved stock remains to dispatch. Reserve stock in step 2 first.',
        );
      if (BigInt(input.quantity) > remaining)
        throw new OrdersError(
          'ORDER_DISPATCH_EXCEEDS_RESERVATION',
          `Only ${remaining} units remain reserved. Enter that amount or a smaller dispatch quantity.`,
          400,
        );
      if (!input.occurredAt)
        throw new OrdersError('INVALID_EVENT_TIME', 'Enter the actual dispatch time.', 400);
      const item = await this.gateway.read('orders', 'getItem', [order.itemId]);
      const ingredient = Number(item.kind) === 1;
      if (
        !(await this.gateway.read('stakeholders', 'hasPermission', [
          session.address,
          id(ingredient ? 'REGISTER_INGREDIENT' : 'INITIATE_TRANSFER'),
        ]))
      )
        throw new OrdersError(
          'ORDER_DISPATCH_PERMISSION_REQUIRED',
          'Your company lacks the permission required to dispatch this order. Ask the administrator to review role and individual permissions.',
          403,
        );
      if (
        !(await this.gateway.read('stakeholders', 'isAuthorized', [
          order.buyer,
          ingredient ? 3 : 5,
        ]))
      )
        throw new OrdersError(
          'ORDER_BUYER_UNAUTHORIZED',
          'The buyer is not currently authorized for this order’s receiving role. Its company registration and credential must be active.',
        );
      if (order.identityRequired) {
        if (Number(order.identityValidUntil) <= now || !order.identityValidUntil)
          throw new OrdersError(
            'ORDER_IDENTITY_REQUIRED',
            'Buyer identity proof is required or has expired. The buyer must present it and the seller must verify and record it before dispatch.',
          );
        const currentHash = await this.gateway.read('stakeholders', 'credentialHashOf', [
          order.buyer,
        ]);
        if (!same(currentHash, order.identityCredentialHash))
          throw new OrdersError(
            'ORDER_IDENTITY_REPLACED',
            'The buyer’s Company Role Credential changed. Request and verify a fresh company identity proof before dispatch.',
          );
      }
      const evidenceIds = (await this.gateway.read('orders', 'getOrderEvidence', [
        input.orderId,
      ])) as string[];
      if (order.evidenceRequired && !evidenceIds.length)
        throw new OrdersError(
          'ORDER_EVIDENCE_REQUIRED',
          'This order requires accepted evidence. The buyer must view, verify, accept and link the evidence to this order before dispatch.',
        );
      for (const evidenceId of evidenceIds) {
        const proof = await this.gateway.read('evidence', 'getRequest', [evidenceId]);
        if (Number(proof.status) !== 3 || !same(proof.requester, order.buyer))
          throw new OrdersError(
            'ORDER_EVIDENCE_INVALID',
            'Linked evidence is not accepted for this buyer. Ask the buyer to review and link valid evidence for the current proposal.',
          );
        if (Number(proof.presentationExpiresAt) <= now)
          throw new OrdersError(
            'ORDER_EVIDENCE_EXPIRED',
            'A linked evidence presentation has expired. Request fresh evidence for this proposal, then verify, accept and link it before dispatch.',
          );
        const matches = ingredient
          ? same(proof.ingredientBatchId, order.proposedBatch) && same(proof.supplier, order.seller)
          : (await this.gateway.read('products', 'getIngredientLinks', [order.proposedBatch])).some(
              (link: ChainRecord) => same(link.batchId, proof.ingredientBatchId),
            );
        if (
          !matches ||
          !(await this.gateway.read('ingredients', 'isValidTraceabilitySource', [
            proof.ingredientBatchId,
          ]))
        )
          throw new OrdersError(
            'ORDER_EVIDENCE_SOURCE_INVALID',
            'Linked evidence does not match a currently valid source for this proposal. Check the batch, credential status and Supplier authorization.',
          );
      }
      if (ingredient) {
        // Reserved stock may leave availableQuantity at zero; isUsable would incorrectly reject it.
        if (
          !(await this.gateway.read('ingredients', 'isValidTraceabilitySource', [
            order.proposedBatch,
          ]))
        )
          throw new OrdersError(
            'ORDER_DISPATCH_BATCH_INVALID',
            'The reserved ingredient batch is no longer a valid traceability source. Check expiry, recall, Ingredient Credential and Supplier authorization.',
          );
      } else {
        if (!input.distributor || !input.transitLocation)
          throw new OrdersError(
            'ORDER_DISTRIBUTOR_REQUIRED',
            'Select an authorized Distributor’s stock location. Finished products must travel through a Distributor.',
            400,
          );
        if (
          !(await this.gateway.read('stakeholders', 'isAuthorized', [input.distributor, 4])) ||
          !same(
            await this.gateway.read('orders', 'locationOwner', [input.transitLocation]),
            input.distributor,
          )
        )
          throw new OrdersError(
            'ORDER_DISTRIBUTOR_INVALID',
            'The selected transit location must belong to a currently authorized Distributor.',
          );
        if (input.expectedAt < now)
          throw new OrdersError(
            'ORDER_ARRIVAL_IN_PAST',
            'Choose an expected arrival time in the future.',
            400,
          );
      }
      const stored = await this.privateRecord(operationKey, session.address, input);
      method = 'dispatch';
      args = [
        input.orderId,
        operationKey,
        input.quantity,
        input.occurredAt,
        input.distributor ?? ZeroAddress,
        input.transitLocation ?? ZeroHash,
        input.expectedAt,
        stored.contentHash,
        stored.cid,
      ];
    } else if (input.action === 'receipt') {
      this.requireResourceOwner(
        (
          await this.gateway.read(
            input.product ? 'custody' : 'orders',
            input.product ? 'getTransfer' : 'getShipment',
            [input.shipmentId],
          )
        ).recipient,
        session.address,
      );
      if (input.product) {
        contract = 'custody';
        const stored = await this.privateRecord(operationKey, session.address, input);
        method = 'confirmReceiptWithMissing';
        args = [
          input.shipmentId,
          input.accepted,
          input.damaged,
          input.rejected,
          input.missing,
          input.occurredAt,
          stored.contentHash,
          stored.cid,
        ];
      } else {
        method = 'receiveIngredient';
        args = [
          input.shipmentId,
          input.accepted,
          input.damaged,
          input.rejected,
          input.missing,
          input.occurredAt,
        ];
      }
    } else if (input.action === 'forward') {
      this.requireResourceOwner(
        (await this.gateway.read('custody', 'getTransfer', [input.shipmentId])).recipient,
        session.address,
      );
      const stored = await this.privateRecord(operationKey, session.address, input);
      contract = 'custody';
      method = 'forwardOrderAt';
      args = [
        input.shipmentId,
        operationKey,
        input.quantity,
        input.expectedAt,
        stored.contentHash,
        stored.cid,
        input.fromLocation,
        input.toLocation,
        input.occurredAt,
      ];
    } else if (input.action === 'recall') {
      if (session.role !== CompanyRole.SYSTEM_ADMIN)
        this.requireResourceOwner(
          (await this.gateway.read('ingredients', 'getBatch', [input.batchId])).supplier,
          session.address,
        );
      const stored = await this.privateRecord(operationKey, session.address, input);
      contract = 'ingredients';
      method = 'setStatus';
      args = [input.batchId, 3, stored.contentHash, stored.cid];
    } else {
      if (session.role !== CompanyRole.SYSTEM_ADMIN)
        throw new OrdersError('ADMIN_REQUIRED', 'Only Admin can append corrections.', 403);
      const stored = await this.privateRecord(operationKey, session.address, input);
      method = 'appendCorrection';
      args = [
        operationKey,
        input.shipmentId,
        id(input.reason),
        stored.contentHash,
        stored.cid,
        input.occurredAt,
        input.reduceStock,
        input.correctedUsable,
      ];
    }
    try {
      return {
        resultId,
        transaction: await this.gateway.prepare(session.address, contract, method, args),
      };
    } catch {
      throw new OrdersError(
        'ORDER_TRANSITION_REJECTED',
        'The chain rejected this action. Refresh and check role, location, unit, usable stock, evidence, identity requirements and current order/shipment state.',
      );
    }
  }
  async recall(sessionId: string | undefined, batchId: string) {
    const session = await this.session(sessionId);
    const batch = await this.gateway.read('ingredients', 'getBatch', [batchId]);
    const products = [];
    const transfers = [];
    const admin = session.role === CompanyRole.SYSTEM_ADMIN;
    const sourceOwner = same(batch.supplier, session.address);
    const productEvents = await this.gateway.events('products', 'IngredientLinked');
    for (const event of productEvents.filter((event) => same(event.ingredientBatchId, batchId))) {
      const product = await this.gateway.read('products', 'getProduct', [event.productBatchId]);
      const related = (await this.gateway.events('custody', 'TransferCreated')).filter((entry) =>
        same(entry.productBatchId, event.productBatchId),
      );
      const shipments = await Promise.all(
        related.map(async (entry) => ({
          ...(await this.gateway.read('custody', 'getTransfer', [entry.transferId])),
          transferId: entry.transferId,
        })),
      );
      const visible = shipments.filter(
        (shipment) =>
          admin ||
          sourceOwner ||
          same(product.manufacturer, session.address) ||
          same(shipment.sender, session.address) ||
          same(shipment.recipient, session.address),
      );
      if (admin || sourceOwner || same(product.manufacturer, session.address) || visible.length) {
        products.push({
          productBatchId: event.productBatchId,
          producedAt: product.producedAt,
          productionRecordedAt: await this.gateway.read('products', 'productionRecordedAt', [
            event.productBatchId,
          ]),
          productionLocation: await this.gateway.read('products', 'productionLocation', [
            event.productBatchId,
          ]),
          manufacturer: product.manufacturer,
          quantityConsumed: event.quantity,
          status: product.status,
        });
        transfers.push(...visible.map(({ shipmentHash, shipmentCid, ...shipment }) => shipment));
      }
    }
    const own = await this.state(sessionId);
    const ingredientShipments = own.shipments.filter(
      (shipment) => !shipment.product && same(shipment.batchId, batchId),
    );
    if (!admin && !sourceOwner && !products.length && !ingredientShipments.length)
      throw new OrdersError('NOT_FOUND', 'Traceability record not found.', 404);
    const corrections = await Promise.all(
      (await this.gateway.events('orders', 'CorrectionAppended'))
        .filter((correction) =>
          ingredientShipments.some((shipment) => shipment.shipmentId === correction.originalId),
        )
        .map(async (correction) => {
          const values = await this.readPrivateRecord({
            cid: correction.valuesCid,
            contentHash: correction.valuesHash,
            id: correction.correctionId,
            owner: correction.actor,
          });
          return {
            ...correction,
            reason: values?.reason,
            correctedValues: values?.correctedValues,
          };
        }),
    );
    return {
      batchId,
      status: batch.status,
      supplierRemaining: admin || sourceOwner ? batch.availableQuantity : undefined,
      ingredientShipments,
      products,
      transfers,
      corrections,
    };
  }
}

function mediaKey(kind: 'company' | 'ingredient' | 'product', reference: string) {
  return id(`catalogue-media:${kind}:${reference.toLowerCase()}`);
}

function pendingCompanyLogoKey(applicationId: string) {
  return id(`pending-company-logo:${applicationId.toLowerCase()}`);
}

function validateImage(input: CatalogueImageInput) {
  try {
    return validateCatalogueImage(input);
  } catch (error) {
    if (error instanceof CatalogueImageError) throw new OrdersError(error.code, error.message, 400);
    throw error;
  }
}

function deliveryArgs(
  actor: string,
  action: number,
  orderId: string,
  fields: {
    distributor?: string;
    challenge?: string;
    occurredAt?: number;
    credentialHash?: string;
    presentationHash?: string;
    presentationCid?: string;
    validUntil?: number;
  } = {},
) {
  return [
    action,
    actor,
    orderId,
    fields.distributor ?? ZeroAddress,
    fields.challenge ?? ZeroHash,
    fields.occurredAt ?? 0,
    fields.credentialHash ?? ZeroHash,
    fields.presentationHash ?? ZeroHash,
    fields.validUntil ?? 0,
    fields.presentationCid ?? '',
  ];
}
