import { createHash } from 'node:crypto';
import { decodeBytes32String, id } from 'ethers';
import { CompanyRole } from '@tracechain/shared';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { OrdersGateway, ChainRecord } from './orders.gateway.js';
const same = (left?: string, right?: string) =>
  !!left && !!right && left.toLowerCase() === right.toLowerCase();
export class CustodyOfferError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export interface CustodyOffer {
  offerId: string;
  operationId: string;
  chainId: number;
  ordersAddress: string;
  sender: string;
  distributor: string;
  kind: 1 | 2;
  batchId: string;
  metadataHash: string;
  quantity: string;
  unit: string;
  fromLocation: string;
  toLocation: string;
  expiresAt: number;
  createdAt: string;
  status:
    'REQUESTED' | 'ACCEPTED' | 'SCHEDULED' | 'REJECTED' | 'DISPATCHED' | 'RECEIVED' | 'EXPIRED';
  pickupAt?: number;
  dispatchOperationId?: string;
  shipmentId?: string;
  registrationBlockHash: string;
  reviewedAt?: string;
  reviewedBy?: string;
  pickupArrangedAt?: string;
}
interface Dependencies {
  gateway: OrdersGateway;
  repository: ProductionFlowRepository;
  store: CredentialContentStore;
  session: (sessionId?: string) => Promise<{ address: string; role?: string }>;
  prepare: (sessionId: string | undefined, input: any) => Promise<any>;
  proofCheck: (sessionId: string | undefined, offer: CustodyOffer) => Promise<void>;
}
export class CustodyOffers {
  private locks = new Set<string>();
  constructor(private dependencies: Dependencies) {}
  private async registration(kind: 1 | 2, batchId: string) {
    return (
      await this.dependencies.gateway.events(
        kind === 1 ? 'ingredients' : 'products',
        kind === 1 ? 'IngredientBatchRegistered' : 'ProductCreated',
      )
    ).find((event) => same(event.batchId ?? event.productBatchId, batchId))?.blockHash as
      string | undefined;
  }
  private async exclusive<T>(key: string, action: () => Promise<T>) {
    if (this.locks.has(key))
      throw new CustodyOfferError(
        'OFFER_BUSY',
        'This custody request is being updated. Refresh before retrying.',
      );
    this.locks.add(key);
    try {
      return await action();
    } finally {
      this.locks.delete(key);
    }
  }
  private async save(offer: CustodyOffer) {
    const serialized = JSON.stringify(offer),
      contentHash = `0x${createHash('sha256').update(serialized).digest('hex')}`;
    const encrypted = await this.dependencies.store.encryptAndStore(serialized, offer.offerId);
    await this.dependencies.repository.savePrivate('transfers', {
      id: offer.offerId,
      owner: offer.sender,
      recordType: 'custody-offer',
      participants: [offer.sender, offer.distributor],
      contentHash,
      cid: encrypted.cid,
      payload: encrypted.payload,
    });
  }
  async lookup(offerId: string, actor?: string): Promise<CustodyOffer | undefined> {
    const { repository, store, gateway } = this.dependencies;
    const record = await repository.findPrivate('transfers', offerId);
    if (
      !record ||
      record.recordType !== 'custody-offer' ||
      (actor && !record.participants?.some((wallet) => same(wallet, actor)))
    )
      return undefined;
    const serialized = await store.decrypt(record.payload);
    if (!same(record.contentHash, `0x${createHash('sha256').update(serialized).digest('hex')}`))
      throw new CustodyOfferError(
        'OFFER_UNAVAILABLE',
        'Custody request data failed its integrity check.',
        503,
      );
    const offer = JSON.parse(serialized) as CustodyOffer;
    if (
      !same(offer.offerId, offerId) ||
      !same(record.owner, offer.sender) ||
      !record.participants?.some((wallet) => same(wallet, offer.distributor)) ||
      offer.chainId !== gateway.chainId ||
      !same(offer.ordersAddress, gateway.address)
    )
      return undefined;
    const batch = await gateway.read(
      offer.kind === 1 ? 'ingredients' : 'products',
      offer.kind === 1 ? 'getBatch' : 'getProduct',
      [offer.batchId],
    );
    if (
      !same(offer.kind === 1 ? batch.supplier : batch.manufacturer, offer.sender) ||
      !same(batch.metadataHash, offer.metadataHash)
    )
      return undefined;
    if (!same(await this.registration(offer.kind, offer.batchId), offer.registrationBlockHash))
      return undefined;
    if (
      !same(await gateway.read('orders', 'locationOwner', [offer.fromLocation]), offer.sender) ||
      !same(await gateway.read('orders', 'locationOwner', [offer.toLocation]), offer.distributor)
    )
      return undefined;
    if (offer.shipmentId) {
      const shipment = await gateway.read(
        offer.kind === 1 ? 'delivery' : 'custody',
        offer.kind === 1 ? 'getRoadShipment' : 'getTransfer',
        [offer.shipmentId],
      );
      if (
        same(shipment.sender, offer.sender) &&
        same(shipment.recipient, offer.distributor) &&
        same(shipment.batchId ?? shipment.productBatchId, offer.batchId) &&
        String(shipment.quantity) === offer.quantity
      ) {
        const from =
          offer.kind === 1
            ? shipment.fromLocation
            : await gateway.read('custody', 'dispatchLocation', [offer.shipmentId]);
        const to =
          offer.kind === 1
            ? shipment.toLocation
            : await gateway.read('custody', 'receivingLocation', [offer.shipmentId]);
        if (!same(from, offer.fromLocation) || !same(to, offer.toLocation)) return undefined;
        offer.status =
          Number(shipment.status) === (offer.kind === 1 ? 3 : 2) ? 'RECEIVED' : 'DISPATCHED';
      } else if (Number(shipment.status) > 0)
        throw new CustodyOfferError(
          'OFFER_UNAVAILABLE',
          'The recorded shipment does not match this custody request.',
          503,
        );
    }
    if (
      !['DISPATCHED', 'RECEIVED', 'REJECTED'].includes(offer.status) &&
      offer.expiresAt <= Date.now() / 1000
    )
      offer.status = 'EXPIRED';
    return offer;
  }
  async list(sessionId?: string) {
    const session = await this.dependencies.session(sessionId);
    if (!this.dependencies.repository.listPrivate)
      throw new CustodyOfferError(
        'OFFER_STORAGE_UNAVAILABLE',
        'Custody request storage is unavailable.',
        503,
      );
    const rows = [];
    for (const record of await this.dependencies.repository.listPrivate('transfers')) {
      if (
        record.recordType !== 'custody-offer' ||
        !record.participants?.some((wallet) => same(wallet, session.address))
      )
        continue;
      const offer = await this.lookup(record.id, session.address);
      if (offer) rows.push(offer);
    }
    return { offers: rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt)) };
  }
  async get(sessionId: string | undefined, offerId: string) {
    const session = await this.dependencies.session(sessionId);
    const offer = await this.lookup(offerId, session.address);
    if (!offer)
      throw new CustodyOfferError(
        'OFFER_NOT_FOUND',
        'This custody request is not available to your company.',
        404,
      );
    return offer;
  }
  async create(
    sessionId: string | undefined,
    input: {
      operationId: string;
      kind: 1 | 2;
      batchId: string;
      quantity: string;
      fromLocation: string;
      toLocation: string;
      distributor: string;
      expiresAt: number;
    },
  ) {
    const session = await this.dependencies.session(sessionId),
      { gateway } = this.dependencies;
    if (session.role !== (input.kind === 1 ? CompanyRole.SUPPLIER : CompanyRole.MANUFACTURER))
      throw new CustodyOfferError(
        'SENDER_ROLE_REQUIRED',
        'Only the owning Supplier or Manufacturer can offer its stock to custody.',
        403,
      );
    const offerId = id(
      `custody-offer:${gateway.chainId}:${gateway.address.toLowerCase()}:${session.address.toLowerCase()}:${input.operationId}`,
    );
    return this.exclusive(offerId, async () => {
      if (await this.dependencies.repository.findPrivate('transfers', offerId))
        throw new CustodyOfferError(
          'OFFER_EXISTS',
          'This request has already been created. Refresh to view it.',
        );
      const batch = await gateway.read(
        input.kind === 1 ? 'ingredients' : 'products',
        input.kind === 1 ? 'getBatch' : 'getProduct',
        [input.batchId],
      );
      if (!same(input.kind === 1 ? batch.supplier : batch.manufacturer, session.address))
        throw new CustodyOfferError(
          'BATCH_NOT_FOUND',
          'Only your company’s stock can be offered.',
          404,
        );
      if (Number(batch.status) !== 1 || Number(batch.expiresAt) <= Date.now() / 1000)
        throw new CustodyOfferError(
          'SOURCE_UNAVAILABLE',
          'The source batch is not active and unexpired.',
        );
      if (
        !(await gateway.read('stakeholders', 'isAuthorized', [input.distributor, 4])) ||
        !same(
          (await gateway.read('delivery', 'warehouses', [input.toLocation])).distributor,
          input.distributor,
        )
      )
        throw new CustodyOfferError(
          'WAREHOUSE_UNAVAILABLE',
          'Choose an authorized Distributor warehouse.',
        );
      if (
        !same(
          await gateway.read('orders', 'locationOwner', [input.fromLocation]),
          session.address,
        ) ||
        !same(await gateway.read('orders', 'locationOwner', [input.toLocation]), input.distributor)
      )
        throw new CustodyOfferError(
          'LOCATION_NOT_OWNED',
          'The selected route does not belong to the sender and Distributor.',
          403,
        );
      const tracked =
        input.kind === 2
          ? await gateway.read('custody', 'locationTracked', [input.batchId, session.address])
          : false;
      const available =
        input.kind === 1
          ? batch.availableQuantity
          : tracked
            ? await gateway.read('custody', 'locationStock', [
                input.batchId,
                session.address,
                input.fromLocation,
              ])
            : same(
                  await gateway.read('products', 'productionLocation', [input.batchId]),
                  input.fromLocation,
                )
              ? (await gateway.read('custody', 'getInventory', [input.batchId, session.address]))
                  .available
              : '0';
      if (BigInt(input.quantity) > BigInt(available))
        throw new CustodyOfferError(
          'INSUFFICIENT_STOCK',
          'There is not enough available stock for this offer.',
        );
      if (input.expiresAt <= Date.now() / 1000 || input.expiresAt > Number(batch.expiresAt))
        throw new CustodyOfferError(
          'INVALID_DEADLINE',
          'Choose a future request deadline before the batch expires.',
          400,
        );
      const unit =
        typeof batch.unit === 'string' && batch.unit.startsWith('0x')
          ? decodeBytes32String(batch.unit)
          : String(batch.unit);
      const registrationBlockHash = await this.registration(input.kind, input.batchId);
      if (!registrationBlockHash)
        throw new CustodyOfferError(
          'REGISTRATION_UNAVAILABLE',
          'The source registration could not be checked. Refresh before creating the offer.',
          503,
        );
      const offer: CustodyOffer = {
        ...input,
        offerId,
        chainId: gateway.chainId,
        ordersAddress: gateway.address,
        sender: session.address,
        metadataHash: batch.metadataHash,
        registrationBlockHash,
        unit,
        createdAt: new Date().toISOString(),
        status: 'REQUESTED',
      };
      await this.save(offer);
      return { offer };
    });
  }
  async act(
    sessionId: string | undefined,
    offerId: string,
    input: { action: 'accept' | 'reject' | 'schedule'; pickupAt?: number },
  ) {
    return this.exclusive(offerId, async () => {
      const session = await this.dependencies.session(sessionId),
        offer = await this.get(sessionId, offerId);
      if (
        !(await this.dependencies.gateway.read('stakeholders', 'isAuthorized', [
          offer.sender,
          offer.kind === 1 ? 2 : 3,
        ])) ||
        !(await this.dependencies.gateway.read('stakeholders', 'isAuthorized', [
          offer.distributor,
          4,
        ]))
      )
        throw new CustodyOfferError(
          'PARTICIPANT_UNAUTHORIZED',
          'The sender and Distributor must both remain authorized.',
        );
      if (session.role !== CompanyRole.DISTRIBUTOR || !same(offer.distributor, session.address))
        throw new CustodyOfferError(
          'DISTRIBUTOR_REQUIRED',
          'Only the assigned Distributor can review or schedule this offer.',
          403,
        );
      if (!['REQUESTED', 'ACCEPTED', 'SCHEDULED'].includes(offer.status) || offer.shipmentId)
        throw new CustodyOfferError(
          'OFFER_CLOSED',
          'This offer cannot be changed at its current stage.',
        );
      if (input.action !== 'reject') await this.dependencies.proofCheck(sessionId, offer);
      if (input.action === 'accept') {
        if (offer.status !== 'REQUESTED')
          throw new CustodyOfferError(
            'OFFER_ALREADY_REVIEWED',
            'This offer has already been reviewed.',
          );
        offer.status = 'ACCEPTED';
        offer.reviewedAt = new Date().toISOString();
        offer.reviewedBy = session.address;
      } else if (input.action === 'reject') {
        offer.status = 'REJECTED';
        offer.reviewedAt = new Date().toISOString();
        offer.reviewedBy = session.address;
      } else {
        if (!['ACCEPTED', 'SCHEDULED'].includes(offer.status))
          throw new CustodyOfferError('ACCEPT_FIRST', 'Accept this offer before arranging pickup.');
        if (
          !input.pickupAt ||
          input.pickupAt <= Date.now() / 1000 ||
          input.pickupAt >= offer.expiresAt
        )
          throw new CustodyOfferError(
            'INVALID_PICKUP_TIME',
            'Choose a future pickup before the request expires.',
            400,
          );
        offer.pickupAt = input.pickupAt;
        offer.pickupArrangedAt = new Date().toISOString();
        offer.status = 'SCHEDULED';
      }
      await this.save(offer);
      return { offer };
    });
  }
  async prepare(
    sessionId: string | undefined,
    offerId: string,
    input: { vehicle: string; occurredAt: number; expectedAt: number },
  ) {
    return this.exclusive(offerId, async () => {
      const session = await this.dependencies.session(sessionId),
        offer = await this.get(sessionId, offerId);
      if (
        !(await this.dependencies.gateway.read('stakeholders', 'isAuthorized', [
          offer.sender,
          offer.kind === 1 ? 2 : 3,
        ])) ||
        !(await this.dependencies.gateway.read('stakeholders', 'isAuthorized', [
          offer.distributor,
          4,
        ]))
      )
        throw new CustodyOfferError(
          'PARTICIPANT_UNAUTHORIZED',
          'The sender and Distributor must both remain authorized.',
        );
      if (!same(offer.sender, session.address))
        throw new CustodyOfferError(
          'SENDER_REQUIRED',
          'Only the original sender confirms the physical handoff.',
          403,
        );
      if (offer.status !== 'SCHEDULED' || !offer.pickupAt)
        throw new CustodyOfferError(
          'PICKUP_NOT_ARRANGED',
          'The Distributor must accept and schedule pickup before handoff.',
        );
      await this.dependencies.proofCheck(sessionId, offer);
      const operationId = offer.dispatchOperationId ?? offer.operationId;
      const shipmentId = id(
        `logistics:${this.dependencies.gateway.chainId}:${this.dependencies.gateway.address}:${session.address.toLowerCase()}:${operationId}`,
      );
      const prepared = await this.dependencies.prepare(sessionId, {
        ...input,
        operationId,
        action: offer.kind === 1 ? 'stock-dispatch' : 'product-dispatch',
        batchId: offer.batchId,
        quantity: offer.quantity,
        fromLocation: offer.fromLocation,
        toLocation: offer.toLocation,
        ...(offer.kind === 2 ? { recipient: offer.distributor } : {}),
      });
      offer.dispatchOperationId = operationId;
      offer.shipmentId = shipmentId;
      await this.save(offer);
      return { ...prepared, offerId };
    });
  }
}
