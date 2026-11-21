import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CompanyRole } from '@tracechain/shared';
import { Router, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';

import { assertAuthorizationAvailable, AuthError, type AuthService } from '../auth/auth.service.js';
import type { BlockchainGateway } from '../blockchain/blockchain-gateway.service.js';
import {
  AdminKeystoreError,
  AdminKeystoreManager,
  parseAdminKeystoreJson,
} from './admin-keystore.js';

const passwordSchema = z.string().min(12).max(1024);
const unlockSchema = z
  .object({
    password: passwordSchema,
    keystore: z
      .string()
      .min(1)
      .max(2 * 1024 * 1024),
  })
  .strict();
const passwordBodySchema = z
  .object({ password: passwordSchema, confirmPassword: passwordSchema })
  .strict();

export class KeystoreInitializationGuard {
  constructor(
    private readonly markerPath: string,
    private readonly legacyPaths: string[],
    private readonly existingRemoteState?: () => Promise<boolean>,
  ) {}

  async allowed() {
    if (await exists(this.markerPath)) return false;
    if (process.env.IPFS_ENCRYPTION_KEY || process.env.VERAMO_KMS_SECRET_KEY) return false;
    if ((await Promise.all(this.legacyPaths.map(exists))).some(Boolean)) return false;
    if (this.existingRemoteState) {
      try {
        if (await this.existingRemoteState()) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  async markInitialized() {
    await mkdir(dirname(this.markerPath), { recursive: true });
    const temporary = `${this.markerPath}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({ format: 'tracechain-keystore-initialization', version: 1 })}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await rename(temporary, this.markerPath);
  }
}

export function createAdminKeystoreRouter(dependencies: {
  authService: AuthService;
  cookieName: string;
  gateway: Pick<BlockchainGateway, 'getAdministrator'>;
  initialization: KeystoreInitializationGuard;
  manager: AdminKeystoreManager;
}) {
  const router = Router();
  const failures = new Map<string, number[]>();
  let initializing = false;
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/status', async (request, response) => {
    try {
      await administrator(request);
      response.json({
        status: dependencies.manager.status(),
        backupRequired: dependencies.manager.backupRequired(),
        initializationAllowed: await dependencies.initialization.allowed(),
      });
    } catch (error) {
      sendError(error, response);
    }
  });

  router.post('/unlock', async (request, response) => {
    try {
      const address = await administrator(request);
      enforceRateLimit(address);
      const input = unlockSchema.parse(request.body);
      await dependencies.manager.unlock(parseAdminKeystoreJson(input.keystore), input.password);
      failures.delete(address);
      response.json(status());
    } catch (error) {
      if (error instanceof AdminKeystoreError && error.code === 'INVALID_KEYSTORE') {
        const session = await safeSessionAddress(request);
        if (session) recordFailure(session);
      }
      sendError(error, response);
    }
  });

  router.post('/initialize', async (request, response) => {
    let ownsInitialization = false;
    try {
      await administrator(request);
      if (initializing)
        throw new AdminKeystoreError(
          'KEYSTORE_INITIALIZATION_IN_PROGRESS',
          'Administrator keystore initialization is already in progress.',
          409,
        );
      initializing = true;
      ownsInitialization = true;
      if (!(await dependencies.initialization.allowed()))
        throw new AdminKeystoreError(
          'KEYSTORE_INITIALIZATION_FORBIDDEN',
          'Existing key material was detected. Use the one-time migration command instead.',
          409,
        );
      const { password, confirmPassword } = passwordBodySchema.parse(request.body);
      assertPasswordConfirmation(password, confirmPassword);
      const keystore = await dependencies.manager.initialize(password);
      await dependencies.initialization.markInitialized();
      download(response, keystore);
    } catch (error) {
      sendError(error, response);
    } finally {
      if (ownsInitialization) initializing = false;
    }
  });

  router.post('/export', async (request, response) => {
    try {
      await administrator(request);
      const { password, confirmPassword } = passwordBodySchema.parse(request.body);
      assertPasswordConfirmation(password, confirmPassword);
      download(response, await dependencies.manager.export(password));
    } catch (error) {
      sendError(error, response);
    }
  });

  router.post('/lock', async (request, response) => {
    try {
      await administrator(request);
      dependencies.manager.lock();
      response.json(status());
    } catch (error) {
      sendError(error, response);
    }
  });

  async function administrator(request: Request) {
    const session = await dependencies.authService.getSession(
      request.cookies?.[dependencies.cookieName] as string | undefined,
    );
    assertAuthorizationAvailable(session);
    if (
      !session.authenticated ||
      !session.authorizationReady ||
      session.role !== CompanyRole.SYSTEM_ADMIN ||
      session.address.toLowerCase() !==
        (await dependencies.gateway.getAdministrator()).toLowerCase()
    )
      throw new AdminKeystoreError(
        'ADMIN_AUTHORIZATION_REQUIRED',
        'System Admin authorization is required.',
        403,
      );
    return session.address.toLowerCase();
  }

  async function safeSessionAddress(request: Request) {
    try {
      const session = await dependencies.authService.getSession(
        request.cookies?.[dependencies.cookieName] as string | undefined,
      );
      return session.authenticated ? session.address.toLowerCase() : undefined;
    } catch {
      return undefined;
    }
  }

  function enforceRateLimit(address: string) {
    const cutoff = Date.now() - 15 * 60_000;
    const recent = (failures.get(address) ?? []).filter((time) => time >= cutoff);
    failures.set(address, recent);
    if (recent.length >= 5)
      throw new AdminKeystoreError(
        'KEYSTORE_UNLOCK_RATE_LIMITED',
        'Too many failed unlock attempts. Wait before trying again.',
        429,
      );
  }

  function recordFailure(address: string) {
    failures.set(address, [...(failures.get(address) ?? []), Date.now()]);
  }

  function status() {
    return {
      backupRequired: dependencies.manager.backupRequired(),
      status: dependencies.manager.status(),
    };
  }

  return router;
}

function assertPasswordConfirmation(password: string, confirmPassword: string) {
  if (password !== confirmPassword)
    throw new AdminKeystoreError(
      'PASSWORD_CONFIRMATION_MISMATCH',
      'The password confirmation does not match.',
      400,
    );
}

function download(response: Response, value: unknown) {
  response.setHeader(
    'Content-Disposition',
    'attachment; filename="tracechain-admin-keystore.json"',
  );
  response.type('application/json').send(`${JSON.stringify(value, null, 2)}\n`);
}

function sendError(error: unknown, response: Response) {
  if (error instanceof ZodError)
    return response.status(400).json({
      error: { code: 'INVALID_KEYSTORE', message: 'Incorrect password or invalid keystore file.' },
    });
  if (error instanceof AdminKeystoreError || error instanceof AuthError)
    return response
      .status(error.status)
      .json({ error: { code: error.code, message: error.message } });
  return response.status(500).json({
    error: { code: 'KEYSTORE_ERROR', message: 'The keystore operation could not be completed.' },
  });
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
