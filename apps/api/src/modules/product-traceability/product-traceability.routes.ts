import { Router } from 'express';

import type { ProductTraceabilityController } from './product-traceability.controller.js';

export function createProductTraceabilityRouter(controller: ProductTraceabilityController) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post('/resolve', controller.resolve);
  return router;
}
