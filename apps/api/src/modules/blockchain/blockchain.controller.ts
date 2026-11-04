import { CompanyRole } from '@tracechain/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import type { AuthService } from '../auth/auth.service.js';
import type { BlockchainGateway } from './blockchain-gateway.service.js';
import {
  applicationTransactionSchema,
  rejectionTransactionSchema,
} from './blockchain.schema.js';

export class BlockchainController {
  constructor(
    private readonly gateway: BlockchainGateway,
    private readonly authService: AuthService,
    private readonly sessionCookieName: string,
  ) {}

  listApplications = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.requireAdministrator(request);
      response.json({ applications: await this.gateway.listApplications() });
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  prepareApplication = (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = applicationTransactionSchema.parse(request.body);
      response.json(this.gateway.prepareApplication(input));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  prepareRejection = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.requireAdministrator(request);
      const input = rejectionTransactionSchema.parse(request.body);
      response.json(this.gateway.prepareRejection(input.applicationId, input.reasonHash));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  private async requireAdministrator(request: Request) {
    const sessionId = request.cookies?.[this.sessionCookieName] as string | undefined;
    const session = await this.authService.getSession(sessionId);
    if (
      !session.authenticated ||
      !session.authorizationReady ||
      !session.credentialVerified ||
      session.role !== CompanyRole.SYSTEM_ADMIN
    ) {
      throw new BlockchainApiError('ADMIN_AUTHORIZATION_REQUIRED', 'System Admin authorization is required.', 403);
    }
  }

  private handleError(error: unknown, response: Response, next: NextFunction) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message ?? 'The transaction request is invalid.' } });
      return;
    }
    if (error instanceof BlockchainApiError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    next(error);
  }
}

class BlockchainApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}
