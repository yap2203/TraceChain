import {
  CompanyRole,
  companyApplicationBindingMessage,
  companyApplicationContentAuthorizationMessage,
  type CompanyApplicationContentAuthorization,
  type CompanyApplicationContentFile,
} from '@tracechain/shared';
import { getAddress, id, sha256, verifyMessage } from 'ethers';
import { z } from 'zod';

import type { CredentialContentStore } from '../ssi/encrypted-credential.store.js';
import type { CatalogueImageInput } from '../orders/catalogue-media.js';
import { validateCatalogueImage } from '../orders/catalogue-media.js';
import type { BlockchainGateway, ChainApplicationRecord } from './blockchain-gateway.service.js';
import { applicationDocumentsSchema } from './application-documents.js';
import { AdminKeystoreError } from '../admin-keystore/admin-keystore.js';

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const contentHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const cid = z.string().regex(/^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/);
const declarationVersion = 'tracechain-company-registration-v1';

const storedFileReferenceSchema = z
  .object({
    contentHash,
    encryptedCid: cid,
    fileName: z.string().min(1).max(180),
    kind: z.string().min(1).max(64),
    mimeType: z.string().min(1).max(100),
    size: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
  })
  .strict();

const storedFileEnvelopeSchema = z
  .object({
    contentHash,
    data: z.string().min(4),
    fileName: z.string().min(1).max(180),
    kind: z.string().min(1).max(64),
    mimeType: z.string().min(1).max(100),
    version: z.literal(1),
  })
  .strict();

export const applicationManifestSchema = z
  .object({
    applicationId: bytes32,
    applicantWallet: wallet,
    authorization: z
      .object({
        contentDigest: bytes32,
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
        version: z.literal(1),
      })
      .strict(),
    chainId: z.number().int().positive(),
    company: z
      .object({
        businessAddress: z.string().trim().min(1).max(1000),
        companyDid: z.string().trim().max(512).optional(),
        companyName: z.string().trim().min(1).max(200),
        companyRegistrationNumber: z.string().trim().min(1).max(120),
        registrationCountry: z.string().length(2).optional(),
      })
      .strict(),
    contact: z
      .object({
        companyEmail: z.string().email().max(254),
        contactNumber: z.string().trim().min(1).max(40),
      })
      .strict(),
    declaration: z
      .object({
        acceptedAt: z.string().datetime(),
        version: z.literal(declarationVersion),
      })
      .strict(),
    documents: z.array(storedFileReferenceSchema).min(3).max(4),
    initialLocation: z
      .object({
        address: z.string().trim().min(1).max(1000),
        name: z.string().trim().min(1).max(160),
      })
      .strict()
      .optional(),
    kind: z.literal('tracechain-company-application'),
    logo: storedFileReferenceSchema.optional(),
    previousApplicationId: bytes32,
    registryAddress: wallet,
    representative: z
      .object({
        name: z.string().trim().min(1).max(160),
        position: z.string().trim().min(1).max(120),
      })
      .strict(),
    requestedRole: z.number().int().min(2).max(5),
    submittedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

const manifestUploadSchema = z
  .object({
    applicationId: bytes32,
    applicantWallet: wallet,
    businessAddress: z.string().trim().min(1).max(1000),
    companyDid: z.string().trim().max(512).optional(),
    companyEmail: z.string().email().max(254),
    companyName: z.string().trim().min(1).max(200),
    companyRegistrationNumber: z.string().trim().min(1).max(120),
    contactNumber: z.string().trim().min(1).max(40),
    contentAuthorizationSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    declarationAcceptedAt: z.string().datetime(),
    declarationVersion: z.literal(declarationVersion),
    documents: applicationDocumentsSchema,
    initialLocationAddress: z.string().trim().min(1).max(1000).optional(),
    initialLocationName: z.string().trim().min(1).max(160).optional(),
    logo: z
      .object({
        data: z.string().min(4).max(2_800_000),
        fileName: z.string().trim().min(1).max(160),
        mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      })
      .strict()
      .optional(),
    previousApplicationId: bytes32,
    registrationCountry: z.string().length(2).optional(),
    representativeName: z.string().trim().min(1).max(160),
    representativePosition: z.string().trim().min(1).max(120),
    requestedRole: z.number().int().min(2).max(5),
    submissionTime: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.initialLocationName) !== Boolean(value.initialLocationAddress))
      context.addIssue({
        code: 'custom',
        message: 'Provide both the initial location name and address.',
        path: ['initialLocationName'],
      });
  });

