import { Router } from 'express';

import type { CustodyTransferController } from './custody-transfer.controller.js';

export function createCustodyTransferRouter(controller: CustodyTransferController) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post('/resolve-qr', controller.resolveQr);
  router.get('/:transferId', controller.getTransfer);
  router.post('/transactions/confirm-receipt', controller.prepareReceiptConfirmation);
  return router;
}
