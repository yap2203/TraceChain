import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { AuthError, AuthService } from './auth.service.js';
import { nonceRequestSchema, verifyRequestSchema } from './auth.schema.js';

interface AuthControllerOptions {
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlMs: number;
}

export class AuthController {
  private readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly authService: AuthService,
    { cookieName, cookieSecure, sessionTtlMs }: AuthControllerOptions,
  ) {
    this.cookieName = cookieName;
    this.cookieOptions = {
      httpOnly: true,
      maxAge: sessionTtlMs,
      path: '/api',
      sameSite: 'lax',
      secure: cookieSecure,
    };
  }

  nonce = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = nonceRequestSchema.parse(request.body);
      response.status(201).json(await this.authService.createNonce(input.address));
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  verify = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = verifyRequestSchema.parse(request.body);
      const result = await this.authService.verify(input.message, input.signature);

      response.cookie(this.cookieName, result.sessionId, this.cookieOptions);
      response.json(result.response);
    } catch (error) {
      this.handleError(error, response, next);
    }
  };

  session = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const sessionId = request.cookies?.[this.cookieName] as string | undefined;
      const session = await this.authService.getSession(sessionId);

      if (!session.authenticated && sessionId) this.clearCookie(response);
      response.json(session);
    } catch (error) {
      next(error);
    }
  };

  logout = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const sessionId = request.cookies?.[this.cookieName] as string | undefined;
      await this.authService.logout(sessionId);
      this.clearCookie(response);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  };

  private clearCookie(response: Response) {
    response.clearCookie(this.cookieName, {
      httpOnly: true,
      path: this.cookieOptions.path,
      sameSite: this.cookieOptions.sameSite,
      secure: this.cookieOptions.secure,
    });
  }

  private handleError(error: unknown, response: Response, next: NextFunction) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: error.issues[0]?.message ?? 'The request is invalid.',
        },
      });
      return;
    }

    if (error instanceof AuthError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message },
      });
      return;
    }

    next(error);
  }
}
