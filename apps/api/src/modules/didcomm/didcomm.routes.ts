import { Router } from 'express';
import { z } from 'zod';
import type { DidCommService } from './didcomm.service.js';
import { DidCommError } from './didcomm.service.js';

const envelopeSchema = z.object({
  businessReference: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  envelope: z.string().min(20).max(256_000),
  expiresAt: z.string().datetime(),
  fromDid: z.string().startsWith('did:key:'),
  id: z.string().uuid(),
  ingredientBatchReference: z.string().max(200).optional(),
  messageType: z.string().max(200),
  parentThreadId: z.string().uuid().optional(),
  threadId: z.union([z.string().uuid(), z.string().regex(/^0x[0-9a-fA-F]{64}$/)]),
  toDid: z.string().startsWith('did:key:'),
});
const automaticMessageSchema = z.object({
  body: z.record(z.string(), z.unknown()),
  businessReference: z.string().min(1).max(200),
  expiresAt: z.string().datetime(),
  ingredientBatchReference: z.string().max(200).optional(),
  messageType: z.string().min(1).max(200),
  parentThreadId: z.string().uuid().optional(),
  recipientWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  threadId: z.union([z.string().uuid(), z.string().regex(/^0x[0-9a-fA-F]{64}$/)]),
});
export function createDidCommRouter(service: DidCommService, cookieName: string) {
  const router = Router();
  const run =
    (handler: (sessionId: string | undefined, body: unknown) => Promise<unknown>) =>
    async (request: any, response: any, next: any) => {
      try {
        response.setHeader('Cache-Control', 'no-store');
        response.json(await handler(request.cookies?.[cookieName], request.body));
      } catch (error) {
        if (error instanceof DidCommError) {
          response
            .status(error.status)
            .json({ error: { code: error.code, message: error.message } });
          return;
        }
        if (error instanceof z.ZodError) {
          response
            .status(400)
            .json({ error: { code: 'INVALID_REQUEST', message: error.issues[0]?.message } });
          return;
        }
        next(error);
      }
    };
  router.post(
    '/binding/challenge',
    run((session) => service.challenge(session)),
  );
  router.post(
    '/binding',
    run((session, body) =>
      service.bind(session, z.object({ proof: z.string().min(20).max(20_000) }).parse(body).proof),
    ),
  );
  router.get(
    '/directory',
    run((session) => service.directory(session)),
  );
  router.get(
    '/mailbox',
    run((session) => service.mailbox(session)),
  );
  router.post(
    '/relay',
    run((session, body) => service.relay(session, envelopeSchema.parse(body))),
  );
  router.post(
    '/send',
    run((session, body) => service.send(session, automaticMessageSchema.parse(body))),
  );
  return router;
}
