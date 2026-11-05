import { Router } from 'express';

import { SsiController } from './ssi.controller.js';

export function createSsiRouter(controller: SsiController) {
  const router = Router();

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post('/company-role/verify', controller.verifyCompanyRole);
  router.post('/company-role/issue', controller.issueCompanyRole);

  return router;
}
