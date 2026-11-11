import { CompanyRole, TransferQrError, decodeTransferQrPayload } from '@tracechain/shared';
import { randomUUID } from 'node:crypto';
import { getAddress, sha256, toUtf8Bytes } from 'ethers';

import type { AuthService } from '../auth/auth.service.js';
import type { TraceabilityMetadataReader } from '../product-traceability/product-traceability.types.js';
import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { StakeholderDirectory } from '../stakeholder-directory/stakeholder-directory.service.js';
import type { CustodyTransferGateway } from './custody-transfer.gateway.js';
import type {
  ReceiptWorkflowRecord,
  ReceiptWorkflowReference,
  ReceiptWorkflowRepository,
} from './custody-transfer.repository.js';
import {
  prepareReceiptConfirmationRequestSchema,
  rejectTransferRequestSchema,
  resolveDiscrepancyRequestSchema,
  resolveTransferQrRequestSchema,
  transferIdParameterSchema,
} from './custody-transfer.schema.js';
import type {
  CustodyTransferConfiguration,
  CustodyTransferRecord,
  CustodyTransferSummary,
  ReceiptEvidenceInput,
} from './custody-transfer.types.js';

const AWAITING_RECEIPT_STATUS = 1;
const DISCREPANCY_REPORTED_STATUS = 5;
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

export class CustodyTransferApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface CustodyTransferServiceDependencies {
  authService: AuthService;
  clock?: () => Date;
  configuration: () => CustodyTransferConfiguration;
  contentStore?: CredentialContentStore;
  gateway: CustodyTransferGateway;
  productMetadata?: Pick<TraceabilityMetadataReader, 'product'>;
  receiptRepository?: ReceiptWorkflowRepository;
  stakeholderDirectory?: StakeholderDirectory;
}

export class CustodyTransferService {
  private readonly clock: () => Date;
  private readonly workflowWrites = new Map<string, Promise<ReceiptWorkflowRecord>>();

