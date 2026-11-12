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
import { GatewayLoginAuthorizationResolver } from './modules/blockchain/login-authorization.service.js';
import { CustodyTransferController } from './modules/custody-transfers/custody-transfer.controller.js';
import {
  EthersCustodyTransferGateway,
  type CustodyTransferGateway,
} from './modules/custody-transfers/custody-transfer.gateway.js';
import { JsonReceiptWorkflowRepository } from './modules/custody-transfers/custody-transfer.repository.js';
import { createCustodyTransferRouter } from './modules/custody-transfers/custody-transfer.routes.js';
import { CustodyTransferService } from './modules/custody-transfers/custody-transfer.service.js';
import {
  JsonDidCommRepository,
  type DidCommRepository,
} from './modules/didcomm/didcomm.repository.js';
import { createDidCommRouter } from './modules/didcomm/didcomm.routes.js';
import { DidCommService } from './modules/didcomm/didcomm.service.js';
import { BackendDidCommAgentService } from './modules/didcomm/backend-agent.service.js';
import { DocumentExtractionController } from './modules/document-extraction/document-extraction.controller.js';
import { createDocumentExtractionRouter } from './modules/document-extraction/document-extraction.routes.js';
import { DocumentExtractionService } from './modules/document-extraction/document-extraction.service.js';
import { IngredientBatchController } from './modules/ingredient-batches/ingredient-batch.controller.js';
import {
  EthersIngredientBatchGateway,
  type IngredientBatchGateway,
} from './modules/ingredient-batches/ingredient-batch.gateway.js';
import {
  JsonIngredientBatchWorkflowRepository,
  type IngredientBatchWorkflowRepository,
} from './modules/ingredient-batches/ingredient-batch.repository.js';
import { createIngredientBatchRouter } from './modules/ingredient-batches/ingredient-batch.routes.js';
import { IngredientBatchService } from './modules/ingredient-batches/ingredient-batch.service.js';
import { ProductionFlowController } from './modules/production-flow/production-flow.controller.js';
import {
  EthersProductionFlowGateway,
  type ProductionFlowGateway,
} from './modules/production-flow/production-flow.gateway.js';
import {
  JsonProductionFlowRepository,
  type ProductionFlowRepository,
} from './modules/production-flow/production-flow.repository.js';
import { createProductionFlowRouter } from './modules/production-flow/production-flow.routes.js';
import { ProductionFlowService } from './modules/production-flow/production-flow.service.js';
import { EthersOrdersGateway } from './modules/orders/orders.gateway.js';
import { OrdersService } from './modules/orders/orders.service.js';
import { createOrdersRouter } from './modules/orders/orders.routes.js';
import { ProductTraceabilityController } from './modules/product-traceability/product-traceability.controller.js';
import { EthersProductTraceabilityGateway } from './modules/product-traceability/product-traceability.gateway.js';
import { RepositoryTraceabilityMetadataReader } from './modules/product-traceability/product-traceability.metadata.js';
import { createProductTraceabilityRouter } from './modules/product-traceability/product-traceability.routes.js';
import { ProductTraceabilityService } from './modules/product-traceability/product-traceability.service.js';
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
import { StakeholderDirectoryController } from './modules/stakeholder-directory/stakeholder-directory.controller.js';
import { createStakeholderDirectoryRouter } from './modules/stakeholder-directory/stakeholder-directory.routes.js';
import {
  VerifiedStakeholderDirectory,
  type StakeholderDirectory,
} from './modules/stakeholder-directory/stakeholder-directory.service.js';

