import { Router } from 'express';

import type { BlockchainController } from './blockchain.controller.js';

export function createBlockchainRouter(controller: BlockchainController) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/applications', controller.listApplications);
  router.get('/credentials', controller.listCredentials);
  router.get('/credentials/me', controller.getMyCredential);
  router.get('/role-permissions', controller.listRolePermissions);
  router.get('/personal-permissions/:account', controller.listPersonalPermissions);
  router.post('/transactions/personal-permission', controller.preparePersonalPermission);
  router.get('/operations', controller.listOperationalData);
  router.post('/transactions/company-application', controller.prepareApplication);
  router.post('/transactions/application-rejection', controller.prepareRejection);
  router.post('/transactions/credential-lifecycle', controller.prepareCredentialLifecycle);
  router.post('/transactions/stakeholder-lifecycle', controller.prepareStakeholderLifecycle);
  router.post('/transactions/role-permission', controller.prepareRolePermission);
  return router;
}
