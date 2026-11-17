import { Router } from 'express';
import { z, ZodError } from 'zod';
import { catalogueImageSchema, orderActionSchema } from './orders.schema.js';
import { OrdersError, type OrdersService } from './orders.service.js';
import { AuthError } from '../auth/auth.service.js';
import { ProductionFlowApiError } from '../production-flow/production-flow.service.js';
import { DidCommError } from '../didcomm/didcomm.service.js';
import { evidenceRequestSchema } from '../production-flow/production-flow.schema.js';
import { logisticsActionSchema } from './logistics.schema.js';
import { CustodyOfferError } from './custody-offers.js';

export function createOrdersRouter(resolve: () => OrdersService, cookieName: string) {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  const action =
    (
      operation: (
        service: OrdersService,
        session: string | undefined,
        request: any,
      ) => Promise<unknown>,
    ) =>
    async (request: any, response: any, next: any) => {
      try {
        response.json(await operation(resolve(), request.cookies?.[cookieName], request));
      } catch (error) {
        if (error instanceof ZodError)
          return response
            .status(400)
            .json({ error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message } });
        if (
          error instanceof OrdersError ||
          error instanceof AuthError ||
          error instanceof ProductionFlowApiError ||
          error instanceof DidCommError ||
          error instanceof CustodyOfferError
        )
          return response
            .status(error.status)
            .json({ error: { code: error.code, message: error.message } });
        // No RPC URLs, calldata or private documents are reflected to clients/logs.
        return response.status(503).json({
          error: {
            code: 'ORDER_SERVICE_UNAVAILABLE',
            message:
              'The order ledger is unavailable. Check the RPC, compile the contracts, deploy the updated suite, and configure SUPPLY_ORDERS_ADDRESS.',
          },
        });
      }
    };
  router.get(
    '/',
    action((service, session) => service.state(session)),
  );
  const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
  router.get(
    '/traceability',
    action((service, session, request) =>
      service.traceability(
        session,
        z
          .object({ kind: z.enum(['ingredient', 'product']).optional(), batchId: hash.optional() })
          .parse(request.query),
      ),
    ),
  );
  router.get(
    '/profile',
    action((service, session) => service.companyProfile(session)),
  );
  router.patch(
    '/profile/locations/:location',
    action((service, session, request) =>
      service.updateLocationLabel(
        session,
        hash.parse(request.params.location),
        z
          .object({
            label: z.string().trim().min(1).max(160),
            address: z.string().trim().min(1).max(1000).optional(),
          })
          .strict()
          .parse(request.body).label,
        request.body.address,
      ),
    ),
  );
  router.get(
    '/:referenceId/pickup',
    action((service, session, request) =>
      service.pickupPlan(session, hash.parse(request.params.referenceId)),
    ),
  );
  router.put(
    '/:referenceId/pickup',
    action((service, session, request) =>
      service.pickupPlan(
        session,
        hash.parse(request.params.referenceId),
        z.object({ pickupAt: z.number().int().positive() }).strict().parse(request.body),
      ),
    ),
  );
  router.get(
    '/information-requests',
    action((service, session) => service.informationRequests(session)),
  );
  const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
  router.get(
    '/custody-offers',
    action((service, session) => service.listCustodyOffers(session)),
  );
  router.get(
    '/custody-offers/:offerId',
    action((service, session, request) =>
      service.getCustodyOffer(session, hash.parse(request.params.offerId)),
    ),
  );
  router.post(
    '/custody-offers',
    action((service, session, request) =>
      service.createCustodyOffer(
        session,
        z
          .object({
            operationId: z.string().uuid(),
            kind: z.union([z.literal(1), z.literal(2)]),
            batchId: hash,
            quantity: z.string().regex(/^[1-9]\d{0,38}$/),
            fromLocation: hash,
            toLocation: hash,
            distributor: wallet,
            expiresAt: z.number().int().positive(),
          })
          .strict()
          .parse(request.body),
      ),
    ),
  );
  router.post(
    '/custody-offers/:offerId/action',
    action((service, session, request) =>
      service.actCustodyOffer(
        session,
        hash.parse(request.params.offerId),
        z
          .object({
            action: z.enum(['accept', 'reject', 'schedule']),
            pickupAt: z.number().int().positive().optional(),
          })
          .strict()
          .parse(request.body),
      ),
    ),
  );
  router.post(
    '/custody-offers/:offerId/prepare',
    action((service, session, request) =>
      service.prepareCustodyOffer(
        session,
        hash.parse(request.params.offerId),
        z
          .object({
            vehicle: z
              .string()
              .trim()
              .toUpperCase()
              .min(2)
              .max(32)
              .regex(/^(?=.*[A-Z0-9])[A-Z0-9 -]+$/),
            occurredAt: z.number().int().positive(),
            expectedAt: z.number().int().positive(),
          })
          .strict()
          .parse(request.body),
      ),
    ),
  );
  router.get(
    '/branding/me',
    action((service, session) => service.myBranding(session)),
  );
  router.post(
    '/branding/:wallet/logo',
    action((service, session, request) =>
      service.updateCompanyLogo(
        session,
        wallet.parse(request.params.wallet),
        catalogueImageSchema.parse(request.body),
      ),
    ),
  );
  router.post(
    '/catalogue/ingredients/:batchId/image',
    action((service, session, request) =>
      service.updateIngredientImage(
        session,
        hash.parse(request.params.batchId),
        catalogueImageSchema.parse(request.body),
      ),
    ),
  );
  router.post(
    '/catalogue/products/:batchId/image',
    action((service, session, request) =>
      service.updateProductImage(
        session,
        hash.parse(request.params.batchId),
        catalogueImageSchema.parse(request.body),
      ),
    ),
  );
  const media =
    (kind: 'company' | 'ingredient' | 'product') => async (request: any, response: any) => {
      try {
        const reference =
          kind === 'company'
            ? wallet.parse(request.params.wallet)
            : hash.parse(request.params.batchId);
        const result = await resolve().catalogueMedia(
          request.cookies?.[cookieName],
          kind,
          reference,
        );
        response.setHeader('Cache-Control', 'private, max-age=300');
        response.setHeader('Content-Type', result.mimeType);
        response.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
        response.setHeader('ETag', `"${result.contentHash.slice(2)}"`);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        response.send(result.bytes);
      } catch (error) {
        if (error instanceof ZodError)
          return response.status(400).json({
            error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message },
          });
        if (error instanceof OrdersError)
          return response
            .status(error.status)
            .json({ error: { code: error.code, message: error.message } });
        return response.status(503).json({
          error: { code: 'MEDIA_UNAVAILABLE', message: 'Catalogue media is unavailable.' },
        });
      }
    };
  router.get('/branding/:wallet/logo', media('company'));
  router.get('/catalogue/ingredients/:batchId/image', media('ingredient'));
  router.get('/catalogue/products/:batchId/image', media('product'));
  router.post(
    '/prepare',
    action((service, session, request) =>
      service.prepare(session, orderActionSchema.parse(request.body)),
    ),
  );
  router.get(
    '/recall/:batchId',
    action((service, session, request) =>
      service.recall(session, hash.parse(request.params.batchId)),
    ),
  );
  router.post(
    '/:orderId/evidence/prepare',
    action((service, session, request) =>
      service.prepareEvidence(
        session,
        z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .parse(request.params.orderId),
        evidenceRequestSchema.omit({ productBatchId: true }).parse(request.body),
      ),
    ),
  );
  router.post(
    '/logistics/prepare',
    action((service, session, request) =>
      service.prepareLogistics(session, logisticsActionSchema.parse(request.body)),
    ),
  );
  const claim = z.enum([
    'companyId',
    'companyName',
    'companyRegistrationNumber',
    'role',
    'walletAddress',
    'id',
    'applicationReference',
  ]);
  const identityInput = z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('request'),
        purpose: z.string().trim().min(1).max(500),
        expiresAt: z.number().int().positive(),
        required: z.boolean(),
        requiredClaims: z.array(claim).max(7),
        optionalClaims: z.array(claim).max(7),
      })
      .strict(),
    z
      .object({ action: z.literal('present'), presentation: z.string().min(100).max(300000) })
      .strict(),
    z.object({ action: z.enum(['material', 'verify', 'decline', 'status']) }).strict(),
  ]);
  router.post(
    '/:orderId/delivery/identity',
    action((service, session, request) =>
      service.identity(
        session,
        hash.parse(request.params.orderId),
        identityInput.parse(request.body),
        true,
      ),
    ),
  );
  router.post(
    '/:orderId/identity',
    action((service, session, request) =>
      service.identity(
        session,
        z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .parse(request.params.orderId),
        identityInput.parse(request.body),
      ),
    ),
  );
  return router;
}