interface CreateAppOptions {
  applicationMetadataRepository?: ApplicationMetadataRepository;
  authService?: AuthService;
  blockchainGateway?: BlockchainGateway;
  custodyTransferService?: CustodyTransferService;
  documentExtractionService?: DocumentExtractionService;
  ingredientBatchService?: IngredientBatchService;
  productionFlowService?: ProductionFlowService;
  productTraceabilityService?: ProductTraceabilityService;
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
  documentExtractionService,
  ingredientBatchService,
  productionFlowService,
  productTraceabilityService,
  ssi,
}: CreateAppOptions = {}) {
  const app = express();
  const sessionTtlMs = env.AUTH_SESSION_TTL_SECONDS * 1_000;
  let resolvedGateway = blockchainGateway;
  const authorizationResolver = {
    resolve: async (address: string) => {
      resolvedGateway ??= createDefaultBlockchainGateway();
      return new GatewayLoginAuthorizationResolver(resolvedGateway).resolve(address);
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
  const stakeholderDirectory = new VerifiedStakeholderDirectory(
    lazyIssuanceRepository,
    authorizationResolver,
  );
  const resolvedAuthService =
    authService ??
    new AuthService({
      authorizationResolver,
      configuration: {
        chainId: env.CHAIN_ID,
        domain: env.SIWE_DOMAIN,
        nonceTtlMs: 5 * 60 * 1_000,
        sessionTtlMs,
        uri: env.SIWE_URI,
      },
      nonceRepository: new InMemoryNonceRepository(),
      sessionRepository: new InMemorySessionRepository(),
      stakeholderDirectory,
    });
  const authController = new AuthController(resolvedAuthService, {
    cookieName: env.AUTH_COOKIE_NAME,
    cookieSecure: env.NODE_ENV === 'production',
    sessionTtlMs,
  });
  const defaultSsi = ssi ?? createDefaultTraceChainAgentProvider();
  const didCommRepository = new JsonDidCommRepository(
    fileURLToPath(new URL('../../../.tracechain/didcomm/state.json', import.meta.url)),
  );
  const didCommStorage = loadCredentialStorageEnvironment();
  const backendDidCommAgents = new BackendDidCommAgentService(
    fileURLToPath(new URL('../../../.tracechain/didcomm/backend-agents.json', import.meta.url)),
    didCommStorage.encryptionKey,
  );
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
  const lazyGateway: BlockchainGateway = {
    getRegistryReferences: () => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return (
        resolvedGateway.getRegistryReferences?.() ?? {
          credentialRegistry: '',
          stakeholderRegistry: '',
        }
      );
    },
    listOperationalData: async (account) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      if (!resolvedGateway.listOperationalData)
        throw new Error('Operational blockchain reads are unavailable.');
      return resolvedGateway.listOperationalData(account);
    },
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
    getEffectiveRole: async (account) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.getEffectiveRole(account);
    },
    getRolePermission: async (role, permission) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.getRolePermission(role, permission);
    },
    getPersonalPermission: async (account, permission) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      if (!resolvedGateway.getPersonalPermission)
        throw new Error(
          'Individual permissions are unavailable. Update the StakeholderRegistry deployment.',
        );
      return resolvedGateway.getPersonalPermission(account, permission);
    },
    preparePersonalPermission: (input) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      if (!resolvedGateway.preparePersonalPermission)
        throw new Error('Individual permissions are unavailable.');
      return resolvedGateway.preparePersonalPermission(input);
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
    prepareCredentialReference: (input) => {
      if (!resolvedGateway) resolvedGateway = createDefaultBlockchainGateway();
      return resolvedGateway.prepareCredentialReference(input);
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
    stakeholderDirectory,
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
  const custodyTransferController = new CustodyTransferController(
    custodyTransferService ??
      createDefaultCustodyTransferService(
        resolvedAuthService,
        stakeholderDirectory,
        lazyCredentialContentStore,
      ),
    env.AUTH_COOKIE_NAME,
  );
  let ordersService: OrdersService | undefined;
  const resolveOrders = () => {
    if (!ordersService) {
      const chain = loadBlockchainEnvironment();
      if (!process.env.SUPPLY_ORDERS_ADDRESS) throw new Error('Order registry is not configured.');
      ordersService = new OrdersService(
        resolvedAuthService,
        new EthersOrdersGateway(
          env.CHAIN_ID,
          process.env.SUPPLY_ORDERS_ADDRESS,
          chain.CHAIN_RPC_URL,
          {
            stakeholders: chain.STAKEHOLDER_REGISTRY_ADDRESS,
            credentials: chain.CREDENTIAL_REGISTRY_ADDRESS,
            ingredients: chain.INGREDIENT_REGISTRY_ADDRESS,
            products: chain.PRODUCT_REGISTRY_ADDRESS,
            evidence: chain.EVIDENCE_REGISTRY_ADDRESS,
            custody: chain.CUSTODY_TRANSFER_ADDRESS,
          },
        ),
        lazyCredentialContentStore,
        new JsonProductionFlowRepository(didCommStorage.productionWorkflowStorePath),
        resolvedProductionFlowService,
        didCommService,
        stakeholderDirectory,
        new JsonIngredientBatchWorkflowRepository(
          loadCredentialStorageEnvironment().ingredientWorkflowStorePath,
        ),
      );
    }
    return ordersService;
  };
  const ordersRouter = createOrdersRouter(resolveOrders, env.AUTH_COOKIE_NAME);
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
  const resolvedIngredientBatchService =
    ingredientBatchService ??
    createDefaultIngredientBatchService(
      resolvedAuthService,
      defaultSsi.agentProvider,
      lazyCredentialContentStore,
      didCommRepository,
    );
  const ingredientBatchController = new IngredientBatchController(
    resolvedIngredientBatchService,
    env.AUTH_COOKIE_NAME,
  );
  const documentExtractionController = new DocumentExtractionController(
    documentExtractionService ??
      new DocumentExtractionService({ access: resolvedIngredientBatchService }),
    env.AUTH_COOKIE_NAME,
  );
  const resolvedProductionFlowService =
    productionFlowService ??
    createDefaultProductionFlowService(
      resolvedAuthService,
      defaultSsi.agentProvider,
      lazyCredentialContentStore,
      stakeholderDirectory,
      didCommRepository,
      lazyIssuanceRepository,
    );
  const productionFlowController = new ProductionFlowController(
    resolvedProductionFlowService,
    env.AUTH_COOKIE_NAME,
  );
  const didCommService = new DidCommService(
    resolvedAuthService,
    didCommRepository,
    env.SIWE_DOMAIN,
    env.CHAIN_ID,
    stakeholderDirectory,
    undefined,
    backendDidCommAgents,
    async (reference) => {
      const record = await new JsonProductionFlowRepository(
        didCommStorage.productionWorkflowStorePath,
      ).findEvidence(reference);
      if (record?.orderContext) {
        const order = await resolveOrders().gateway.read('orders', 'getOrder', [reference]);
        if (
          order.status === '0' ||
          order.status === '3' ||
          Number(order.expiresAt) <= Date.now() / 1000
        )
          return undefined;
        return { requester: order.buyer, supplier: order.seller, order: true };
      }
      return record ? { requester: record.requester, supplier: record.supplier } : undefined;
    },
  );
  const productTraceabilityController = new ProductTraceabilityController(
    productTraceabilityService ??
      createDefaultProductTraceabilityService(
        resolvedAuthService,
        stakeholderDirectory,
        lazyCredentialContentStore,
      ),
    env.AUTH_COOKIE_NAME,
  );

  app.use(
    cors({
      credentials: true,
      origin: env.FRONTEND_URL,
    }),
  );
  app.use(cookieParser());
  app.use('/api', (request, response, next) => {
    const origin = request.get('origin');
    if (
      origin &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      origin !== env.FRONTEND_URL
    ) {
      response.status(403).json({
        error: { code: 'UNTRUSTED_ORIGIN', message: 'The request origin is not trusted.' },
      });
      return;
    }
    next();
  });

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'tracechain-api',
    });
  });

  app.use('/api/auth', express.json({ limit: '10kb' }), createAuthRouter(authController));
  app.use(
    '/api/didcomm',
    express.json({ limit: '300kb' }),
    createDidCommRouter(didCommService, env.AUTH_COOKIE_NAME),
  );
  app.use(
    '/api/stakeholders',
    createStakeholderDirectoryRouter(
      new StakeholderDirectoryController(
        resolvedAuthService,
        stakeholderDirectory,
        env.AUTH_COOKIE_NAME,
      ),
    ),
  );
  app.use('/api/ssi', express.json({ limit: '256kb' }), createSsiRouter(ssiController));
  app.use('/api/orders', express.json({ limit: '4mb' }), ordersRouter);
  app.use('/api/ingredients', createDocumentExtractionRouter(documentExtractionController));
  app.use(
    '/api/ingredient-batches',
    express.json({ limit: '32kb' }),
    createIngredientBatchRouter(ingredientBatchController),
  );
  app.use(
    '/api/blockchain',
    express.json({ limit: '32kb' }),
    createBlockchainRouter(blockchainController),
  );
  app.use(
    '/api/custody-transfers',
    express.json({ limit: '24mb' }),
    createCustodyTransferRouter(custodyTransferController),
  );
  app.use(
    '/api/production-flow',
    express.json({ limit: '64kb' }),
    createProductionFlowRouter(productionFlowController),
  );
  app.use(
    '/api/product-traceability',
    express.json({ limit: '4kb' }),
    createProductTraceabilityRouter(productTraceabilityController),
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

      console.error('Unhandled API error', {
        message: error.message,
        name: error.name,
        stack: error.stack,
      });

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
    blockchain.INGREDIENT_REGISTRY_ADDRESS,
    blockchain.PRODUCT_REGISTRY_ADDRESS,
    blockchain.CUSTODY_TRANSFER_ADDRESS,
    blockchain.EVIDENCE_REGISTRY_ADDRESS,
  );
}

