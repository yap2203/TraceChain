import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';

import { env } from './config/env.js';
import { loadBlockchainEnvironment } from './config/blockchain-env.js';
import { AuthController } from './modules/auth/auth.controller.js';
import {
  InMemoryNonceRepository,
  InMemorySessionRepository,
} from './modules/auth/auth.repository.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import {
  EthersBlockchainAuthorizationService,
  BlockchainAuthorizationUnavailableError,
  type BlockchainAuthorizationService,
} from './modules/blockchain/blockchain-authorization.service.js';
import { BlockchainController } from './modules/blockchain/blockchain.controller.js';
import {
  BlockchainGatewayService,
  type BlockchainGateway,
} from './modules/blockchain/blockchain-gateway.service.js';
import { createBlockchainRouter } from './modules/blockchain/blockchain.routes.js';
import { SsiController } from './modules/ssi/ssi.controller.js';
import { createSsiRouter } from './modules/ssi/ssi.routes.js';
import {
  CompanyRoleSsiService,
  createDefaultTraceChainAgentProvider,
  type TraceChainAgentProvider,
} from './modules/ssi/ssi.service.js';

interface CreateAppOptions {
  authService?: AuthService;
  blockchainGateway?: BlockchainGateway;
  ssi?: {
    agentProvider: TraceChainAgentProvider;
    authorityDidAlias: string;
    clock?: () => Date;
  };
}

export function createApp({ authService, blockchainGateway, ssi }: CreateAppOptions = {}) {
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
  const defaultSsi = ssi ?? createDefaultTraceChainAgentProvider();
  let blockchainService: BlockchainAuthorizationService | undefined;
  const blockchainAuthorization: BlockchainAuthorizationService | undefined = ssi
    ? undefined
    : {
        authorize: async (input) => {
          try {
            if (!blockchainService) {
              const blockchain = loadBlockchainEnvironment();
              blockchainService = new EthersBlockchainAuthorizationService(
                blockchain.CHAIN_RPC_URL,
                blockchain.STAKEHOLDER_REGISTRY_ADDRESS,
                env.SIWE_CHAIN_ID,
              );
            }
            return blockchainService.authorize(input);
          } catch (error) {
            if (error instanceof BlockchainAuthorizationUnavailableError) throw error;
            throw new BlockchainAuthorizationUnavailableError(
              'Blockchain authorization is not configured correctly.',
            );
          }
        },
      };
  const ssiController = new SsiController(
    new CompanyRoleSsiService({
      agentProvider: defaultSsi.agentProvider,
      authService: resolvedAuthService,
      authorityDidAlias: defaultSsi.authorityDidAlias,
      blockchainAuthorization,
      clock: 'clock' in defaultSsi ? defaultSsi.clock : undefined,
    }),
    env.AUTH_COOKIE_NAME,
  );
  let resolvedGateway = blockchainGateway;
  const lazyGateway: BlockchainGateway = {
    listApplications: async () => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.listApplications();
    },
    prepareApplication: (input) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.prepareApplication(input);
    },
    prepareRejection: (applicationId, reasonHash) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.prepareRejection(applicationId, reasonHash);
    },
  };
  const blockchainController = new BlockchainController(
    lazyGateway,
    resolvedAuthService,
    env.AUTH_COOKIE_NAME,
  );

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
  app.use('/api/ssi', express.json({ limit: '256kb' }), createSsiRouter(ssiController));
  app.use(
    '/api/blockchain',
    express.json({ limit: '32kb' }),
    createBlockchainRouter(blockchainController),
  );

  app.use(
    (
      error: Error & { type?: string },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error.type === 'entity.too.large') {
        response.status(413).json({
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' },
        });
        return;
      }

      if (error instanceof SyntaxError && 'body' in error) {
        response.status(400).json({
          error: { code: 'INVALID_JSON', message: 'The request body must contain valid JSON.' },
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

function createDefaultBlockchainGateway() {
  const blockchain = loadBlockchainEnvironment();
  return new BlockchainGatewayService(
    env.SIWE_CHAIN_ID,
    blockchain.CHAIN_RPC_URL,
    blockchain.STAKEHOLDER_REGISTRY_ADDRESS,
  );
}

export const app = createApp();
