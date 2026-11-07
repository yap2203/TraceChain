import { Router } from 'express';

import type { ProductionFlowController } from './production-flow.controller.js';

export function createProductionFlowRouter(controller: ProductionFlowController) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/ingredients', controller.listIngredients);
  router.get('/evidence-requests', controller.listEvidence);
  router.get('/retailer/evidence-options', controller.listRetailerEvidenceOptions);
  router.get('/evidence-requests/:requestId', controller.getEvidenceDetails);
  router.get('/evidence-requests/:requestId/review', controller.reviewEvidence);
  router.post('/evidence-requests/prepare', controller.prepareEvidenceRequest);
  router.post('/evidence-requests/:requestId/respond/prepare', controller.prepareEvidenceResponse);
  router.post(
    '/evidence-requests/:requestId/company-identity/request',
    controller.requestCompanyIdentityProof,
  );
  router.get(
    '/evidence-requests/:requestId/company-identity/material',
    controller.getCompanyIdentityProofMaterial,
  );
  router.post(
    '/evidence-requests/:requestId/company-identity/present',
    controller.presentCompanyIdentityProof,
  );
  router.post(
    '/evidence-requests/:requestId/company-identity/verify',
    controller.verifyCompanyIdentityProof,
  );
  router.post(
    '/evidence-requests/:requestId/company-identity/decline',
    controller.declineCompanyIdentityProof,
  );
  router.get(
    '/evidence-requests/:requestId/company-identity',
    controller.getCompanyIdentityProofStatus,
  );
  router.post('/evidence-requests/:requestId/verify', controller.verifyEvidence);
  router.post('/evidence-requests/:requestId/close/prepare', controller.prepareEvidenceClose);
  router.post('/evidence-requests/:requestId/accept/prepare', controller.prepareEvidenceAcceptance);
  router.post('/products/prepare', controller.prepareProduct);
  router.get('/distributors', controller.listDistributors);
  router.post('/transfers/prepare', controller.prepareTransfer);
  router.get('/distributor/inventory', controller.listDistributorInventory);
  router.get('/retailers', controller.listRetailers);
  router.post('/distributor/transfers/prepare', controller.prepareDistributorTransfer);
  return router;
}