function createDefaultProductTraceabilityService(
  authService: AuthService,
  stakeholderDirectory: StakeholderDirectory,
  contentStore: CredentialContentStore,
) {
  let blockchain: ReturnType<typeof loadBlockchainEnvironment> | undefined;
  let gateway: EthersProductTraceabilityGateway | undefined;
  const configuration = () => {
    blockchain ??= loadBlockchainEnvironment();
    return {
      chainId: env.CHAIN_ID,
      productRegistryAddress: blockchain.PRODUCT_REGISTRY_ADDRESS,
      publicAppUrl: env.VITE_PUBLIC_APP_URL,
    };
  };
  const resolveGateway = () => {
    const resolved = configuration();
    gateway ??= new EthersProductTraceabilityGateway(env.CHAIN_ID, blockchain!.CHAIN_RPC_URL, {
      credential: blockchain!.CREDENTIAL_REGISTRY_ADDRESS,
      custody: blockchain!.CUSTODY_TRANSFER_ADDRESS,
      ingredient: blockchain!.INGREDIENT_REGISTRY_ADDRESS,
      product: resolved.productRegistryAddress,
    });
    return gateway;
  };
  const repositoryRoot = new URL('../../../.tracechain/issuance/', import.meta.url);
  const metadata = new RepositoryTraceabilityMetadataReader(
    new JsonProductionFlowRepository(
      fileURLToPath(new URL('production-flow.json', repositoryRoot)),
    ),
    new JsonIngredientBatchWorkflowRepository(
      fileURLToPath(new URL('ingredient-batches.json', repositoryRoot)),
    ),
    contentStore,
  );
  return new ProductTraceabilityService({
    authService,
    configuration,
    gateway: {
      getCredential: (id) => resolveGateway().getCredential(id),
      getIngredient: (id) => resolveGateway().getIngredient(id),
      getIngredientLinks: (id) => resolveGateway().getIngredientLinks(id),
      getProduct: (id) => resolveGateway().getProduct(id),
      listTransfers: (id) => resolveGateway().listTransfers(id),
    },
    metadata,
    stakeholderDirectory,
  });
}

