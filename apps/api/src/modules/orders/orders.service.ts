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
import { CompanyRole } from '@tracechain/shared';
import type { AuthService } from '../auth/auth.service.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { ProductionFlowRepository } from '../production-flow/production-flow.repository.js';
import type { OrdersGateway, ChainRecord } from './orders.gateway.js';
import type { OrderAction } from './orders.schema.js';
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
  ) {}
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
  ) {
    const session = await this.session(sessionId);
    const order = await this.gateway.read('orders', 'getOrder', [orderId]);
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
      const transaction = await this.gateway.prepare(session.address, 'orders', 'requestIdentity', [
        orderId,
        id(proof.challenge),
        id(input.purpose),
        id(JSON.stringify({ required: input.requiredClaims, optional: input.optionalClaims })),
        proof.expiresAt,
        !!input.required,
      ]);
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
    if (input.action === 'status')
      return this.flow.getCompanyIdentityProofStatus(sessionId, orderId);
    if (input.action === 'verify') {
      const proof = await this.flow.orderIdentityAttestation(sessionId, orderId);
      if (
        same(order.identityCredentialHash, proof.credentialHash) &&
        same(order.identityChallenge, proof.challengeHash) &&
        Number(order.identityValidUntil) >= proof.expiresAt
      )
        return { state: 'COMPLETE', checks: proof.checks };
      return {
        checks: proof.checks,
        transaction: await this.gateway.prepare(session.address, 'orders', 'attestIdentity', [
          orderId,
          proof.challengeHash,
          proof.credentialHash,
          proof.presentationHash,
          proof.expiresAt,
        ]),
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

  async myBranding(sessionId: string | undefined) {
    const session = await this.authorizedSession(sessionId);
    const identity = await this.directory?.resolve(session.address);
    if (!identity)
      throw new OrdersError(
        'COMPANY_IDENTITY_REQUIRED',
        'A current verified company identity is required.',
        403,
      );
    const logo = await this.repository.findPrivate(
      'products',
      mediaKey('company', session.address),
    );
    return {
      branding: {
        companyName: identity.companyName,
        logoPath:
          logo && same(logo.owner, session.address)
            ? `/branding/${getAddress(session.address)}/logo`
            : undefined,
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
      if (!(await this.directory?.resolve(owner)))
        throw new OrdersError('MEDIA_NOT_FOUND', 'Catalogue media was not found.', 404);
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
    const orders: ChainRecord[] = [];
    const shipments: ChainRecord[] = [];
    const actor = session.address;
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
      const involved = admin || same(actor, order.buyer) || same(actor, order.seller);
      if (!involved) continue;
      const record = await this.repository.findPrivate('products', event.orderId);
      const details =
        record && record.contentHash === order.detailsHash && record.cid === order.detailsCid
          ? JSON.parse(await this.store.decrypt(record.payload))
          : undefined;
      orders.push({
        ...order,
        orderId: event.orderId,
        details,
        evidenceIds: await this.gateway.read('orders', 'getOrderEvidence', [event.orderId]),
        decision: await this.loadRequestDecision(event.orderId, order.seller),
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
        if (!same(actor, location.company))
          return { location: location.location, company: location.company };
        const record = await this.repository.findPrivate('products', location.location);
        const label =
          record && record.contentHash === location.detailsHash
            ? JSON.parse(await this.store.decrypt(record.payload)).label
            : 'Location label unavailable';
        return { location: location.location, company: location.company, label };
      }),
    );
    const wallets = [
      ...new Set([
        ...catalogue.map((item) => item.seller),
        ...orders.flatMap((order) => [order.buyer, order.seller]),
        ...shipments.flatMap((shipment) => [shipment.sender, shipment.recipient]),
      ]),
    ];
    const identities = (await this.directory?.resolveMany(wallets)) ?? [];
    const name = (wallet: string) =>
      identities.find((identity) => same(identity.walletAddress, wallet))?.companyName;
    const role = (wallet: string) =>
      identities.find((identity) => same(identity.walletAddress, wallet))?.role;
    const logoWallets = new Set<string>();
    await Promise.all(
      identities.map(async (identity) => {
        const logo = await this.repository.findPrivate(
          'products',
          mediaKey('company', identity.walletAddress),
        );
        if (logo && same(logo.owner, identity.walletAddress))
          logoWallets.add(identity.walletAddress.toLowerCase());
      }),
    );
    return {
      actor,
      listingBatches,
      role: session.role,
      catalogue: catalogue.map((item) => ({
        ...item,
        sellerName: name(item.seller),
        sellerRole: role(item.seller),
        sellerLogoPath: logoWallets.has(item.seller.toLowerCase())
          ? `/branding/${getAddress(item.seller)}/logo`
          : undefined,
      })),
      orders: orders.map((order) => ({
        ...order,
        buyerName: name(order.buyer),
        sellerName: name(order.seller),
      })),
      shipments: shipments.map((shipment): ChainRecord => ({
        ...shipment,
        senderName: name(shipment.sender),
        recipientName: name(shipment.recipient),
      })),
      locations: safeLocations,
    };
  }
  async prepare(sessionId: string | undefined, input: OrderAction) {
    const session = await this.session(sessionId);
    const operationKey = id(
      `${this.gateway.chainId}:${this.gateway.address}:${session.address.toLowerCase()}:${input.operationId}`,
    );
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
    if (input.action === 'ingredient-update' || input.action === 'ingredient-archive') {
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
      const stored = await this.privateRecord(operationKey, session.address, {
        note: input.note,
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
      }
      if (input.requestOnly) {
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
      method = 'closeOrder';
      args = [input.orderId];
    } else if (input.action === 'evidence' || input.action === 'bind-evidence') {
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

function validateImage(input: CatalogueImageInput) {
  try {
    return validateCatalogueImage(input);
  } catch (error) {
    if (error instanceof CatalogueImageError) throw new OrdersError(error.code, error.message, 400);
    throw error;
  }
}