export type ApplicationManifest = z.infer<typeof applicationManifestSchema>;
export type ApplicationManifestUpload = z.infer<typeof manifestUploadSchema>;

export interface ResolvedApplicationManifest {
  manifest: ApplicationManifest;
  profileHash: string;
}

export class ApplicationManifestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export class ApplicationManifestService {
  private readonly cache = new Map<string, Promise<ResolvedApplicationManifest>>();

  constructor(
    private readonly configuration: { chainId: number; registryAddress: string },
    private readonly contentStore: CredentialContentStore,
    private readonly gateway: Pick<BlockchainGateway, 'listApplications'>,
  ) {}

  publicConfiguration() {
    return {
      chainId: this.configuration.chainId,
      declarationVersion,
      registryAddress: getAddress(this.configuration.registryAddress),
    };
  }

  async create(inputValue: unknown) {
    const input = manifestUploadSchema.parse(inputValue);
    const documents = input.documents.map((document) => descriptor(document.kind, document));
    const validatedLogo = input.logo
      ? validateCatalogueImage(input.logo as CatalogueImageInput)
      : undefined;
    const logo = input.logo && validatedLogo ? descriptor('companyLogo', input.logo) : undefined;
    const authorization = this.contentAuthorization(input, documents, logo);
    const message = companyApplicationContentAuthorizationMessage(authorization);
    this.verifyApplicant(message, input.contentAuthorizationSignature, input.applicantWallet);

    const existing = (await this.gateway.listApplications()).find(
      (application) => application.id.toLowerCase() === input.applicationId.toLowerCase(),
    );
    if (existing) {
      const resolved = await this.resolve(existing);
      if (resolved.manifest.authorization.contentDigest !== id(message))
        throw new ApplicationManifestError(
          'APPLICATION_CONTENT_CONFLICT',
          'This application ID already refers to different submitted content.',
          409,
        );
      return this.preparedResult(
        existing.encryptedProfileCid,
        resolved.profileHash,
        resolved.manifest,
      );
    }

    const documentReferences = await mapBounded(input.documents, 2, async (document) =>
      this.storeFile(document.kind, document),
    );
    const logoReference =
      input.logo && validatedLogo
        ? await this.storeFile('companyLogo', {
            ...input.logo,
            data: validatedLogo.data,
          })
        : undefined;
    const manifest: ApplicationManifest = {
      applicationId: input.applicationId,
      applicantWallet: getAddress(input.applicantWallet),
      authorization: {
        contentDigest: id(message),
        signature: input.contentAuthorizationSignature,
        version: 1,
      },
      chainId: this.configuration.chainId,
      company: {
        businessAddress: input.businessAddress,
        ...(input.companyDid ? { companyDid: input.companyDid } : {}),
        companyName: input.companyName,
        companyRegistrationNumber: input.companyRegistrationNumber,
        ...(input.registrationCountry ? { registrationCountry: input.registrationCountry } : {}),
      },
      contact: { companyEmail: input.companyEmail, contactNumber: input.contactNumber },
      declaration: { acceptedAt: input.declarationAcceptedAt, version: declarationVersion },
      documents: documentReferences,
      ...(input.initialLocationName && input.initialLocationAddress
        ? {
            initialLocation: {
              name: input.initialLocationName,
              address: input.initialLocationAddress,
            },
          }
        : {}),
      kind: 'tracechain-company-application',
      ...(logoReference ? { logo: logoReference } : {}),
      previousApplicationId: input.previousApplicationId,
      registryAddress: getAddress(this.configuration.registryAddress),
      representative: { name: input.representativeName, position: input.representativePosition },
      requestedRole: input.requestedRole,
      submittedAt: input.submissionTime,
      version: 1,
    };
    const serialized = canonicalJson(manifest);
    const profileHash = id(serialized);
    const stored = await this.contentStore.encryptAndStore(serialized, input.applicationId);
    const encryptedProfileCid = `ipfs://${stored.cid}`;
    this.cache.set(encryptedProfileCid, Promise.resolve({ manifest, profileHash }));
    return this.preparedResult(encryptedProfileCid, profileHash, manifest);
  }