function createDefaultCustodyTransferService(
  authService: AuthService,
  stakeholderDirectory: StakeholderDirectory,
  contentStore: CredentialContentStore,
) {
  let blockchainEnvironment: ReturnType<typeof loadBlockchainEnvironment> | undefined;
  let gateway: CustodyTransferGateway | undefined;
  let permissionGateway: BlockchainGatewayService | undefined;
  const configuration = () => {
    blockchainEnvironment ??= loadBlockchainEnvironment();
    return {
      chainId: env.CHAIN_ID,
      contractAddress: blockchainEnvironment.CUSTODY_TRANSFER_ADDRESS,
      publicAppUrl: env.VITE_PUBLIC_APP_URL,
    };
  };

  const lazyGateway: CustodyTransferGateway = {
    getReceiptEvidenceReference: async (transferId) => {
      configuration();
      gateway ??= new EthersCustodyTransferGateway(
        env.CHAIN_ID,
        blockchainEnvironment!.CHAIN_RPC_URL,
        blockchainEnvironment!.CUSTODY_TRANSFER_ADDRESS,
      );
      return gateway.getReceiptEvidenceReference(transferId);
    },
    getRejectionEvidenceReference: async (transferId) => {
      configuration();
      gateway ??= new EthersCustodyTransferGateway(
        env.CHAIN_ID,
        blockchainEnvironment!.CHAIN_RPC_URL,
        blockchainEnvironment!.CUSTODY_TRANSFER_ADDRESS,
      );
      return gateway.getRejectionEvidenceReference(transferId);
    },
    getDiscrepancy: async (transferId) => {
      configuration();
      gateway ??= new EthersCustodyTransferGateway(
        env.CHAIN_ID,
        blockchainEnvironment!.CHAIN_RPC_URL,
        blockchainEnvironment!.CUSTODY_TRANSFER_ADDRESS,
      );
      return gateway.getDiscrepancy(transferId);
    },
    getTransfer: async (transferId) => {
      const resolvedConfiguration = configuration();
      gateway ??= new EthersCustodyTransferGateway(
        resolvedConfiguration.chainId,
        blockchainEnvironment!.CHAIN_RPC_URL,
        resolvedConfiguration.contractAddress,
      );
      return gateway.getTransfer(transferId);
    },
    listDiscrepancies: async () => {
      configuration();
      gateway ??= new EthersCustodyTransferGateway(
        env.CHAIN_ID,
        blockchainEnvironment!.CHAIN_RPC_URL,
        blockchainEnvironment!.CUSTODY_TRANSFER_ADDRESS,
      );
      return gateway.listDiscrepancies();
    },
    prepareDiscrepancyReport: (input) => {
      configuration();
      gateway ??= new EthersCustodyTransferGateway(
        env.CHAIN_ID,
        blockchainEnvironment!.CHAIN_RPC_URL,
        blockchainEnvironment!.CUSTODY_TRANSFER_ADDRESS,
      );
      return gateway.prepareDiscrepancyReport(input);
    },
    prepareDiscrepancyResolution: (input) => {
      configuration();
      gateway ??= new EthersCustodyTransferGateway(
        env.CHAIN_ID,
        blockchainEnvironment!.CHAIN_RPC_URL,
        blockchainEnvironment!.CUSTODY_TRANSFER_ADDRESS,
      );
      return gateway.prepareDiscrepancyResolution(input);
    },
    prepareReceiptConfirmation: (input) => {
      const resolvedConfiguration = configuration();
      gateway ??= new EthersCustodyTransferGateway(
        resolvedConfiguration.chainId,
        blockchainEnvironment!.CHAIN_RPC_URL,
        resolvedConfiguration.contractAddress,
      );
      return gateway.prepareReceiptConfirmation(input);
    },
    prepareRejection: (input) => {
      configuration();
      gateway ??= new EthersCustodyTransferGateway(
        env.CHAIN_ID,
        blockchainEnvironment!.CHAIN_RPC_URL,
        blockchainEnvironment!.CUSTODY_TRANSFER_ADDRESS,
      );
      return gateway.prepareRejection(input);
    },
  };

  const repositoryRoot = new URL('../../../.tracechain/issuance/', import.meta.url);
  const productMetadata = new RepositoryTraceabilityMetadataReader(
    new JsonProductionFlowRepository(
      fileURLToPath(new URL('production-flow.json', repositoryRoot)),
    ),
    new JsonIngredientBatchWorkflowRepository(
      fileURLToPath(new URL('ingredient-batches.json', repositoryRoot)),
    ),
    contentStore,
  );

  return new CustodyTransferService({
    authService,
    configuration,
    contentStore,
    gateway: lazyGateway,
    hasReceiptPermission: async (address, permission) => {
      permissionGateway ??= createDefaultBlockchainGateway();
      return (await permissionGateway.getPersonalPermission(address, permission)).effective;
    },
    productMetadata,
    receiptRepository: new JsonReceiptWorkflowRepository(
      fileURLToPath(new URL('custody-receipts.json', repositoryRoot)),
    ),
    stakeholderDirectory,
  });
}

