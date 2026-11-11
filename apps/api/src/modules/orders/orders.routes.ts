import { Router } from 'express';
import { z, ZodError } from 'zod';
import { orderActionSchema } from './orders.schema.js';
import { OrdersError, type OrdersService } from './orders.service.js';
import { AuthError } from '../auth/auth.service.js';
import { ProductionFlowApiError } from '../production-flow/production-flow.service.js';
import { DidCommError } from '../didcomm/didcomm.service.js';
import { evidenceRequestSchema } from '../production-flow/production-flow.schema.js';

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
          error instanceof DidCommError
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
  router.post(
    '/prepare',
    action((service, session, request) =>
      service.prepare(session, orderActionSchema.parse(request.body)),
    ),
  );
  router.get(
    '/recall/:batchId',
    action((service, session, request) =>
      service.recall(
        session,
        z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .parse(request.params.batchId),
      ),
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
