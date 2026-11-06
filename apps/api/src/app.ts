import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { loadBlockchainEnvironment } from './config/blockchain-env.js';
import { loadCredentialStorageEnvironment } from './config/credential-storage-env.js';
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
  JsonApplicationMetadataRepository,
  type ApplicationMetadataRepository,
} from './modules/blockchain/application-metadata.repository.js';
import {
  BlockchainGatewayService,
  type BlockchainGateway,
} from './modules/blockchain/blockchain-gateway.service.js';
import { createBlockchainRouter } from './modules/blockchain/blockchain.routes.js';
import { CustodyTransferController } from './modules/custody-transfers/custody-transfer.controller.js';
import {
  EthersCustodyTransferGateway,
  type CustodyTransferGateway,
} from './modules/custody-transfers/custody-transfer.gateway.js';
import { createCustodyTransferRouter } from './modules/custody-transfers/custody-transfer.routes.js';
import { CustodyTransferService } from './modules/custody-transfers/custody-transfer.service.js';
import { SsiController } from './modules/ssi/ssi.controller.js';
import {
  IpfsEncryptedCredentialStore,
  type CredentialContentStore,
} from './modules/ssi/encrypted-credential.store.js';
import {
  JsonCompanyRoleIssuanceRepository,
  type CompanyRoleIssuanceRepository,
} from './modules/ssi/issuance.repository.js';
import { createSsiRouter } from './modules/ssi/ssi.routes.js';
import {
  CompanyRoleSsiService,
  createDefaultTraceChainAgentProvider,
  type TraceChainAgentProvider,
} from './modules/ssi/ssi.service.js';

interface CreateAppOptions {
  applicationMetadataRepository?: ApplicationMetadataRepository;
  authService?: AuthService;
  blockchainGateway?: BlockchainGateway;
  custodyTransferService?: CustodyTransferService;
  ssi?: {
    agentProvider: TraceChainAgentProvider;
    authorityDidAlias: string;
    clock?: () => Date;
  };
}

export function createApp({
  applicationMetadataRepository,
  authService,
  blockchainGateway,
  custodyTransferService,
  ssi,
}: CreateAppOptions = {}) {
  const app = express();
  const sessionTtlMs = env.AUTH_SESSION_TTL_SECONDS * 1_000;
  const resolvedAuthService =
    authService ??
    new AuthService({
      configuration: {
        chainId: env.CHAIN_ID,
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
  const custodyTransferController = new CustodyTransferController(
    custodyTransferService ?? createDefaultCustodyTransferService(resolvedAuthService),
    env.AUTH_COOKIE_NAME,
  );
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
                blockchain.CREDENTIAL_REGISTRY_ADDRESS,
                env.CHAIN_ID,
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
  let resolvedGateway = blockchainGateway;
  const lazyGateway: BlockchainGateway = {
    getAdministrator: async () => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.getAdministrator();
    },
    getApplicationForIssuance: async (applicationId) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.getApplicationForIssuance(applicationId);
    },
    getCredentialState: async (credentialHash) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.getCredentialState(credentialHash);
    },
    getCredential: async (credentialId) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.getCredential(credentialId);
    },
    getStakeholder: async (account) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.getStakeholder(account);
    },
    getRolePermission: async (role, permission) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.getRolePermission(role, permission);
    },
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
    prepareApplicationApproval: (input) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.prepareApplicationApproval(input);
    },
    prepareCredentialRegistration: (input) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.prepareCredentialRegistration(input);
    },
    prepareCredentialLifecycle: (input) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.prepareCredentialLifecycle(input);
    },
    prepareStakeholderLifecycle: (input) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.prepareStakeholderLifecycle(input);
    },
    prepareRolePermission: (input) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.prepareRolePermission(input);
    },
  };
  let issuanceRepository: CompanyRoleIssuanceRepository | undefined;
  let credentialContentStore: CredentialContentStore | undefined;
  const lazyIssuanceRepository: CompanyRoleIssuanceRepository = {
    find: async (applicationId) => {
      issuanceRepository ??= createIssuanceDependencies().repository;
      return issuanceRepository.find(applicationId);
    },
    list: async () => {
      issuanceRepository ??= createIssuanceDependencies().repository;
      return issuanceRepository.list();
    },
    save: async (record) => {
      issuanceRepository ??= createIssuanceDependencies().repository;
      return issuanceRepository.save(record);
    },
  };
  const blockchainController = new BlockchainController(
    lazyGateway,
    resolvedAuthService,
    env.AUTH_COOKIE_NAME,
    applicationMetadataRepository ??
      new JsonApplicationMetadataRepository(
        fileURLToPath(
          new URL('../../../.tracechain/applications/company-metadata.json', import.meta.url),
        ),
      ),
    lazyIssuanceRepository,
  );
  const lazyCredentialContentStore: CredentialContentStore = {
    decrypt: async (payload) => {
      credentialContentStore ??= createIssuanceDependencies().contentStore;
      return credentialContentStore.decrypt(payload);
    },
    encryptAndStore: async (serialized, credentialId) => {
      credentialContentStore ??= createIssuanceDependencies().contentStore;
      return credentialContentStore.encryptAndStore(serialized, credentialId);
    },
  };
  const ssiController = new SsiController(
    new CompanyRoleSsiService({
      agentProvider: defaultSsi.agentProvider,
      authService: resolvedAuthService,
      authorityDidAlias: defaultSsi.authorityDidAlias,
      blockchainAuthorization,
      blockchainGateway: lazyGateway,
      chainId: env.CHAIN_ID,
      clock: 'clock' in defaultSsi ? defaultSsi.clock : undefined,
      credentialContentStore: lazyCredentialContentStore,
      issuanceRepository: lazyIssuanceRepository,
    }),
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
    '/api/custody-transfers',
    express.json({ limit: '4kb' }),
    createCustodyTransferRouter(custodyTransferController),
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
    env.CHAIN_ID,
    blockchain.CHAIN_RPC_URL,
    blockchain.STAKEHOLDER_REGISTRY_ADDRESS,
    blockchain.CREDENTIAL_REGISTRY_ADDRESS,
  );
}

function createDefaultCustodyTransferService(authService: AuthService) {
  let blockchainEnvironment: ReturnType<typeof loadBlockchainEnvironment> | undefined;
  let gateway: CustodyTransferGateway | undefined;
  const configuration = () => {
    blockchainEnvironment ??= loadBlockchainEnvironment();
    return {
      chainId: env.CHAIN_ID,
      contractAddress: blockchainEnvironment.CUSTODY_TRANSFER_ADDRESS,
    };
  };

  const lazyGateway: CustodyTransferGateway = {
    getTransfer: async (transferId) => {
      const resolvedConfiguration = configuration();
      gateway ??= new EthersCustodyTransferGateway(
        resolvedConfiguration.chainId,
        blockchainEnvironment!.CHAIN_RPC_URL,
        resolvedConfiguration.contractAddress,
      );
      return gateway.getTransfer(transferId);
    },
  };

  return new CustodyTransferService({
    authService,
    configuration,
    gateway: lazyGateway,
  });
}

function createIssuanceDependencies() {
  const storage = loadCredentialStorageEnvironment();
  return {
    contentStore: new IpfsEncryptedCredentialStore(
      storage.encryptionKey,
      storage.pinningApiUrl,
      storage.pinningToken,
    ),
    repository: new JsonCompanyRoleIssuanceRepository(storage.workflowStorePath),
  };
}

export const app = createApp();