function createDefaultIngredientBatchService(
  authService: AuthService,
  agentProvider: TraceChainAgentProvider,
  contentStore: CredentialContentStore,
  messagingIdentityResolver: Pick<JsonDidCommRepository, 'findIdentityByWallet'>,
) {
  let gateway: IngredientBatchGateway | undefined;
  let repository: IngredientBatchWorkflowRepository | undefined;
  const resolveGateway = () => {
    if (!gateway) {
      const blockchain = loadBlockchainEnvironment();
      gateway = new EthersIngredientBatchGateway(
        env.CHAIN_ID,
        blockchain.CHAIN_RPC_URL,
        blockchain.STAKEHOLDER_REGISTRY_ADDRESS,
        blockchain.CREDENTIAL_REGISTRY_ADDRESS,
        blockchain.INGREDIENT_REGISTRY_ADDRESS,
      );
    }
    return gateway;
  };
  const lazyGateway: IngredientBatchGateway = {
    assertDeployment: () => resolveGateway().assertDeployment(),
    getBatch: (batchId) => resolveGateway().getBatch(batchId),
    getCredential: (credentialId) => resolveGateway().getCredential(credentialId),
    getSupplierAccess: (wallet, credentialHash) =>
      resolveGateway().getSupplierAccess(wallet, credentialHash),
    listBatchIds: (wallet) => resolveGateway().listBatchIds(wallet),
    prepareBatchRegistration: (input) => resolveGateway().prepareBatchRegistration(input),
    prepareIngredientCredentialRegistration: (input) =>
      resolveGateway().prepareIngredientCredentialRegistration(input),
  };
  const resolveRepository = () => {
    repository ??= new JsonIngredientBatchWorkflowRepository(
      loadCredentialStorageEnvironment().ingredientWorkflowStorePath,
    );
    return repository;
  };
  const lazyRepository: IngredientBatchWorkflowRepository = {
    find: (batchId) => resolveRepository().find(batchId),
    listForSupplier: (wallet) => resolveRepository().listForSupplier(wallet),
    save: (record) => resolveRepository().save(record),
  };
  return new IngredientBatchService({
    agentProvider,
    authService,
    contentStore,
    gateway: lazyGateway,
    messagingIdentityResolver,
    repository: lazyRepository,
  });
}