  async validatePreparedApplication(input: {
    applicationId: string;
    applicantSignature: string;
    applicantWallet: string;
    encryptedProfileCid: string;
    previousApplicationId: string;
    profileHash: string;
    requestedRole: number;
  }) {
    const application: ChainApplicationRecord = {
      applicant: input.applicantWallet,
      encryptedProfileCid: input.encryptedProfileCid,
      id: input.applicationId,
      previousApplicationId: input.previousApplicationId,
      profileHash: input.profileHash,
      requestedRole: roleLabel(input.requestedRole),
      status: 'pending',
      submittedAt: 0,
      updatedAt: 0,
    };
    const resolved = await this.resolve(application);
    const prepared = this.preparedResult(
      input.encryptedProfileCid,
      input.profileHash,
      resolved.manifest,
    );
    this.verifyApplicant(prepared.bindingMessage, input.applicantSignature, input.applicantWallet);
    return resolved.manifest;
  }

  async resolve(application: ChainApplicationRecord): Promise<ResolvedApplicationManifest> {
    if (application.encryptedProfileCid.startsWith('local://'))
      throw new ApplicationManifestError(
        'LEGACY_LOCAL_REFERENCE',
        'This legacy application uses a server-local content reference.',
        422,
      );
    if (!cid.safeParse(application.encryptedProfileCid).success)
      throw new ApplicationManifestError(
        'APPLICATION_REFERENCE_UNSUPPORTED',
        'The application uses an unsupported encrypted-content reference.',
        422,
      );
    let pending = this.cache.get(application.encryptedProfileCid);
    if (!pending) {
      pending = this.loadAndValidate(application);
      this.cache.set(application.encryptedProfileCid, pending);
      pending.catch(() => this.cache.delete(application.encryptedProfileCid));
    }
    return pending;
  }

  async readDocuments(application: ChainApplicationRecord) {
    const { manifest } = await this.resolve(application);
    return mapBounded(manifest.documents, 2, (reference) => this.readFile(reference));
  }

  async readLogo(application: ChainApplicationRecord) {
    const { manifest } = await this.resolve(application);
    if (!manifest.logo)
      throw new ApplicationManifestError('MEDIA_NOT_FOUND', 'Company logo was not found.', 404);
    return this.readFile(manifest.logo);
  }

  private async loadAndValidate(application: ChainApplicationRecord) {
    if (!this.contentStore.retrieveAndDecrypt)
      throw new ApplicationManifestError(
        'APPLICATION_CONTENT_UNAVAILABLE',
        'Encrypted application retrieval is not configured.',
        503,
      );
    let serialized: string;
    try {
      serialized = await this.contentStore.retrieveAndDecrypt(application.encryptedProfileCid);
    } catch (error) {
      if (error instanceof AdminKeystoreError) throw error;
      const message = error instanceof Error ? error.message : '';
      const missingKey = /authenticate data|auth tag|bad decrypt|decrypt/i.test(message);
      throw new ApplicationManifestError(
        missingKey ? 'APPLICATION_DECRYPTION_KEY_UNAVAILABLE' : 'APPLICATION_CONTENT_UNAVAILABLE',
        missingKey
          ? 'This backend cannot decrypt the application with its configured key.'
          : 'The encrypted application content could not be retrieved.',
        503,
      );
    }
    let manifest: ApplicationManifest;
    try {
      manifest = applicationManifestSchema.parse(JSON.parse(serialized));
    } catch {
      throw new ApplicationManifestError(
        'APPLICATION_MANIFEST_INVALID',
        'The encrypted application manifest is invalid or unsupported.',
        409,
      );
    }
    const profileHash = id(canonicalJson(manifest));
    if (profileHash.toLowerCase() !== application.profileHash.toLowerCase())
      throw new ApplicationManifestError(
        'APPLICATION_INTEGRITY_MISMATCH',
        'The application manifest does not match its on-chain profile hash.',
        409,
      );
    this.assertContext(application, manifest);
    const authorization = this.contentAuthorizationFromManifest(manifest);
    const message = companyApplicationContentAuthorizationMessage(authorization);
    if (id(message).toLowerCase() !== manifest.authorization.contentDigest.toLowerCase())
      throw new ApplicationManifestError(
        'APPLICATION_SIGNATURE_BINDING_MISMATCH',
        'The application authorization does not match the encrypted manifest.',
        409,
      );
    this.verifyApplicant(message, manifest.authorization.signature, manifest.applicantWallet);
    return { manifest, profileHash };
  }

