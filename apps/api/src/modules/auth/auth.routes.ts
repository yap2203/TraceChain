import { Router } from 'express';

import { AuthController } from './auth.controller.js';

export function createAuthRouter(controller: AuthController) {
  const router = Router();

  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/nonce', controller.nonce);
  router.post('/verify', controller.verify);
  router.get('/session', controller.session);
  router.post('/logout', controller.logout);

  return router;
}