function createDefaultProductionFlowService(
  authService: AuthService,
  agentProvider: TraceChainAgentProvider,
  contentStore: CredentialContentStore,
  stakeholderDirectory: StakeholderDirectory,
  messagingIdentityRepository: DidCommRepository,
  companyRoleRepository: CompanyRoleIssuanceRepository,
) {
  let gateway: ProductionFlowGateway | undefined;
  let repository: ProductionFlowRepository | undefined;
  let ingredientRepository: IngredientBatchWorkflowRepository | undefined;
  const storage = () => loadCredentialStorageEnvironment();
  const resolveGateway = () => {
    if (!gateway) {
      const blockchain = loadBlockchainEnvironment();
      gateway = new EthersProductionFlowGateway(env.CHAIN_ID, blockchain.CHAIN_RPC_URL, {
        credential: blockchain.CREDENTIAL_REGISTRY_ADDRESS,
        custody: blockchain.CUSTODY_TRANSFER_ADDRESS,
        evidence: blockchain.EVIDENCE_REGISTRY_ADDRESS,
        ingredient: blockchain.INGREDIENT_REGISTRY_ADDRESS,
        product: blockchain.PRODUCT_REGISTRY_ADDRESS,
        stakeholder: blockchain.STAKEHOLDER_REGISTRY_ADDRESS,
      });
    }
    return gateway;
  };
  const lazyGateway: ProductionFlowGateway = {
    getProductionRecord: (batchId) => resolveGateway().getProductionRecord!(batchId),
    listProposedProductBatchIds: (wallet) => resolveGateway().listProposedProductBatchIds!(wallet),
    getReceivedAvailable: (...input) => resolveGateway().getReceivedAvailable!(...input),
    assertDeployment: () => resolveGateway().assertDeployment(),
    getAccess: (...input) => resolveGateway().getAccess(...input),
    getAccepted: (...input) => resolveGateway().getAccepted(...input),
    getCredential: (input) => resolveGateway().getCredential(input),
    getEvidenceRequest: (input) => resolveGateway().getEvidenceRequest(input),
    getIngredient: (input) => resolveGateway().getIngredient(input),
    getInventory: (...input) => resolveGateway().getInventory(...input),
    hasPermission: (...input) => resolveGateway().hasPermission(...input),
    getProduct: (input) => resolveGateway().getProduct(input),
    getProductLinks: (input) => resolveGateway().getProductLinks(input),
    getTransfer: (input) => resolveGateway().getTransfer(input),
    isRoleAuthorized: (...input) => resolveGateway().isRoleAuthorized(...input),
    isTransferable: (input) => resolveGateway().isTransferable(input),
    listActiveDistributors: () => resolveGateway().listActiveDistributors(),
    listActiveRetailers: () => resolveGateway().listActiveRetailers(),
    listReceivedProductBatchIds: (input) => resolveGateway().listReceivedProductBatchIds(input),
    listEvidenceRequestIds: (...input) => resolveGateway().listEvidenceRequestIds(...input),
    listIngredients: () => resolveGateway().listIngredients(),
    prepareAccept: (...input) => resolveGateway().prepareAccept(...input),
    prepareClose: (...input) => resolveGateway().prepareClose(...input),
    prepareEvidenceRequest: (input) => resolveGateway().prepareEvidenceRequest(input),
    prepareEvidenceResponse: (input) => resolveGateway().prepareEvidenceResponse(input),
    prepareProduct: (input) => resolveGateway().prepareProduct(input),
    prepareTransfer: (input) => resolveGateway().prepareTransfer(input),
  };
  const resolveRepository = () =>
    (repository ??= new JsonProductionFlowRepository(storage().productionWorkflowStorePath));
  const lazyRepository: ProductionFlowRepository = {
    findEvidence: (input) => resolveRepository().findEvidence(input),
    findEvidenceByOperation: (...input) => resolveRepository().findEvidenceByOperation(...input),
    findPrivate: (...input) => resolveRepository().findPrivate(...input),
    saveEvidence: (input) => resolveRepository().saveEvidence(input),
    savePrivate: (...input) => resolveRepository().savePrivate(...input),
  };
  const resolveIngredientRepository = () =>
    (ingredientRepository ??= new JsonIngredientBatchWorkflowRepository(
      storage().ingredientWorkflowStorePath,
    ));
  const lazyIngredientRepository: IngredientBatchWorkflowRepository = {
    find: (input) => resolveIngredientRepository().find(input),
    listForSupplier: (input) => resolveIngredientRepository().listForSupplier(input),
    save: (input) => resolveIngredientRepository().save(input),
  };
  return new ProductionFlowService({
    agentProvider,
    authService,
    companyRoleRepository,
    contentStore,
    gateway: lazyGateway,
    ingredientRepository: lazyIngredientRepository,
    messagingIdentityRepository,
    presentationDomain: env.SIWE_DOMAIN,
    repository: lazyRepository,
    stakeholderDirectory,
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
