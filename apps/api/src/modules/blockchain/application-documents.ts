import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { id } from 'ethers';
import { Router } from 'express';
import { z, ZodError } from 'zod';
import { CompanyRole } from '@tracechain/shared';
import type { AuthService } from '../auth/auth.service.js';
import type { BlockchainGateway } from './blockchain-gateway.service.js';
import {
  ApplicationManifestError,
  type ApplicationManifestService,
} from './application-manifest.js';
import { AdminKeystoreError } from '../admin-keystore/admin-keystore.js';
import type {
  CredentialContentStore,
  EncryptedCredentialPayload,
} from '../ssi/encrypted-credential.store.js';
import {
  applicationDocumentsSchema,
  type ApplicationDocumentsInput,
} from './application-documents.schema.js';

export { applicationDocumentsSchema } from './application-documents.schema.js';

type Documents = ApplicationDocumentsInput;
interface StoredDocuments {
  wallet: string;
  digest: string;
  cid: string;
  payload: EncryptedCredentialPayload;
}
class DocumentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Encrypted IPFS copy plus an encrypted local cache; no readable document bytes on disk. */
export class ApplicationDocuments {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly content: () => CredentialContentStore,
    private readonly manifests?: ApplicationManifestService,
    private readonly gateway?: Pick<BlockchainGateway, 'listApplications'>,
  ) {}
  private async records(): Promise<Record<string, StoredDocuments>> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  async save(applicationId: string, wallet: string, documents: Documents) {
    const files = applicationDocumentsSchema.parse(documents);
    const serialized = JSON.stringify(files),
      digest = id(serialized),
      key = applicationId.toLowerCase();
    const operation = this.writes.then(async () => {
      const records = await this.records(),
        existing = records[key];
      if (existing) {
        if (existing.wallet.toLowerCase() !== wallet.toLowerCase() || existing.digest !== digest)
          throw new DocumentError(
            409,
            'Documents already exist for this application and cannot be overwritten.',
          );
        return;
      }
      const stored = await this.content().encryptAndStore(serialized, `${key}-documents`);
      records[key] = { wallet, digest, cid: stored.cid, payload: stored.payload };
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.tmp`, JSON.stringify(records), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(`${this.path}.tmp`, this.path);
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }
  async read(applicationId: string, wallet: string) {
    if (this.manifests && this.gateway) {
      const application = (await this.gateway.listApplications()).find(
        (record) => record.id.toLowerCase() === applicationId.toLowerCase(),
      );
      if (application && !application.encryptedProfileCid.startsWith('local://')) {
        if (application.applicant.toLowerCase() !== wallet.toLowerCase())
          throw new DocumentError(403, 'These documents belong to another company.');
        return (await this.manifests.readDocuments(application)).map((file) => ({
          data: file.data,
          fileName: file.fileName,
          kind: file.kind as Documents[number]['kind'],
          mimeType: file.mimeType as Documents[number]['mimeType'],
        }));
      }
    }
    const record = (await this.records())[applicationId.toLowerCase()];
    if (!record) return [];
    if (record.wallet.toLowerCase() !== wallet.toLowerCase())
      throw new DocumentError(403, 'These documents belong to another company.');
    const serialized = await this.content().decrypt(record.payload);
    if (id(serialized) !== record.digest) throw new Error('Document integrity check failed');
    return applicationDocumentsSchema.parse(JSON.parse(serialized));
  }
}

export function applicationDocumentsRouter(
  service: ApplicationDocuments,
  auth: AuthService,
  gateway: BlockchainGateway,
  cookie: string,
) {
  const router = Router();
  const authorize = async (request: any) => {
    const session = await auth.requireSession(request.cookies?.[cookie]);
    const applications = await gateway.listApplications();
    const admin =
      session.onChainAuthorization?.status === 'AUTHORIZED' &&
      session.onChainAuthorization.role === CompanyRole.SYSTEM_ADMIN &&
      (await gateway.getAdministrator()).toLowerCase() === session.address.toLowerCase();
    return { session, applications, admin };
  };
  const handler = (run: (req: any, res: any) => Promise<void>) => async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      await run(req, res);
    } catch (error) {
      const status =
        error instanceof AdminKeystoreError
          ? error.status
          : error instanceof ZodError
            ? 400
            : error instanceof DocumentError
              ? error.status
              : error instanceof ApplicationManifestError
                ? error.status
                : (error as any).code === 'AUTHENTICATION_REQUIRED'
                  ? 401
                  : 503;
      res.status(status).json({
        error: {
          code: error instanceof AdminKeystoreError ? error.code : 'APPLICATION_DOCUMENT_ERROR',
          message:
            error instanceof AdminKeystoreError ||
            error instanceof DocumentError ||
            error instanceof ApplicationManifestError
              ? error.message
              : status === 400
                ? 'Check your document types and sizes. Include all three required documents.'
                : status === 401
                  ? 'Sign in with your company wallet to review documents.'
                  : 'Application documents are unavailable. Please retry or contact the administrator.',
        },
      });
    }
  };
  router.get(
    '/applications/documents/me',
    handler(async (req, res) => {
      const { session, applications } = await authorize(req);
      res.json({
        applications: applications
          .filter((a) => a.applicant.toLowerCase() === session.address.toLowerCase())
          .map((a) => ({ id: a.id, status: a.status })),
      });
    }),
  );
  const owned = async (req: any) => {
    const { session, applications, admin } = await authorize(req);
    const applicationId = z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .parse(req.params.applicationId);
    const application = applications.find(
      (a) => a.id.toLowerCase() === applicationId.toLowerCase(),
    );
    if (
      !application ||
      (!admin && application.applicant.toLowerCase() !== session.address.toLowerCase())
    )
      throw new DocumentError(404, 'Application documents are not available to this wallet.');
    return { application, session };
  };
  router.get(
    '/applications/:applicationId/documents',
    handler(async (req, res) => {
      const { application } = await owned(req);
      const files = await service.read(application.id, application.applicant);
      res.json({
        documents: files.map(({ data, ...file }, index) => ({
          ...file,
          index,
          size: Buffer.from(data, 'base64').length,
        })),
      });
    }),
  );
  router.post(
    '/applications/:applicationId/documents',
    handler(async (req, res) => {
      const { application, session } = await owned(req);
      if (session.address.toLowerCase() !== application.applicant.toLowerCase())
        throw new DocumentError(403, 'Only the applicant can attach its documents.');
      await service.save(
        application.id,
        application.applicant,
        applicationDocumentsSchema.parse(req.body.documents),
      );
      res.json({ saved: true });
    }),
  );
  router.get(
    '/applications/:applicationId/documents/:index',
    handler(async (req, res) => {
      const { application } = await owned(req);
      const index = z.coerce.number().int().min(0).max(3).parse(req.params.index);
      const file = (await service.read(application.id, application.applicant))[index];
      if (!file)
        throw new DocumentError(
          404,
          'This document is unavailable. Earlier registrations did not upload document contents.',
        );
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.send(Buffer.from(file.data, 'base64'));
    }),
  );
  return router;
}
