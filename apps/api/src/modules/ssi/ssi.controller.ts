import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AuthError } from '../auth/auth.service.js';
import { companyRoleVerificationRequestSchema } from './ssi.schema.js';
import { CompanyRoleSsiService, SsiApiError } from './ssi.service.js';

export class SsiController {
  constructor(
    private readonly service: CompanyRoleSsiService,
    private readonly sessionCookieName: string,
  ) {}

  verifyCompanyRole = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = companyRoleVerificationRequestSchema.parse(request.body);
      const sessionId = request.cookies?.[this.sessionCookieName] as string | undefined;
      response.json(await this.service.verifyCredential(sessionId, input.credential));
    } catch (error) {
      if (error instanceof ZodError) {
        response.status(400).json({
          error: {
            code: 'INVALID_REQUEST',
            message: error.issues[0]?.message ?? 'The credential request is invalid.',
          },
        });
        return;
      }

      if (error instanceof AuthError || error instanceof SsiApiError) {
        response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }

      next(error);
    }
  };
}
