import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';

import { env } from './config/env.js';
import { AuthController } from './modules/auth/auth.controller.js';
import {
  InMemoryNonceRepository,
  InMemorySessionRepository,
} from './modules/auth/auth.repository.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';

interface CreateAppOptions {
  authService?: AuthService;
}

export function createApp({ authService }: CreateAppOptions = {}) {
  const app = express();
  const sessionTtlMs = env.AUTH_SESSION_TTL_SECONDS * 1_000;
  const resolvedAuthService =
    authService ??
    new AuthService({
      configuration: {
        chainId: env.SIWE_CHAIN_ID,
        domain: env.SIWE_DOMAIN,
        nonceTtlMs: 5 * 60 * 1_000,
        sessionTtlMs,
        uri: env.SIWE_URI,
      },
      nonceRepository: new InMemoryNonceRepository(),
      sessionRepository: new InMemorySessionRepository(),
    });
  const authController = new AuthController(resolvedAuthService, {
    cookieName: env.AUTH_COOKIE_NAME,
    cookieSecure: env.NODE_ENV === 'production',
    sessionTtlMs,
  });

  app.use(
    cors({
      credentials: true,
      origin: env.FRONTEND_URL,
    }),
  );
  app.use(cookieParser());

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'tracechain-api',
    });
  });

  app.use('/api/auth', express.json({ limit: '10kb' }), createAuthRouter(authController));

  app.use(
    (
      error: Error & { type?: string },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error.type === 'entity.too.large') {
        response.status(413).json({
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'The authentication request is too large.' },
        });
        return;
      }

      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' },
      });
    },
  );

  return app;
}

export const app = createApp();
