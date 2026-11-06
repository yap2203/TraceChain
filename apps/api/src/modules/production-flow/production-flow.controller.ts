import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AuthError } from '../auth/auth.service.js';
import {
  evidenceRequestSchema,
  productRequestSchema,
  requestIdSchema,
  transferRequestSchema,
} from './production-flow.schema.js';
import { ProductionFlowApiError, ProductionFlowService } from './production-flow.service.js';

export class ProductionFlowController {
  constructor(
    private readonly service: ProductionFlowService,
    private readonly sessionCookieName: string,
  ) {}

  listIngredients = this.action((request) => this.service.listIngredients(this.session(request)));
  listEvidence = this.action((request) => this.service.listEvidence(this.session(request)));
  listDistributors = this.action((request) => this.service.listDistributors(this.session(request)));
  prepareEvidenceRequest = this.action((request) =>
    this.service.prepareEvidenceRequest(
      this.session(request),
      evidenceRequestSchema.parse(request.body),
    ),
  );
  prepareEvidenceResponse = this.action((request) =>
    this.service.prepareEvidenceResponse(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  prepareEvidenceAcceptance = this.action((request) =>
    this.service.prepareEvidenceAcceptance(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  prepareProduct = this.action((request) =>
    this.service.prepareProduct(this.session(request), productRequestSchema.parse(request.body)),
  );
  prepareTransfer = this.action((request) =>
    this.service.prepareTransfer(this.session(request), transferRequestSchema.parse(request.body)),
  );

  private session(request: Request) {
    return request.cookies?.[this.sessionCookieName] as string | undefined;
  }

  private action(operation: (request: Request) => Promise<unknown>) {
    return async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await operation(request));
      } catch (error) {
        if (error instanceof ZodError) {
          response.status(400).json({
            error: {
              code: 'INVALID_REQUEST',
              message: error.issues[0]?.message ?? 'Invalid request.',
            },
          });
          return;
        }
        if (error instanceof AuthError || error instanceof ProductionFlowApiError) {
          response.status(error.status).json({
            error: { code: error.code, message: error.message },
          });
          return;
        }
        next(error);
      }
    };
  }
}
