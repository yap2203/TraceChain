import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { id } from 'ethers';
import { Router } from 'express';
import { z, ZodError } from 'zod';
import { CompanyRole } from '@tracechain/shared';
import type { AuthService } from '../auth/auth.service.js';
import type { BlockchainGateway } from './blockchain-gateway.service.js';
import type {
  CredentialContentStore,
  EncryptedCredentialPayload,
} from '../ssi/encrypted-credential.store.js';

const kinds = [
  'registrationProof',
  'businessProof',
  'authorisationProof',
  'certifications',
] as const;
export const applicationDocumentsSchema = z
  .array(
    z
      .object({
        kind: z.enum(kinds),
        fileName: z
          .string()
          .min(1)
          .max(180)
          .regex(/^[^\x00-\x1f/\\]+$/),
        mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
        data: z
          .string()
          .min(4)
          .max(13981016)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict(),
  )
  .min(3)
  .max(4)
  .superRefine((files, ctx) => {
    if (
      new Set(files.map((f) => f.kind)).size !== files.length ||
      kinds.slice(0, 3).some((kind) => !files.some((f) => f.kind === kind))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Include registration, business and authorisation documents once each.',
      });
    for (const file of files) {
      const bytes = Buffer.from(file.data, 'base64');
      const valid =
        file.mimeType === 'application/pdf'
          ? bytes.subarray(0, 5).toString() === '%PDF-'
          : file.mimeType === 'image/png'
            ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const extension =
        file.mimeType === 'application/pdf'
          ? /\.pdf$/i
          : file.mimeType === 'image/png'
            ? /\.png$/i
            : /\.jpe?g$/i;
      if (
        !valid ||
        !extension.test(file.fileName) ||
        bytes.length > 10 * 1024 * 1024 ||
        bytes.toString('base64') !== file.data
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Use valid PDF, PNG or JPEG documents up to 10 MB each.',
        });
    }
  });
type Documents = z.infer<typeof applicationDocumentsSchema>;
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
        error instanceof ZodError
          ? 400
          : error instanceof DocumentError
            ? error.status
            : (error as any).code === 'AUTHENTICATION_REQUIRED'
              ? 401
              : 503;
      res
        .status(status)
        .json({
          error: {
            code: 'APPLICATION_DOCUMENT_ERROR',
            message:
              error instanceof DocumentError
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
