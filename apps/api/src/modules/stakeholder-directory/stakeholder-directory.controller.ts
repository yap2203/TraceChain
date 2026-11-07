import type { NextFunction, Request, Response } from 'express';

import { AuthError, type AuthService } from '../auth/auth.service.js';
import type { StakeholderDirectory } from './stakeholder-directory.service.js';

export class StakeholderDirectoryController {
  constructor(
    private readonly authService: AuthService,
    private readonly directory: StakeholderDirectory,
    private readonly sessionCookieName: string,
  ) {}

  list = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const session = await this.authService.requireSession(
        request.cookies?.[this.sessionCookieName] as string | undefined,
      );
      if (session.onChainAuthorization?.status !== 'AUTHORIZED') {
        response.status(403).json({
          error: {
            code: 'ON_CHAIN_AUTHORIZATION_REQUIRED',
            message: 'Current on-chain company authorization is required.',
          },
        });
        return;
      }
      response.json({ stakeholders: await this.directory.list() });
    } catch (error) {
      if (error instanceof AuthError) {
        response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      next(error);
    }
  };
}
