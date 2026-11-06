import { Router } from 'express';

import type { IngredientBatchController } from './ingredient-batch.controller.js';

export function createIngredientBatchRouter(controller: IngredientBatchController) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/', controller.list);
  router.post('/prepare', controller.prepare);
  return router;
}
