import { Router } from 'express';

import type { BlockchainController } from './blockchain.controller.js';

export function createBlockchainRouter(controller: BlockchainController) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/applications', controller.listApplications);
  router.post('/transactions/company-application', controller.prepareApplication);
  router.post('/transactions/application-rejection', controller.prepareRejection);
  return router;
}
