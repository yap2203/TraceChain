import { createHash } from 'node:crypto';
import {
  decodeBytes32String,
  encodeBytes32String,
  getAddress,
  id,
  solidityPackedKeccak256,
  ZeroAddress,
  ZeroHash,
  verifyMessage,
} from 'ethers';
import { companyLogoBindingMessage } from '@tracechain/shared';
import type { IngredientBatchWorkflowRepository } from '../ingredient-batches/ingredient-batch.repository.js';
import {
  CompanyRole,
  encodeIngredientDeliveryQr,
  decodeIngredientDeliveryQr,
  decodeShipmentQr,
  encodeShipmentQr,
} from '@tracechain/shared';
import type { AuthService } from '../auth/auth.service.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type { OrdersGateway, ChainRecord } from './orders.gateway.js';
import type { OrderAction } from './orders.schema.js';
import { supplierStock } from './supplier-stock.js';
import { readLogistics } from './logistics-state.js';
import { readBusinessTraceability } from './business-traceability.js';
import { CustodyOffers, type CustodyOffer } from './custody-offers.js';
import type { ApplicationMetadataRepository } from '../blockchain/application-metadata.repository.js';
import type { LogisticsAction } from './logistics.schema.js';
import type { ProductionFlowService } from '../production-flow/production-flow.service.js';
import type { DidCommService } from '../didcomm/didcomm.service.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import {
  CatalogueImageError,
  decodeStoredCatalogueImage,
  extensionFor,
  validateCatalogueImage,
  type CatalogueImageInput,
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
const same = (a: string, b: string) => a?.toLowerCase() === b?.toLowerCase();
export class OrdersService {
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
      prepare: (sessionId, input) => this.prepareLogistics(sessionId, input),
      proofCheck: async (sessionId, offer) => {
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
        const status = await this.flow.getCompanyIdentityProofStatus(sessionId, requestId);
        if (status.status !== 'VERIFIED')
          throw new OrdersError(
            'COMPANY_PROOF_REQUIRED',
            'Verify the requested company evidence before accepting, scheduling or handing off this stock.',
          );
      },
    }));
  }
  private async offerView(offer: CustodyOffer) {
    const batch = await this.gateway.read(
      offer.kind === 1 ? 'ingredients' : 'products',
      offer.kind === 1 ? 'getBatch' : 'getProduct',
      [offer.batchId],
    );
    const summary = await this.discoverBatch(offer.kind, offer.batchId, batch);
    const identities = (await this.directory?.resolveMany([offer.sender, offer.distributor])) ?? [];
    const name = (wallet: string) =>
      identities.find((identity) => same(identity.walletAddress, wallet))?.companyName ??
      'Company name unavailable';
    const events = await this.gateway.events('orders', 'LocationRegistered');
    const locationName = async (location: string, owner: string) => {
      const alias = await this.locationAlias(location, owner);
      if (alias) return alias;
      const event = events.find(
        (event) => same(event.location, location) && same(event.company, owner),
      );
      const record = await this.repository.findPrivate('products', location);
      if (
        event &&
        record &&
        same(record.owner, owner) &&
        same(record.contentHash, event.detailsHash)
      ) {
        const serialized = await this.store.decrypt(record.payload);
        if (same(record.contentHash, `0x${createHash('sha256').update(serialized).digest('hex')}`))
          return JSON.parse(serialized).label;
      }
      return 'Location name unavailable';
    };
    return {
      ...offer,
      itemName: summary.name ?? 'Registered batch',
      batchReference: summary.batchReference,
      senderName: name(offer.sender),
      distributorName: name(offer.distributor),
      fromLocationName: await locationName(offer.fromLocation, offer.sender),
      toLocationName: await locationName(offer.toLocation, offer.distributor),
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
  async prepareCustodyOffer(
    sessionId: string | undefined,
    offerId: string,
    input: Parameters<CustodyOffers['prepare']>[2],
  ) {
    return this.offers().prepare(sessionId, offerId, input);
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
    const rows: ChainRecord[] = [];
    for (const record of await this.repository.listEvidence()) {
      if (
        !record.identityProof ||
        (!same(record.requester, session.address) && !same(record.supplier, session.address))
      )
        continue;
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
        const current = await this.flow.getCompanyIdentityProofStatus(sessionId, record.requestId);
        status = record.identityProof.expiresAt <= Date.now() / 1000 ? 'EXPIRED' : current.status;
      } catch (cause) {
        if (
          !(cause instanceof Error) ||
          !('status' in cause) ||
          ![403, 404, 409].includes(Number(cause.status))
        )
          throw cause;
        status = 'UNAVAILABLE';
      }
      const company = await this.directory?.resolve(counterparty);
      rows.push({
        requestId: record.requestId,
        referenceId: record.deliveryOrderId ?? record.requestId,
        context: record.deliveryOrderId
          ? (await this.offers().lookup(record.deliveryOrderId, session.address))
            ? 'custody'
            : 'delivery'
          : record.orderContext
            ? 'order'
            : 'ingredient',
        direction: same(record.requester, session.address) ? 'received' : 'sent',
        company: company?.companyName ?? counterparty,
        purpose: record.identityProof.purpose,
        expiresAt: record.identityProof.expiresAt,
        status,
      });
    }
    return { requests: rows };
  }
  private async prepareWarehouseTransaction(
    actor: string,
    contract: string,
    method: string,
    args: unknown[],
  ) {
    try {
      return await this.gateway.prepare(actor, contract, method, args);
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'CALL_EXCEPTION')
        throw new OrdersError(
          contract === 'productDelivery'
            ? 'PRODUCT_DELIVERY_REJECTED'
            : 'CUSTODY_TRANSITION_REJECTED',
          contract === 'productDelivery'
            ? 'The product delivery state rejected this action. Refresh and check Manufacturer approval, assigned Distributor acceptance, route ownership, available stock, actual dispatch time and any requested company proof.'
            : 'The current warehouse/shipment state rejected this action. Refresh and check current authorization, location ownership, available or reserved quantity, Supplier approval and requested company proof. If this started after a warehouse contract update, deploy the current full contract suite before retrying.',
        );
      throw cause;
    }
  }
  async prepareLogistics(sessionId: string | undefined, input: LogisticsAction) {
    const session = await this.session(sessionId);
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
      } catch {
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
      transaction: await this.prepareWarehouseTransaction(session.address, contract, method, args),
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
      const record = await this.repository.findPrivate(
        'products',
        id(`request-decision:${requestId.toLowerCase()}:${decision.detailsHash.toLowerCase()}`),
      );
      if (
        record &&
        same(record.owner, seller) &&
        same(record.contentHash, decision.detailsHash) &&
        record.cid === decision.encryptedCid
      ) {
        const serialized = await this.store.decrypt(record.payload);
        if (
          same(`0x${createHash('sha256').update(serialized).digest('hex')}`, decision.detailsHash)
        )
          decision.reason = JSON.parse(serialized).reason;
      }
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
                    logoPath: (await this.companyLogoRecord(
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
    if (!record || !same(record.owner, owner)) return undefined;
    const serialized = await this.store.decrypt(record.payload);
    if (!same(record.contentHash, `0x${createHash('sha256').update(serialized).digest('hex')}`))
      throw new OrdersError(
        'PROFILE_UNAVAILABLE',
        'Location display metadata could not be checked.',
        503,
      );
    return (JSON.parse(serialized) as { label: string }).label;
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
        const record = await this.repository.findPrivate('products', event.location);
        const registeredLabel =
          record &&
          same(record.owner, session.address) &&
          same(record.contentHash, event.detailsHash)
            ? JSON.parse(await this.store.decrypt(record.payload)).label
            : 'Registered location';
        const warehouse =
          session.role === CompanyRole.DISTRIBUTOR &&
          Number(await this.optionalRead('delivery', 'custodyPolicy')) === 1
            ? await this.gateway.read('delivery', 'warehouses', [event.location])
            : undefined;
        return {
          location: event.location,
          registeredLabel,
          label: (await this.locationAlias(event.location, session.address)) ?? registeredLabel,
          warehouse: same(warehouse?.distributor, session.address),
        };
      }),
    );
    let initialLocationName: string | undefined;
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
        )
          initialLocationName = metadata.initialLocationName;
      }
    return { wallet: session.address, role: session.role, locations, initialLocationName };
  }
  async updateLocationLabel(sessionId: string | undefined, location: string, label: string) {
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
    await this.replacePresentationRecord(this.locationLabelKey(location), session.address, {
      label,
    });
    return { location, label, source: 'Company profile display name' };
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
      if (
        record &&
        same(record.supplierWallet, batch.supplier) &&
        same(record.metadataHash, batch.metadataHash) &&
        record.encryptedCid === batch.encryptedCid
      ) {
        const envelope = JSON.parse(await this.store.decrypt(record.encryptedPayload));
        if (
          envelope.metadata &&
          typeof envelope.metadata === 'object' &&
          same(
            `0x${createHash('sha256').update(JSON.stringify(envelope.metadata)).digest('hex')}`,
            batch.metadataHash,
          )
        )
          metadata = envelope.metadata;
      }
    } else {
      const record = await this.repository.findPrivate('products', batchId);
      if (
        record &&
        same(record.owner, batch.manufacturer) &&
        same(record.contentHash, batch.metadataHash) &&
        record.cid === batch.publicCid
      ) {
        const serialized = await this.store.decrypt(record.payload);
        if (same(`0x${createHash('sha256').update(serialized).digest('hex')}`, batch.metadataHash))
          metadata = JSON.parse(serialized);
      }
    }
    // Explicit public business summary only. Never spread the private metadata or credential.
    const summary: ChainRecord = {
      name:
        metadata.ingredientName ??
        metadata.productName ??
        (kind === 1 ? 'Ingredient name unavailable' : 'Product name unavailable'),
      category: metadata.category,
      countryOfOrigin: metadata.origin,
      description: metadata.description,
      batchReference: metadata.batchId ?? metadata.batchReference,
      price: metadata.price,
      currency: metadata.price !== undefined ? metadata.currency : undefined,
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
      const image = await this.repository.findPrivate('products', mediaKey('ingredient', batchId));
      if (image && same(image.owner, batch.supplier))
        summary.imagePath = `/catalogue/ingredients/${batchId}/image`;
      const listing = await this.optionalRead('ingredients', 'getListing', [batchId]);
      summary.archived = Boolean(listing?.archived);
      summary.listingHash = listing?.metadataHash ?? ZeroHash;
      summary.listingSupported = !!listing;
      summary.credentialName = summary.name;
      if (listing && listing.metadataHash !== ZeroHash) {
        const key = id(
          `ingredient-listing:${batchId.toLowerCase()}:${listing.metadataHash.toLowerCase()}`,
        );
        const record = await this.repository.findPrivate('products', key);
        if (
          record &&
          same(record.owner, batch.supplier) &&
          same(record.contentHash, listing.metadataHash) &&
          record.cid === listing.encryptedCid
        ) {
          const serialized = await this.store.decrypt(record.payload);
          if (
            same(`0x${createHash('sha256').update(serialized).digest('hex')}`, listing.metadataHash)
          ) {
            const value = JSON.parse(serialized);
            summary.name = value.name;
            summary.category = value.category;
            summary.description = value.description;
            summary.price = value.price;
            summary.currency = value.price !== undefined ? value.currency : undefined;
            summary.nameSource = 'Supplier listing metadata';
          }
        } else summary.listingUnavailable = true;
      }
    }
    return summary;
  }
  async identity(
    sessionId: string | undefined,
    orderId: string,
    input: {
      action: 'request' | 'material' | 'present' | 'verify' | 'decline' | 'status';
      purpose?: string;
      expiresAt?: number;
      required?: boolean;
      requiredClaims?: string[];
      optionalClaims?: string[];
      presentation?: string;
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
    if (!this.flow || !this.messaging)
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
        deliveryIdentity &&
        same(order.identityChallenge, id(proof.challenge)) &&
        Number(order.identityValidUntil) >= proof.expiresAt
      )
        return { state: 'COMPLETE', status: 'REQUESTED' };
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
      await this.messaging.send(sessionId, {
        messageType: 'https://tracechain.local/didcomm/order-identity-request/1.0',
        recipientWallet: order.buyer,
        businessReference: orderId,
        threadId: id(proof.challenge),
        expiresAt: new Date(proof.expiresAt * 1000).toISOString(),
        body: {
          orderId,
          purpose: input.purpose,
          requiredClaims: input.requiredClaims,
          optionalClaims: input.optionalClaims,
          fullDisclosure: false,
        },
      });
      return { transaction };
    }
    if (input.action === 'material')
      return this.flow.getCompanyIdentityProofMaterial(sessionId, orderId);
    if (input.action === 'status') {
      if (
        identityContract === 'custody-offer' &&
        !(await this.repository.findEvidence(orderId))?.identityProof
      )
        return { status: 'NOT_REQUESTED' };
      return this.flow.getCompanyIdentityProofStatus(sessionId, orderId);
    }
    if (input.action === 'verify') {
      const proof = await this.flow.orderIdentityAttestation(sessionId, orderId);
      if (identityContract === 'custody-offer') return { state: 'COMPLETE', checks: proof.checks };
      if (
        same(order.identityCredentialHash, proof.credentialHash) &&
        same(order.identityChallenge, proof.challengeHash) &&
        Number(order.identityValidUntil) >= proof.expiresAt
      )
        return { state: 'COMPLETE', checks: proof.checks };
      return {
        checks: proof.checks,
        transaction: await this.gateway.prepare(
          session.address,
          deliveryIdentity ? identityContract : 'orders',
          deliveryIdentity ? 'act' : 'attestIdentity',
          deliveryIdentity
            ? deliveryArgs(session.address, 5, actualOrderId, {
                challenge: proof.challengeHash,
                credentialHash: proof.credentialHash,
                presentationHash: proof.presentationHash,
                validUntil: proof.expiresAt,
              })
            : [
                actualOrderId,
                proof.challengeHash,
                proof.credentialHash,
                proof.presentationHash,
                proof.expiresAt,
              ],
        ),
      };
    }
    const workflow = await this.repository.findEvidence(orderId);
    if (!workflow?.identityProof)
      throw new OrdersError('IDENTITY_REQUEST_MISSING', 'Request company identity first.');
    if (!same(order.buyer, session.address))
      throw new OrdersError('BUYER_REQUIRED', 'Only the buyer may present or decline.', 403);
    if (input.action === 'present')
      await this.flow.validateOrderIdentityPresentation(sessionId, orderId, input.presentation!);
    await this.messaging.send(sessionId, {
      messageType: `https://tracechain.local/didcomm/order-identity-${input.action === 'present' ? 'presentation' : 'declined'}/1.0`,
      recipientWallet: order.seller,
      businessReference: orderId,
      threadId: id(workflow.identityProof.challenge),
      expiresAt: new Date(workflow.identityProof.expiresAt * 1000).toISOString(),
      body: {
        orderId,
        ...(input.action === 'present' ? { presentation: input.presentation } : { declined: true }),
      },
    });
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
        'The order ledger is unavailable or belongs to a different deployment. Deploy and configure the complete seven-contract suite.',
        503,
      );
    }
    return session;
  }
  private async authorizedSession(sessionId?: string) {
    const session = await this.auth.getSession(sessionId);
    if (!session.authenticated || !session.authorizationReady || !session.address)
      throw new OrdersError(
        'AUTHORIZATION_REQUIRED',
        'Sign in with an active authorized company wallet.',
        403,
      );
    return session;
  }
  private async privateRecord(key: string, actor: string, value: unknown) {
    const serialized = JSON.stringify(value);
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
    const serialized = JSON.stringify(value);
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
    await this.replacePresentationRecord(mediaKey('ingredient', batchId), session.address, image);
    return {
      image: {
        height: image.height,
        mimeType: image.mimeType,
        path: `/catalogue/ingredients/${batchId}/image`,
        supplierProvided: true,
        width: image.width,
      },
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
    await this.replacePresentationRecord(
      mediaKey('company', session.address),
      session.address,
      image,
    );
    return {
      branding: {
        companyName: identity.companyName,
        logoPath: `/branding/${getAddress(session.address)}/logo`,
        role: identity.role,
        companyProvided: true,
      },
    };
  }

  async savePendingCompanyLogo(input: {
    applicationId: string;
    applicantWallet: string;
    profileHash: string;
    logoSignature: string;
    logo: CatalogueImageInput;
  }) {
    const applicantWallet = getAddress(input.applicantWallet);
    const image = validateImage(input.logo);
    const logoDigest = id(`${image.mimeType}:${image.data}`);
    let recovered: string;
    try {
      recovered = getAddress(
        verifyMessage(
          companyLogoBindingMessage({
            applicationId: input.applicationId,
            applicantWallet,
            profileHash: input.profileHash,
            logoDigest,
          }),
          input.logoSignature,
        ),
      );
    } catch {
      throw new OrdersError(
        'COMPANY_LOGO_SIGNATURE_INVALID',
        'The company logo binding signature is invalid.',
        400,
      );
    }
    if (!same(recovered, applicantWallet))
      throw new OrdersError(
        'COMPANY_LOGO_SIGNATURE_INVALID',
        'The company logo must be signed by the applicant wallet.',
        403,
      );
    await this.replacePresentationRecord(
      pendingCompanyLogoKey(input.applicationId),
      applicantWallet,
      {
        version: 1,
        applicationId: input.applicationId.toLowerCase(),
        applicantWallet,
        image,
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
    const logo = await this.companyLogoRecord(session.address, identity.applicationId);
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
    kind: 'company' | 'ingredient',
    reference: string,
  ) {
    await this.authorizedSession(sessionId);
    let owner: string;
    if (kind === 'company') {
      owner = getAddress(reference);
      const identity = await this.directory?.resolve(owner);
      if (!identity)
        throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
      const record = await this.companyLogoRecord(owner, identity.applicationId);
      if (!record) throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
      try {
        const stored = await this.decodeCompanyLogo(
          record,
          record.id !== mediaKey('company', owner),
        );
        return {
          bytes: stored.bytes,
          contentHash: record.contentHash,
          fileName: `${kind}-${createHash('sha256').update(reference.toLowerCase()).digest('hex').slice(0, 16)}.${extensionFor(stored.mimeType)}`,
          mimeType: stored.mimeType,
        };
      } catch (error) {
        if (error instanceof OrdersError) throw error;
        throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
      }
    } else {
      const batch = await this.gateway.read('ingredients', 'getBatch', [reference]);
      owner = batch.supplier;
    }
    const record = await this.repository.findPrivate('products', mediaKey(kind, reference));
    if (!record || !same(record.owner, owner))
      throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
    try {
      const stored = decodeStoredCatalogueImage(
        JSON.parse(await this.store.decrypt(record.payload)),
      );
      return {
        bytes: stored.bytes,
        contentHash: record.contentHash,
        fileName: `${kind}-${createHash('sha256').update(reference.toLowerCase()).digest('hex').slice(0, 16)}.${extensionFor(stored.mimeType)}`,
        mimeType: stored.mimeType,
      };
    } catch (error) {
      if (error instanceof OrdersError) throw error;
      throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
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

  private async decodeCompanyLogo(
    record: Awaited<ReturnType<ProductionFlowRepository['findPrivate']>>,
    pending = false,
  ) {
    if (!record) throw new OrdersError('MEDIA_NOT_FOUND', 'Company logo was not found.', 404);
    const stored = JSON.parse(await this.store.decrypt(record.payload));
    const image = pending || stored?.image ? stored.image : stored;
    return decodeStoredCatalogueImage(image);
  }
  async state(sessionId?: string) {
    const session = await this.session(sessionId);
    const [listings, orderEvents, locations, shipmentEvents, transferEvents] = await Promise.all([
      this.gateway.events('orders', 'ItemListed'),
      this.gateway.events('orders', 'OrderRequested'),
      this.gateway.events('orders', 'LocationRegistered'),
      this.gateway.events('orders', 'ShipmentDispatched'),
      this.gateway.events('custody', 'OrderTransferLinked'),
    ]);
    const catalogue = await Promise.all(
      [...new Set(listings.map((entry) => entry.itemId))].map(async (itemId) => {
        const item = await this.gateway.read('orders', 'getItem', [itemId]);
        const batches = [
          ...new Set(
            listings.filter((entry) => entry.itemId === itemId).map((entry) => entry.batchId),
          ),
        ];
        const batchDetails = await Promise.all(
          batches.map(async (batchId) => {
            const batch = await this.gateway.read(
              Number(item.kind) === 1 ? 'ingredients' : 'products',
              Number(item.kind) === 1 ? 'getBatch' : 'getProduct',
              [batchId],
            );
            return {
              batchId,
              expiresAt: batch.expiresAt,
              producedAt: batch.producedAt,
              status: batch.status,
              totalQuantity: batch.totalQuantity,
              ...(Number(item.kind) === 1
                ? { supplierAvailable: batch.availableQuantity }
                : {
                    producedAt: batch.producedAt,
                    recordedAt: await this.gateway.read('products', 'productionRecordedAt', [
                      batchId,
                    ]),
                    productionLocation: await this.gateway.read('products', 'productionLocation', [
                      batchId,
                    ]),
                    ingredientLinks: await this.gateway.read('products', 'getIngredientLinks', [
                      batchId,
                    ]),
                  }),
            };
          }),
        );
        return { ...item, itemId, unit: decodeBytes32String(item.unit), batches, batchDetails };
      }),
    );
    for (const kind of [1, 2]) {
      const events = await this.gateway.events(
        kind === 1 ? 'ingredients' : 'products',
        kind === 1 ? 'IngredientBatchRegistered' : 'ProductCreated',
      );
      for (const event of events) {
        const batchId = event.batchId ?? event.productBatchId;
        if (!batchId) continue;
        const batch = await this.catalogueBatch(kind, batchId);
        const summary = await this.discoverBatch(kind, batchId, batch);
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
                    producedAt: batch.producedAt,
                    ingredientLinks: await this.gateway.read('products', 'getIngredientLinks', [
                      batchId,
                    ]),
                  }),
            },
          ],
        } as any);
      }
    }
    const approvedReceiptsSupported =
      Number(await this.optionalRead('orders', 'approvedReceiptPolicy')) === 1;
    const ingredientDeliverySupported =
      Number(await this.optionalRead('orders', 'ingredientDeliveryPolicy')) === 1;
    const warehouseSupported =
      ingredientDeliverySupported &&
      Number(await this.optionalRead('delivery', 'custodyPolicy')) === 1;
    const shipmentReviewSupported =
      warehouseSupported && Number(await this.optionalRead('delivery', 'reviewPolicy')) === 1;
    const fulfilmentSupported =
      warehouseSupported && Number(await this.optionalRead('delivery', 'fulfilmentPolicy')) === 2;
    const productDeliverySupported =
      Number(await this.optionalRead('custody', 'productDeliveryPolicy')) === 1;
    const logistics = warehouseSupported
      ? await readLogistics(
          this.gateway,
          session.address,
          session.role === CompanyRole.SYSTEM_ADMIN,
          shipmentReviewSupported,
          productDeliverySupported,
        )
      : undefined;
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
    if (listingKind) {
      const registered = await this.gateway.events(
        listingKind === 1 ? 'ingredients' : 'products',
        listingKind === 1 ? 'IngredientBatchRegistered' : 'ProductCreated',
      );
      for (const entry of registered) {
        if (!same(listingKind === 1 ? entry.supplier : entry.manufacturer, actor)) continue;
        const batch = await this.catalogueBatch(listingKind, entry.batchId);
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
    for (const event of transferEvents) {
      const transfer = await this.gateway.read('custody', 'getTransfer', [event.transferId]);
      const linkedOrder = await this.gateway.read('orders', 'getOrder', [event.orderId]);
      if (
        admin ||
        same(actor, transfer.sender) ||
        same(actor, transfer.recipient) ||
        same(actor, linkedOrder.seller) ||
        same(actor, linkedOrder.buyer)
      )
        ownTransfers.set(event.transferId, {
          ...transfer,
          shipmentId: event.transferId,
          orderId: event.orderId,
          missing: await this.gateway.read('custody', 'missingQuantity', [event.transferId]),
          receivedAt: await this.gateway.read('custody', 'receiptOccurredAt', [event.transferId]),
          receiptRecordedAt: await this.gateway.read('custody', 'receiptRecordedAt', [
            event.transferId,
          ]),
          occurredAt: await this.gateway.read('custody', 'reportedDispatchAt', [event.transferId]),
          fromLocation: await this.gateway.read('custody', 'dispatchLocation', [event.transferId]),
          toLocation: await this.gateway.read('custody', 'receivingLocation', [event.transferId]),
          product: true,
        });
    }
    for (const event of orderEvents) {
      const order = await this.gateway.read('orders', 'getOrder', [event.orderId]);
      const custody = warehouseSupported
        ? await this.gateway.read('delivery', 'custodyOrders', [event.orderId])
        : undefined;
      const custodyPosition =
        custody && logistics?.positions.find((entry) => entry.positionId === custody.positionId);
      const delivery = ingredientDeliverySupported
        ? await this.gateway.read('delivery', 'get', [event.orderId])
        : undefined;
      const productDelivery = productDeliverySupported
        ? await this.gateway.read('productDelivery', 'get', [event.orderId])
        : undefined;
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
      if (!involved) continue;
      const record = await this.repository.findPrivate('products', event.orderId);
      const details =
        record && record.contentHash === order.detailsHash && record.cid === order.detailsCid
          ? JSON.parse(await this.store.decrypt(record.payload))
          : undefined;
      const decision = await this.loadRequestDecision(event.orderId, order.seller);
      const deliveryReceivingLocation =
        typeof details?.receivingLocation === 'string' &&
        same(
          await this.gateway.read('orders', 'locationOwner', [details.receivingLocation]),
          order.buyer,
        )
          ? details.receivingLocation
          : undefined;
      orders.push({
        custodyOrder: custodyPosition
          ? {
              ...custody,
              ...cataloguePosition(custodyPosition),
              positionId: custody.positionId,
              quantity: custody.quantity,
              arranged: shipmentReviewSupported
                ? await this.gateway.read('delivery', 'deliveryArranged', [event.orderId])
                : false,
            }
          : undefined,
        ...order,
        deliveryReceivingLocation,
        productDelivery:
          productDelivery && Number(productDelivery.mode) > 0 ? productDelivery : undefined,
        productDeliveryQr:
          productDelivery && Number(productDelivery.mode) > 0
            ? this.productOrderQr(event.orderId)
            : undefined,
        orderId: event.orderId,
        details:
          same(actor, delivery?.distributor) ||
          same(actor, custodyPosition?.distributor) ||
          same(actor, productDelivery?.distributor)
            ? undefined
            : details,
        delivery: delivery && Number(delivery.stage) > 0 ? delivery : undefined,
        evidenceIds: await this.gateway.read('orders', 'getOrderEvidence', [event.orderId]),
        decision:
          (same(actor, delivery?.distributor) ||
            same(actor, custodyPosition?.distributor) ||
            same(actor, productDelivery?.distributor)) &&
          decision
            ? { status: decision.status, recordedAt: decision.recordedAt }
            : decision,
        requestedBatch: approvedReceiptsSupported
          ? await this.gateway.read('orders', 'requestedBatch', [event.orderId])
          : undefined,
        approvedReceivedQuantity: approvedReceiptsSupported
          ? await this.gateway.read('orders', 'approvedReceivedQuantity', [event.orderId])
          : undefined,
        isRequestOnly: await this.optionalRead('orders', 'requestOnly', [event.orderId]),
      });
    }
    const visibleOrderIds = new Set(orders.map((order) => order.orderId));
    for (const event of shipmentEvents) {
      const shipment = await this.gateway.read('orders', 'getShipment', [event.shipmentId]);
      if (!visibleOrderIds.has(event.orderId) && !same(actor, shipment.recipient)) continue;
      const item = catalogue.find(
        (item) => item.itemId === orders.find((order) => order.orderId === event.orderId)?.itemId,
      );
      if (Number(item?.kind) === 2 || ownTransfers.has(event.shipmentId)) {
        const transfer = await this.gateway.read('custody', 'getTransfer', [event.shipmentId]);
        shipments.push({
          ...shipment,
          ...transfer,
          ...ownTransfers.get(event.shipmentId),
          shipmentId: event.shipmentId,
          missing: await this.gateway.read('custody', 'missingQuantity', [event.shipmentId]),
          product: true,
        });
      } else {
        const stock = await this.gateway.read('ingredients', 'getReceivedStock', [
          shipment.batchId,
          shipment.recipient,
          shipment.toLocation,
        ]);
        shipments.push({ ...shipment, shipmentId: event.shipmentId, product: false, stock });
      }
    }
    for (const [key, transfer] of ownTransfers)
      if (!shipments.some((shipment) => shipment.shipmentId === key)) shipments.push(transfer);
    const safeLocations = await Promise.all(
      locations.map(async (location) => {
        if (
          !same(actor, location.company) &&
          !orders.some(
            (order) =>
              order.custodyOrder?.receivingLocation === location.location ||
              order.deliveryReceivingLocation === location.location,
          )
        )
          return { location: location.location, company: location.company };
        const record = await this.repository.findPrivate('products', location.location);
        const label =
          record && record.contentHash === location.detailsHash
            ? JSON.parse(await this.store.decrypt(record.payload)).label
            : 'Location label unavailable';
        return {
          location: location.location,
          company: location.company,
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
    const directoryCompanies = (await this.directory?.list()) ?? [];
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
      identities.map(async (identity) => {
        const logo = await this.companyLogoRecord(identity.walletAddress, identity.applicationId);
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
        };
        const hash = `0x${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
        const stored = await this.privateRecord(
          id(`ingredient-listing:${input.batchId.toLowerCase()}:${hash.toLowerCase()}`),
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
      const hash = `0x${createHash('sha256').update(JSON.stringify(details)).digest('hex')}`;
      const stored = await this.privateRecord(
        id(`request-decision:${input.orderId.toLowerCase()}:${hash.toLowerCase()}`),
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
      });
      method = 'registerLocation';
      args = [operationKey, stored.contentHash];
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
      args = [input.batchId, 3, stored.contentHash];
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
          const record = await this.repository.findPrivate('products', correction.correctionId);
          const values =
            record && record.contentHash === correction.valuesHash
              ? JSON.parse(await this.store.decrypt(record.payload))
              : undefined;
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

function mediaKey(kind: 'company' | 'ingredient', reference: string) {
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
  ];
}
