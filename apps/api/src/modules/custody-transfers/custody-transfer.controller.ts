import type { NextFunction, Request, Response } from 'express';

import { AuthError } from '../auth/auth.service.js';
import { CustodyTransferApiError, CustodyTransferService } from './custody-transfer.service.js';

export class CustodyTransferController {
  constructor(
    private readonly service: CustodyTransferService,
    private readonly sessionCookieName: string,
  ) {}

  resolveQr = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const sessionId = request.cookies?.[this.sessionCookieName] as string | undefined;
      response.json(await this.service.resolveQr(sessionId, request.body));
    } catch (error) {
      if (error instanceof AuthError || error instanceof CustodyTransferApiError) {
        response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }

      next(error);
    }
  };
}