  constructor(private readonly dependencies: CustodyTransferServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async resolveQr(sessionId: string | undefined, body: unknown): Promise<CustodyTransferSummary> {
    const session = await this.requireAuthorizedSession(sessionId);
    const inputResult = resolveTransferQrRequestSchema.safeParse(body);
    if (!inputResult.success)
      throw new CustodyTransferApiError('INVALID_REQUEST', 'The QR request is invalid.', 400);
    let qr;
    try {
      qr = decodeTransferQrPayload(inputResult.data.qrPayload);
    } catch (error) {
      if (error instanceof TransferQrError)
        throw new CustodyTransferApiError(
          'INVALID_TRANSFER_QR',
          'The custody-transfer QR payload is invalid.',
          400,
        );
      throw error;
    }
    const configuration = this.dependencies.configuration();
    if (qr.chainId !== configuration.chainId)
      throw new CustodyTransferApiError(
        'QR_CHAIN_MISMATCH',
        'The QR code is for a different blockchain network.',
        400,
      );
    if (getAddress(qr.custodyTransferAddress) !== getAddress(configuration.contractAddress))
      throw new CustodyTransferApiError(
        'QR_CONTRACT_MISMATCH',
        'The QR code does not reference the configured CustodyTransfer contract.',
        400,
      );
    const transfer = await this.lookupTransfer(qr.transferId);
    if (transfer.status !== AWAITING_RECEIPT_STATUS)
      throw new CustodyTransferApiError(
        'TRANSFER_NOT_AWAITING_RECEIPT',
        'The custody transfer is not awaiting receipt.',
        409,
      );
    this.requireRecipient(session.address, transfer.recipient);
    return this.safeSummary(qr.transferId, transfer);
  }

  async getTransfer(sessionId: string | undefined, parameters: unknown) {
    const session = await this.requireAuthorizedSession(sessionId);
    const transferId = this.transferId(parameters);
    const transfer = await this.lookupTransfer(transferId);
    this.requireParticipantOrAdmin(session.address, session.onChainAuthorization?.role, transfer);
    const summary = await this.safeSummary(transferId, transfer);
    if (transfer.status !== 2) return summary;
    const details = await this.authoritativePrivateDetails(transferId, transfer);
    return {
      ...summary,
      actualArrivalAt:
        typeof details?.actualArrivalAt === 'string' ? details.actualArrivalAt : null,
    };
  }

  async prepareReceiptConfirmation(sessionId: string | undefined, body: unknown) {
    const session = await this.requireAuthorizedSession(sessionId);
    const parsed = prepareReceiptConfirmationRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new CustodyTransferApiError(
        'INVALID_RECEIPT',
        parsed.error.issues[0]?.message ?? 'The receipt details are invalid.',
        400,
      );
    const input = parsed.data;
    const transfer = await this.awaitingRecipientTransfer(session.address, input.transferId);
    const actual = BigInt(input.actualQuantity);
    const damaged = BigInt(input.damagedQuantity);
    const rejected = BigInt(input.rejectedQuantity);
    if (damaged + rejected > actual)
      throw new CustodyTransferApiError(
        'INVALID_RECEIPT_QUANTITIES',
        'Damaged plus rejected quantities cannot exceed the actual received quantity.',
        400,
      );
    const usable = actual - damaged - rejected;
    if (actual !== transfer.quantity && !input.notes)
      throw new CustodyTransferApiError(
        'DISCREPANCY_EXPLANATION_REQUIRED',
        'Explain the shortage or excess before reporting it.',
        400,
      );
    const kind = actual === transfer.quantity ? 'RECEIPT' : 'DISCREPANCY';
    const serialized = canonical({
      actualArrivalAt: input.actualArrivalAt ?? null,
      actualQuantity: input.actualQuantity,
      damagedQuantity: input.damagedQuantity,
      evidence: validateEvidence(input.evidence),
      expectedQuantity: transfer.quantity.toString(),
      notes: input.notes,
      rejectedQuantity: input.rejectedQuantity,
      transferId: input.transferId,
      usableQuantity: usable.toString(),
      version: 1,
    });
    const record = await this.storeWorkflow(input.transferId, session.address, kind, serialized);
    const configuration = this.dependencies.configuration();
    if (kind === 'DISCREPANCY') {
      return {
        action: 'REPORT_DISCREPANCY' as const,
        discrepancyType: actual < transfer.quantity ? 'SHORTAGE' : 'EXCESS',
        transaction: this.dependencies.gateway.prepareDiscrepancyReport({
          actualQuantity: actual,
          chainId: configuration.chainId,
          contractAddress: configuration.contractAddress,
          detailsHash: record.contentHash,
          evidenceCid: record.cid,
          kind: actual < transfer.quantity ? 1 : 2,
          transferId: input.transferId,
        }),
        usableQuantity: usable.toString(),
      };
    }
    return {
      action: 'CONFIRM_RECEIPT' as const,
      transaction: this.dependencies.gateway.prepareReceiptConfirmation({
        chainId: configuration.chainId,
        contractAddress: configuration.contractAddress,
        damaged,
        quantity: actual,
        receiptCid: record.cid,
        receiptHash: record.contentHash,
        rejected,
        transferId: input.transferId,
      }),
      usableQuantity: usable.toString(),
    };
  }

  async prepareRejection(sessionId: string | undefined, body: unknown) {
    const session = await this.requireAuthorizedSession(sessionId);
    const parsed = rejectTransferRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new CustodyTransferApiError('INVALID_REJECTION', 'Rejection details are invalid.', 400);
    const input = parsed.data;
    await this.awaitingRecipientTransfer(session.address, input.transferId);
    const serialized = canonical({
      evidence: validateEvidence(input.evidence),
      reason: input.reason,
      reasonType: input.reasonType,
      transferId: input.transferId,
      version: 1,
    });
    const record = await this.storeWorkflow(
      input.transferId,
      session.address,
      'REJECTION',
      serialized,
    );
    const configuration = this.dependencies.configuration();
    return {
      action: 'REJECT_TRANSFER' as const,
      transaction: this.dependencies.gateway.prepareRejection({
        chainId: configuration.chainId,
        contractAddress: configuration.contractAddress,
        reasonHash: record.contentHash,
        transferId: input.transferId,
      }),
    };
  }

  async listDiscrepancies(sessionId: string | undefined) {
    await this.requireAdmin(sessionId);
    let discrepancies;
    try {
      discrepancies = await this.dependencies.gateway.listDiscrepancies();
    } catch {
      throw new CustodyTransferApiError(
        'DISCREPANCY_LOOKUP_UNAVAILABLE',
        'Discrepancies could not be retrieved.',
        502,
      );
    }
    return {
      discrepancies: await Promise.all(
        discrepancies.map(async (discrepancy) => {
          const transfer = await this.lookupTransfer(discrepancy.transferId);
          const summary = await this.safeSummary(discrepancy.transferId, transfer);
          return {
            ...summary,
            actualQuantity: discrepancy.actualQuantity.toString(),
            discrepancyType: discrepancyKind(discrepancy.kind),
            expectedQuantity: discrepancy.expectedQuantity.toString(),
            privateDetails: await this.privateDetails({
              cid: discrepancy.evidenceCid,
              contentHash: discrepancy.detailsHash,
              kind: 'DISCREPANCY',
              transferId: discrepancy.transferId,
            }),
            reportedAt: discrepancy.reportedAt,
            resolved: discrepancy.resolved,
            technical: {
              detailsHash: discrepancy.detailsHash,
              evidenceCid: discrepancy.evidenceCid,
              recipientWallet: transfer.recipient,
              senderWallet: transfer.sender,
              transferId: discrepancy.transferId,
            },
          };
        }),
      ),
    };
  }

  async prepareDiscrepancyResolution(sessionId: string | undefined, body: unknown) {
    const session = await this.requireAdmin(sessionId);
    const parsed = resolveDiscrepancyRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new CustodyTransferApiError(
        'INVALID_DISCREPANCY_RESOLUTION',
        'A decision and reason are required.',
        400,
      );
    const transfer = await this.lookupTransfer(parsed.data.transferId);
    if (transfer.status !== DISCREPANCY_REPORTED_STATUS)
      throw new CustodyTransferApiError(
        'DISCREPANCY_NOT_OPEN',
        'This discrepancy is no longer awaiting administrator review.',
        409,
      );
    const discrepancy = await this.dependencies.gateway.getDiscrepancy(parsed.data.transferId);
    if (!discrepancy || discrepancy.resolved)
      throw new CustodyTransferApiError(
        'DISCREPANCY_NOT_OPEN',
        'This discrepancy is no longer awaiting administrator review.',
        409,
      );
    const configuration = this.dependencies.configuration();
    return {
      actorWallet: session.address,
      decision: parsed.data.acceptActual
        ? ('ACCEPT_ACTUAL' as const)
        : ('CANCEL_TRANSFER' as const),
      transaction: this.dependencies.gateway.prepareDiscrepancyResolution({
        acceptActual: parsed.data.acceptActual,
        chainId: configuration.chainId,
        contractAddress: configuration.contractAddress,
        reasonHash: sha256(toUtf8Bytes(canonical({ reason: parsed.data.reason, version: 1 }))),
        transferId: parsed.data.transferId,
      }),
    };
  }

  async getPrivateEvidence(sessionId: string | undefined, parameters: unknown) {
    const session = await this.requireAuthorizedSession(sessionId);
    const transferId = this.transferId(parameters);
    const transfer = await this.lookupTransfer(transferId);
    this.requireParticipantOrAdmin(
      session.address,
      session.onChainAuthorization?.role,
      transfer,
      true,
    );
    const privateDetails = await this.authoritativePrivateDetails(transferId, transfer);
    if (!privateDetails)
      throw new CustodyTransferApiError(
        'RECEIPT_EVIDENCE_NOT_FOUND',
        'No encrypted receipt evidence is available.',
        404,
      );
    return { privateDetails };
  }

  private async authoritativePrivateDetails(transferId: string, transfer: CustodyTransferRecord) {
    let reference: ReceiptWorkflowReference | undefined;
    try {
      if (transfer.status === 2) {
        const receipt = await this.dependencies.gateway.getReceiptEvidenceReference(transferId);
        if (receipt) reference = { ...receipt, kind: 'RECEIPT', transferId };
      } else if (transfer.status === 3) {
        const rejection = await this.dependencies.gateway.getRejectionEvidenceReference(transferId);
        if (rejection) reference = { ...rejection, kind: 'REJECTION', transferId };
      } else if ([1, 4, 5].includes(transfer.status)) {
        const discrepancy = await this.dependencies.gateway.getDiscrepancy(transferId);
        if (discrepancy && (transfer.status !== 1 || discrepancy.resolved)) {
          reference = {
            cid: discrepancy.evidenceCid,
            contentHash: discrepancy.detailsHash,
            kind: 'DISCREPANCY',
            transferId,
          };
        }
      }
    } catch {
      throw new CustodyTransferApiError(
        'RECEIPT_EVIDENCE_LOOKUP_UNAVAILABLE',
        'Authoritative receipt evidence could not be resolved.',
        502,
      );
    }
    return reference ? this.privateDetails(reference) : undefined;
  }

  private async privateDetails(reference: ReceiptWorkflowReference) {
    const record = await this.dependencies.receiptRepository?.find(reference);
    if (!record || !this.dependencies.contentStore) return undefined;
    try {
      return JSON.parse(await this.dependencies.contentStore.decrypt(record.payload)) as Record<
        string,
        unknown
      >;
    } catch {
      return undefined;
    }
  }

  private async storeWorkflow(
    transferId: string,
    actor: string,
    kind: ReceiptWorkflowRecord['kind'],
    serialized: string,
  ): Promise<ReceiptWorkflowRecord> {
    const contentHash = sha256(toUtf8Bytes(serialized));
    const key = `${transferId.toLowerCase()}:${kind}:${contentHash.toLowerCase()}`;
    const active = this.workflowWrites.get(key);
    if (active) {
      await active;
      return this.storeWorkflow(transferId, actor, kind, serialized);
    }
    const write = this.persistWorkflow(transferId, actor, kind, serialized, contentHash);
    this.workflowWrites.set(key, write);
    try {
      return await write;
    } finally {
      if (this.workflowWrites.get(key) === write) this.workflowWrites.delete(key);
    }
  }

  private async persistWorkflow(
    transferId: string,
    actor: string,
    kind: ReceiptWorkflowRecord['kind'],
    serialized: string,
    contentHash: string,
  ) {
    const repository = this.dependencies.receiptRepository;
    const contentStore = this.dependencies.contentStore;
    if (!repository || !contentStore)
      throw new CustodyTransferApiError(
        'RECEIPT_STORAGE_UNAVAILABLE',
        'Encrypted receipt storage is unavailable. No transaction was prepared.',
        503,
      );
    const existing = await repository.find({ contentHash, kind, transferId });
    if (existing) {
      if (!sameAddress(existing.actor, actor))
        throw new CustodyTransferApiError(
          'RECEIPT_WORKFLOW_CONFLICT',
          'This transfer already has different receipt details.',
          409,
        );
      return existing;
    }
    let stored;
    try {
      stored = await contentStore.encryptAndStore(serialized, randomUUID());
    } catch {
      throw new CustodyTransferApiError(
        'RECEIPT_STORAGE_UNAVAILABLE',
        'Encrypted receipt storage is unavailable. No transaction was prepared.',
        503,
      );
    }
    const record: ReceiptWorkflowRecord = {
      actor: getAddress(actor),
      cid: stored.cid,
      contentHash,
      createdAt: this.clock().toISOString(),
      kind,
      payload: stored.payload,
      schemaVersion: 2,
      transferId,
    };
    await repository.save(record);
    return record;
  }

  private async requireAuthorizedSession(sessionId: string | undefined) {
    const session = await this.dependencies.authService.requireSession(sessionId);
    if (session.onChainAuthorization?.status !== 'AUTHORIZED')
      throw new CustodyTransferApiError(
        'ON_CHAIN_AUTHORIZATION_REQUIRED',
        'Current on-chain company authorization is required.',
        403,
      );
    return session;
  }

  private async requireAdmin(sessionId: string | undefined) {
    const session = await this.requireAuthorizedSession(sessionId);
    if (session.onChainAuthorization?.role !== CompanyRole.SYSTEM_ADMIN)
      throw new CustodyTransferApiError(
        'SYSTEM_ADMIN_REQUIRED',
        'System Admin authorization is required.',
        403,
      );
    return session;
  }

  private async awaitingRecipientTransfer(address: string, transferId: string) {
    const transfer = await this.lookupTransfer(transferId);
    if (transfer.status !== AWAITING_RECEIPT_STATUS)
      throw new CustodyTransferApiError(
        'TRANSFER_NOT_AWAITING_RECEIPT',
        'The custody transfer is not awaiting receipt.',
        409,
      );
    this.requireRecipient(address, transfer.recipient);
    return transfer;
  }

  private async lookupTransfer(transferId: string) {
    try {
      const transfer = await this.dependencies.gateway.getTransfer(transferId);
      if (transfer) return transfer;
    } catch {
      throw new CustodyTransferApiError(
        'TRANSFER_LOOKUP_UNAVAILABLE',
        'The custody transfer could not be retrieved.',
        502,
      );
    }
    throw new CustodyTransferApiError(
      'TRANSFER_NOT_FOUND',
      'The referenced custody transfer does not exist.',
      404,
    );
  }

  private requireRecipient(sessionAddress: string, recipient: string) {
    if (!sameAddress(sessionAddress, recipient))
      throw new CustodyTransferApiError(
        'INTENDED_RECIPIENT_REQUIRED',
        'Only the intended transfer recipient may access this transfer.',
        403,
      );
  }

  private requireParticipantOrAdmin(
    sessionAddress: string,
    role: CompanyRole | undefined,
    transfer: CustodyTransferRecord,
    hidePrivateRecord = false,
  ) {
    if (
      role !== CompanyRole.SYSTEM_ADMIN &&
      !sameAddress(sessionAddress, transfer.sender) &&
      !sameAddress(sessionAddress, transfer.recipient)
    )
      throw new CustodyTransferApiError(
        hidePrivateRecord ? 'RECEIPT_EVIDENCE_NOT_FOUND' : 'TRANSFER_PARTICIPANT_REQUIRED',
        hidePrivateRecord
          ? 'No encrypted receipt evidence is available.'
          : 'Only transfer participants and the System Admin may access this receipt record.',
        hidePrivateRecord ? 404 : 403,
      );
  }

  private transferId(parameters: unknown) {
    const parsed = transferIdParameterSchema.safeParse(parameters);
    if (!parsed.success)
      throw new CustodyTransferApiError('INVALID_REQUEST', 'The transfer ID is invalid.', 400);
    return parsed.data.transferId;
  }

  private async safeSummary(
    transferId: string,
    transfer: CustodyTransferRecord,
  ): Promise<CustodyTransferSummary> {
    const [identities, product] = await Promise.all([
      this.dependencies.stakeholderDirectory?.resolveMany([transfer.sender, transfer.recipient]) ??
        Promise.resolve([]),
      this.dependencies.productMetadata?.product(transfer.productBatchId) ??
        Promise.resolve(undefined),
    ]);
    const names = new Map(
      identities.map((identity) => [identity.walletAddress.toLowerCase(), identity.companyName]),
    );
    return {
      damaged: transfer.damaged.toString(),
      dispatchedAt: safeTimestamp(transfer.dispatchedAt),
      expectedAt: safeTimestamp(transfer.expectedAt),
      productBatchId: transfer.productBatchId,
      productName: product?.name ?? 'Registered product',
      productReference: product?.reference ?? 'Batch reference unavailable',
      quantity: transfer.quantity.toString(),
      recipient: getAddress(transfer.recipient),
      recipientName: names.get(transfer.recipient.toLowerCase()),
      rejected: transfer.rejected.toString(),
      sender: getAddress(transfer.sender),
      senderName: names.get(transfer.sender.toLowerCase()),
      status: transfer.status,
      transferId,
      usable: transfer.usable.toString(),
    };
  }
}

function validateEvidence(evidence: ReceiptEvidenceInput[]) {
  return evidence.map((file) => {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(file.dataBase64))
      throw new CustodyTransferApiError('INVALID_EVIDENCE', 'Evidence data is invalid.', 400);
    const bytes = Buffer.from(file.dataBase64, 'base64');
    if (!bytes.length || bytes.length > MAX_EVIDENCE_BYTES)
      throw new CustodyTransferApiError(
        'INVALID_EVIDENCE',
        'Each evidence file must be 5 MB or smaller.',
        400,
      );
    return { dataBase64: file.dataBase64, mediaType: file.mediaType, size: bytes.length };
  });
}

function discrepancyKind(kind: number) {
  return ['NONE', 'SHORTAGE', 'EXCESS', 'DAMAGE', 'WRONG_PRODUCT', 'OTHER'][kind] ?? 'OTHER';
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function safeTimestamp(value: bigint) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0)
    throw new CustodyTransferApiError(
      'INVALID_TRANSFER_RECORD',
      'The custody transfer record is invalid.',
      502,
    );
  return timestamp;
}

function sameAddress(left: string, right: string) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}