  private assertContext(application: ChainApplicationRecord, manifest: ApplicationManifest) {
    const role = roleNumber(application.requestedRole);
    const mismatch =
      manifest.applicationId.toLowerCase() !== application.id.toLowerCase() ||
      getAddress(manifest.applicantWallet) !== getAddress(application.applicant) ||
      manifest.chainId !== this.configuration.chainId ||
      getAddress(manifest.registryAddress) !== getAddress(this.configuration.registryAddress) ||
      manifest.requestedRole !== role ||
      manifest.previousApplicationId.toLowerCase() !==
        application.previousApplicationId.toLowerCase();
    if (mismatch)
      throw new ApplicationManifestError(
        'APPLICATION_CONTEXT_MISMATCH',
        'The application manifest does not match the authoritative on-chain application context.',
        409,
      );
  }

  private async storeFile(
    kind: string,
    file: { data: string; fileName: string; mimeType: string },
  ) {
    const bytes = Buffer.from(file.data, 'base64');
    const reference = descriptor(kind, file);
    const envelope = {
      contentHash: reference.contentHash,
      data: bytes.toString('base64'),
      fileName: file.fileName,
      kind,
      mimeType: file.mimeType,
      version: 1 as const,
    };
    const stored = await this.contentStore.encryptAndStore(
      canonicalJson(envelope),
      `${kind}-${reference.contentHash.slice(2, 18)}`,
    );
    return { ...reference, encryptedCid: `ipfs://${stored.cid}` };
  }

  private async readFile(reference: z.infer<typeof storedFileReferenceSchema>) {
    if (!this.contentStore.retrieveAndDecrypt)
      throw new ApplicationManifestError(
        'APPLICATION_CONTENT_UNAVAILABLE',
        'Encrypted application retrieval is not configured.',
        503,
      );
    let value: unknown;
    try {
      value = JSON.parse(await this.contentStore.retrieveAndDecrypt(reference.encryptedCid));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ApplicationManifestError(
          'APPLICATION_ATTACHMENT_INVALID',
          'The encrypted attachment is invalid.',
          409,
        );
      throw error;
    }
    const envelope = storedFileEnvelopeSchema.parse(value);
    const bytes = Buffer.from(envelope.data, 'base64');
    if (
      envelope.contentHash.toLowerCase() !== reference.contentHash.toLowerCase() ||
      sha256(bytes).toLowerCase() !== reference.contentHash.toLowerCase() ||
      envelope.fileName !== reference.fileName ||
      envelope.kind !== reference.kind ||
      envelope.mimeType !== reference.mimeType ||
      bytes.length !== reference.size
    )
      throw new ApplicationManifestError(
        'APPLICATION_ATTACHMENT_INTEGRITY_MISMATCH',
        'An encrypted application attachment failed its integrity check.',
        409,
      );
    return { ...reference, bytes, data: bytes.toString('base64') };
  }

  private preparedResult(
    encryptedProfileCid: string,
    profileHash: string,
    manifest: ApplicationManifest,
  ) {
    const documentsDigest = id(canonicalJson(manifest.documents));
    const binding = {
      applicationId: manifest.applicationId,
      applicantWallet: manifest.applicantWallet,
      companyName: manifest.company.companyName,
      companyRegistrationNumber: manifest.company.companyRegistrationNumber,
      registrationCountry: manifest.company.registrationCountry,
      encryptedProfileCid,
      initialLocationName: manifest.initialLocation?.name,
      initialLocationAddress: manifest.initialLocation?.address,
      documentsDigest,
      logoDigest: manifest.logo?.contentHash,
      logoFileName: manifest.logo?.fileName,
      logoMimeType: manifest.logo?.mimeType,
      previousApplicationId: manifest.previousApplicationId,
      profileHash,
      requestedRole: manifest.requestedRole,
    };
    return { ...binding, bindingMessage: companyApplicationBindingMessage(binding) };
  }

