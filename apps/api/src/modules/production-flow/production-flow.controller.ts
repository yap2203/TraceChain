import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AuthError } from '../auth/auth.service.js';
import {
  distributorTransferRequestSchema,
  companyIdentityPresentationSchema,
  evidenceCloseSchema,
  evidencePresentationSchema,
  evidenceRequestSchema,
  productRequestSchema,
  productionIngredientsQuerySchema,
  requestIdSchema,
  transferRequestSchema,
} from './production-flow.schema.js';
import { ProductionFlowApiError, ProductionFlowService } from './production-flow.service.js';

export class ProductionFlowController {
  constructor(
    private readonly service: ProductionFlowService,
    private readonly sessionCookieName: string,
  ) {}

  listIngredients = this.action((request) => {
    const query = productionIngredientsQuerySchema.parse(request.query);
    return this.service.listIngredients(this.session(request), query.location, query.purpose);
  });
  listEvidence = this.action((request) => this.service.listEvidence(this.session(request)));
  listRetailerEvidenceOptions = this.action((request) =>
    this.service.listRetailerEvidenceOptions(this.session(request)),
  );
  getEvidenceDetails = this.action((request) =>
    this.service.getEvidenceDetails(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  reviewEvidence = this.action((request) =>
    this.service.reviewEvidence(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  listDistributors = this.action((request) => this.service.listDistributors(this.session(request)));
  listDistributorInventory = this.action((request) =>
    this.service.listDistributorInventory(this.session(request)),
  );
  listRetailers = this.action((request) => this.service.listRetailers(this.session(request)));
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
      evidencePresentationSchema.parse(request.body),
    ),
  );
  requestCompanyIdentityProof = this.action((request) =>
    this.service.requestCompanyIdentityProof(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  getCompanyIdentityProofMaterial = this.action((request) =>
    this.service.getCompanyIdentityProofMaterial(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  presentCompanyIdentityProof = this.action((request) =>
    this.service.presentCompanyIdentityProof(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
      companyIdentityPresentationSchema.parse(request.body).presentation,
    ),
  );
  verifyCompanyIdentityProof = this.action((request) =>
    this.service.verifyCompanyIdentityProof(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  declineCompanyIdentityProof = this.action((request) =>
    this.service.declineCompanyIdentityProof(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  getCompanyIdentityProofStatus = this.action((request) =>
    this.service.getCompanyIdentityProofStatus(
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
  verifyEvidence = this.action((request) =>
    this.service.verifyEvidence(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
    ),
  );
  prepareEvidenceClose = this.action((request) =>
    this.service.prepareEvidenceClose(
      this.session(request),
      requestIdSchema.parse(request.params).requestId,
      evidenceCloseSchema.parse(request.body),
    ),
  );
  prepareProduct = this.action((request) =>
    this.service.prepareProduct(this.session(request), productRequestSchema.parse(request.body)),
  );
  prepareTransfer = this.action((request) =>
    this.service.prepareTransfer(this.session(request), transferRequestSchema.parse(request.body)),
  );
  prepareDistributorTransfer = this.action((request) =>
    this.service.prepareDistributorTransfer(
      this.session(request),
      distributorTransferRequestSchema.parse(request.body),
    ),
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
