import type { NextFunction, Request, Response } from 'express';

import { AuthError } from '../auth/auth.service.js';
import { CustodyTransferApiError, CustodyTransferService } from './custody-transfer.service.js';

export class CustodyTransferController {
  constructor(
    private readonly service: CustodyTransferService,
    private readonly sessionCookieName: string,
  ) {}

  resolveQr = async (request: Request, response: Response, next: NextFunction) => {
    await this.respond(request, response, next, () =>
      this.service.resolveQr(this.session(request), request.body),
    );
  };

  getTransfer = async (request: Request, response: Response, next: NextFunction) => {
    await this.respond(request, response, next, () =>
      this.service.getTransfer(this.session(request), request.params),
    );
  };

  prepareReceiptConfirmation = async (request: Request, response: Response, next: NextFunction) => {
    await this.respond(request, response, next, () =>
      this.service.prepareReceiptConfirmation(this.session(request), request.body),
    );
  };

  prepareRejection = async (request: Request, response: Response, next: NextFunction) => {
    await this.respond(request, response, next, () =>
      this.service.prepareRejection(this.session(request), request.body),
    );
  };

  listDiscrepancies = async (request: Request, response: Response, next: NextFunction) => {
    await this.respond(request, response, next, () =>
      this.service.listDiscrepancies(this.session(request)),
    );
  };

  prepareDiscrepancyResolution = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    await this.respond(request, response, next, () =>
      this.service.prepareDiscrepancyResolution(this.session(request), request.body),
    );
  };

  getPrivateEvidence = async (request: Request, response: Response, next: NextFunction) => {
    await this.respond(request, response, next, () =>
      this.service.getPrivateEvidence(this.session(request), request.params),
    );
  };

  private session(request: Request) {
    return request.cookies?.[this.sessionCookieName] as string | undefined;
  }

  private async respond(
    _request: Request,
    response: Response,
    next: NextFunction,
    operation: () => Promise<unknown>,
  ) {
    try {
      response.json(await operation());
    } catch (error) {
      if (error instanceof AuthError || error instanceof CustodyTransferApiError) {
        response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }

      next(error);
    }
  }
}