  private contentAuthorization(
    input: ApplicationManifestUpload,
    documents: CompanyApplicationContentFile[],
    logo?: CompanyApplicationContentFile,
  ): CompanyApplicationContentAuthorization {
    return {
      applicationId: input.applicationId,
      applicantWallet: getAddress(input.applicantWallet),
      businessAddress: input.businessAddress,
      chainId: this.configuration.chainId,
      ...(input.companyDid ? { companyDid: input.companyDid } : {}),
      companyEmail: input.companyEmail,
      companyName: input.companyName,
      companyRegistrationNumber: input.companyRegistrationNumber,
      contactNumber: input.contactNumber,
      declarationAcceptedAt: input.declarationAcceptedAt,
      declarationVersion: input.declarationVersion,
      documents,
      ...(logo ? { logo } : {}),
      previousApplicationId: input.previousApplicationId,
      registryAddress: getAddress(this.configuration.registryAddress),
      ...(input.registrationCountry ? { registrationCountry: input.registrationCountry } : {}),
      representativeName: input.representativeName,
      representativePosition: input.representativePosition,
      requestedRole: input.requestedRole,
      submissionTime: input.submissionTime,
    };
  }

  private contentAuthorizationFromManifest(
    manifest: ApplicationManifest,
  ): CompanyApplicationContentAuthorization {
    return {
      applicationId: manifest.applicationId,
      applicantWallet: manifest.applicantWallet,
      businessAddress: manifest.company.businessAddress,
      chainId: manifest.chainId,
      ...(manifest.company.companyDid ? { companyDid: manifest.company.companyDid } : {}),
      companyEmail: manifest.contact.companyEmail,
      companyName: manifest.company.companyName,
      companyRegistrationNumber: manifest.company.companyRegistrationNumber,
      contactNumber: manifest.contact.contactNumber,
      declarationAcceptedAt: manifest.declaration.acceptedAt,
      declarationVersion: manifest.declaration.version,
      documents: manifest.documents,
      ...(manifest.logo ? { logo: manifest.logo } : {}),
      previousApplicationId: manifest.previousApplicationId,
      registryAddress: manifest.registryAddress,
      ...(manifest.company.registrationCountry
        ? { registrationCountry: manifest.company.registrationCountry }
        : {}),
      representativeName: manifest.representative.name,
      representativePosition: manifest.representative.position,
      requestedRole: manifest.requestedRole,
      submissionTime: manifest.submittedAt,
    };
  }

  private verifyApplicant(message: string, signature: string, expectedWallet: string) {
    let recovered: string;
    try {
      recovered = getAddress(verifyMessage(message, signature));
    } catch {
      throw new ApplicationManifestError(
        'APPLICANT_SIGNATURE_INVALID',
        'The company application content signature is invalid.',
        400,
      );
    }
    if (recovered !== getAddress(expectedWallet))
      throw new ApplicationManifestError(
        'APPLICANT_SIGNATURE_INVALID',
        'The application content must be signed by the applicant wallet.',
        403,
      );
  }
}

function descriptor(
  kind: string,
  file: { data: string; fileName: string; mimeType: string },
): CompanyApplicationContentFile {
  const bytes = Buffer.from(file.data, 'base64');
  return {
    contentHash: sha256(bytes),
    fileName: file.fileName,
    kind,
    mimeType: file.mimeType,
    size: bytes.length,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function roleNumber(role: string) {
  const roles: Record<string, number> = {
    [CompanyRole.SUPPLIER]: 2,
    [CompanyRole.MANUFACTURER]: 3,
    [CompanyRole.DISTRIBUTOR]: 4,
    [CompanyRole.RETAILER]: 5,
    Supplier: 2,
    Manufacturer: 3,
    Distributor: 4,
    Retailer: 5,
  };
  return roles[role] ?? 0;
}

function roleLabel(role: number) {
  return (
    ({ 2: 'Supplier', 3: 'Manufacturer', 4: 'Distributor', 5: 'Retailer' } as const)[
      role as 2 | 3 | 4 | 5
    ] ?? 'Unknown'
  );
}

async function mapBounded<T, R>(values: T[], concurrency: number, map: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next++;
        results[index] = await map(values[index]!);
      }
    }),
  );
  return results;
}
