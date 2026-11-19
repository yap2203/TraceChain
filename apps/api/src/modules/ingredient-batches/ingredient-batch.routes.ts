import { Router, json } from 'express';

import type { IngredientBatchController } from './ingredient-batch.controller.js';

export function createIngredientBatchRouter(controller: IngredientBatchController) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/', controller.list);
  router.get('/workflows', controller.drafts);
  router.post('/attachments', json({ limit: '14mb' }), controller.uploadDocument);
  router.get('/:batchId/documents/:documentId', controller.document);
  router.use(json({ limit: '128kb' }));
  router.post('/prepare', controller.prepare);
  return router;
}
