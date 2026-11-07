import { Router } from 'express';

import type { StakeholderDirectoryController } from './stakeholder-directory.controller.js';

export function createStakeholderDirectoryRouter(controller: StakeholderDirectoryController) {
  const router = Router();
  router.get('/', controller.list);
  return router;
}
