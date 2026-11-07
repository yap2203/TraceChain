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
  router.post('/evidence-requests/prepare', controller.prepareEvidenceRequest);
  router.post('/evidence-requests/:requestId/respond/prepare', controller.prepareEvidenceResponse);
  router.post('/evidence-requests/:requestId/accept/prepare', controller.prepareEvidenceAcceptance);
  router.post('/products/prepare', controller.prepareProduct);
  router.get('/distributors', controller.listDistributors);
  router.post('/transfers/prepare', controller.prepareTransfer);
  router.get('/distributor/inventory', controller.listDistributorInventory);
  router.get('/retailers', controller.listRetailers);
  router.post('/distributor/transfers/prepare', controller.prepareDistributorTransfer);
  return router;
}
